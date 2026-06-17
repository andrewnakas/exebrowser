// wine64-launcher.js — minimal browser launcher for the 64-bit Boxedwine guest.
//
// Unlike boxedwine-shell.js (the full 32-bit web shell with its many query-param
// quirks and a single boxedwine.zip), this loads the two LAYERED 64-bit rootfs
// zips and passes the exact arguments the native headless command uses to boot
// real wine64 (see README "Run real wine64 headless"):
//
//   -root /root -zip glibc-rootfs64.zip -zip wine64.zip
//   -env WINEDLLPATH=... [-env HOME=... -env WINEPREFIX=... -env WINESERVER=...]
//   /usr/lib/wine/wine64 <program...>
//
// Query params (all optional):
//   ?p=--version            program + args for wine64 (default: --version)
//                           space-separated; URL-encode spaces as %20.
//                           When a program (other than --version) is given, the
//                           launcher mounts a third zip — prefix64.zip — that
//                           carries a PRE-BOOTED .wine prefix (registry +
//                           dosdevices/c:,z: + glcube.exe) at /home/username, and
//                           runs the program with HOME=/home/username /
//                           WINEPREFIX=/home/username/.wine. wine sees an existing
//                           prefix and SKIPS `wineboot --init`. This sidesteps the
//                           unsolved in-browser wineserver-daemonize boot (see
//                           ?boot=1) and is the path that can actually reach pixels
//                           (e.g. ?p=glcube.exe).
//   ?boot=1                 boot the prefix from scratch: runs `wineboot --init`
//                           with HOME=/winePrefix. NOTE: in-tab this still STALLS —
//                           wineserver64 exits status=0 right after launch (no
//                           surviving daemon), dosdevices/c: is never created, and
//                           every spawned wine process loops on ENOENT. Kept as a
//                           progress probe for the wineserver-IPC roadmap work; use
//                           ?p=<prog> (pre-booted prefix) to actually run programs.
//   ?session=0              disable the persistent wine session (see below) and
//                           use the old reload-per-app path: boot `wine64 <prog>`
//                           directly and reload the page to switch apps. Default
//                           (?session=1) keeps one wineserver resident and spawns
//                           apps into it with no reload.
//   ?base=<url>             base URL the zips are fetched from (default: "./").
//   ?novideo=1              pass -novideo (headless; no SDL window).
//   ?chunked=1              fetch each rootfs zip via a <zip>.manifest.json that
//                           lists <zip>.partNNN pieces, and concatenate them in
//                           the browser before mounting. This is how the GitHub
//                           Pages deploy serves the 196 MB wine64.zip: Pages caps
//                           files at 100 MB and (being unable to set CORP headers)
//                           can't satisfy COEP require-corp for a cross-origin
//                           Release asset, so the zip is split into <100 MB
//                           SAME-ORIGIN parts (tools/rootfs64/split-rootfs.sh).
//                           Without this flag (e.g. local `node server.mjs`) the
//                           whole zips are fetched directly — unchanged behaviour.
//
// Examples:
//   wine64.html                      -> wine64 --version  (fast correctness boot)
//   wine64.html?boot=1               -> wineboot --init   (stalls; roadmap probe)
//   wine64.html?p=glcube.exe         -> wine64 glcube.exe  (pre-booted prefix; GL)
//   wine64.html?p=notepad.exe        -> wine64 notepad.exe (pre-booted prefix)
//
// PERSISTENT WINE SESSION (the real "load a new app into the SAME running wine"):
// By default (?session=1, implied whenever a real program is requested) the boot
// argv launches the requested app the SAME proven way as ?session=0
// (`wine64 <prog>` against the pre-booted prefix) — this brings up wineserver AND
// the wine service stack (services.exe, plugplay, …) a GUI app needs. Then, once
// the kernel is up, the launcher pins the running wineserver persistent by
// spawning `wineserver64 -p` into it. Because the emscripten main loop only quits
// when the last guest thread exits (platformThreadCount==0 -> SDL_QUIT), that
// pinned server keeps the whole kernel — prefix, X11 wire server, GL context —
// warm even after the app exits. Every later window.launchApp("<prog>") is then
// spawned INTO that running kernel with NO page reload, via the C bridge
// bw64_spawn() (source/sdl/emscripten/wine64session.cpp). The app bar in
// wine64.html calls launchApp().
//
// (An earlier design booted a BARE `wineserver64 -f -p` first and spawned the app
// after; that server never started the wine services, so a GUI app cold-started
// them and a failure cascaded to exit_group(1). Booting the app normally avoids
// that by reusing the known-good bring-up.)
//
// FALLBACK — reload-based switching (?session=0): launchApp() navigates to the
// new app's URL (?p=<prog>) for a clean page boot. The rootfs is NOT re-downloaded
// (immutable .zip/.part HTTP cache). A true in-page *reboot* is impossible here
// because this build is not MODULARIZE'd: boxedwine64.js declares top-level
// globals (e.g. `class ExitStatus`) in the page realm, so re-running it throws
// "duplicate variable", and the gl64 OffscreenCanvas (OFFSCREENCANVASES_TO_PTHREAD)
// can't be transferred twice. (The session path above avoids re-running the glue
// entirely — it never reboots, it spawns.)

(function () {
    "use strict";

    var GLIBC_ZIP = "glibc-rootfs64.zip";
    var WINE_ZIP = "wine64.zip";
    var PREFIX_ZIP = "prefix64.zip"; // pre-booted .wine prefix (+glcube.exe), ~257KB
    var ROOT = "/root";
    var WINE64 = "/usr/lib/wine/wine64";
    var WINESERVER64 = "/usr/lib/wine/wineserver64"; // real daemon binary (session mode)
    // The pre-booted prefix in PREFIX_ZIP lives here (dosdevices c: -> ../drive_c,
    // z: -> /). Running a program with these is what lets wine skip wineboot.
    var PREFIX_HOME = "/home/username";
    var PREFIX_WINE = "/home/username/.wine";

    // --- query params -------------------------------------------------------
    function param(key) {
        var m = new RegExp("[?&]" + key + "=([^&#]*)").exec(window.location.search);
        return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : null;
    }
    var BASE = param("base");
    if (BASE === null) BASE = "./";
    if (BASE.length && !BASE.endsWith("/")) BASE += "/";
    var CHUNKED = param("chunked") === "1"; // fetch zips as <zip>.partNNN via manifest

    // --- current run configuration ------------------------------------------
    // These describe the run being booted RIGHT NOW. The bare-page defaults come
    // from the query string; launchApp() rewrites them per relaunch (no reload).
    var DO_BOOT, NOVIDEO, PROG, USE_PREFIX, SESSION;
    function applyRunConfig(prog, opts) {
        opts = opts || {};
        PROG = prog;
        DO_BOOT = !!opts.boot;
        NOVIDEO = !!opts.novideo;
        // Run a real program against the pre-booted prefix when a program (other
        // than the bare --version correctness boot) is named and we're not booting.
        USE_PREFIX = !DO_BOOT && PROG && PROG.length && PROG !== "--version";
        // PERSISTENT SESSION mode: instead of booting `wine64 <prog>` (which makes
        // the whole emulator quit when <prog> exits), boot a long-lived foreground
        // wineserver and then spawn each app INTO that running kernel via the
        // bw64_spawn C bridge — no page reload, prefix/X11/GL stay warm. Only
        // meaningful when we have a real program to run against the pre-booted
        // prefix. On by default for that case; ?session=0 forces the old
        // reload-per-app path; ?boot=1 (raw prefix bring-up probe) never uses it.
        SESSION = USE_PREFIX && opts.session !== false;
    }
    // Initial config from the URL (?boot / ?novideo / ?p / ?session).
    applyRunConfig(param("p"), {
        boot: param("boot") === "1",
        novideo: param("novideo") === "1",
        session: param("session") !== "0"
    });

    // --- DOM hooks ----------------------------------------------------------
    var statusElement = document.getElementById("status");
    var progressElement = document.getElementById("progress");
    var spinnerElement = document.getElementById("spinner");

    function setStatusText(text) {
        if (statusElement) statusElement.innerHTML = text;
    }

    // The env every prefix-using process shares. Identical HOME / WINEPREFIX /
    // WINESERVER mean the boot wineserver and every later `wine64 <app>` spawn
    // talk to the SAME server socket (derived from WINEPREFIX) — that's what
    // makes them one wine session. Returned as ["K=V", ...].
    function prefixEnv() {
        var e = [
            "HOME=" + PREFIX_HOME,
            "WINEPREFIX=" + PREFIX_WINE,
            "WINESERVER=" + WINESERVER64,
            "WINEDLLPATH=/usr/lib/x86_64-linux-gnu/wine"
        ];
        // TEMP D3D bring-up: ?winedbg=<channels> sets WINEDEBUG for the reload
        // (?session=0) path so we can see loaddll/d3d failures. Remove before ship.
        var wd = param("winedbg");
        if (wd) e.push("WINEDEBUG=" + wd);
        return e;
        // NOTE: WINEDEBUG added here does NOT reach in-session app spawns — those
        // use the CAPTURED BOOT env (g_sessionCtx.env in wine64session.cpp), not
        // this JS env. To trace a spawned app, WINEDEBUG must be set at BOOT time
        // (the ?session=0 reload path / the boot env), not on prefixEnv().
    }

    // argv for running a Windows/guest program under wine64: [wine64, tok, ...].
    function wineProgArgv(prog) {
        var argv = [WINE64];
        (prog || "").split(/\s+/).forEach(function (tok) { if (tok.length) argv.push(tok); });
        return argv;
    }

    // --- build the wine64 argv ----------------------------------------------
    function buildArguments() {
        var args = ["-root", ROOT, "-zip", GLIBC_ZIP, "-zip", WINE_ZIP];
        // The pre-booted prefix is a third overlay; mount it only when we'll use
        // it, so the bare --version / ?boot=1 paths stay byte-for-byte unchanged.
        if (USE_PREFIX) args.push("-zip", PREFIX_ZIP);
        if (NOVIDEO) args.push("-novideo");

        if (DO_BOOT) {
            // Full prefix bring-up + wineserver handshake.
            args.push("-env", "HOME=/winePrefix");
            args.push("-env", "WINEPREFIX=/winePrefix/.wine");
            args.push("-env", "WINESERVER=" + WINESERVER64);
            args.push("-env", "WINEDLLPATH=/usr/lib/x86_64-linux-gnu/wine");
            args.push(WINE64, "wineboot", "--init");
        } else if (SESSION) {
            // PERSISTENT SESSION. Boot the requested app the SAME proven way as
            // ?session=0 (wine64 <prog> against the pre-booted prefix) — this
            // brings up wineserver AND the wine service stack (services.exe,
            // plugplay, …) that a GUI app needs, exactly as the known-good path.
            // A bare `wineserver64 -f -p` boot does NOT start those services, so
            // the app's wine would cold-start them and one failing cascades to an
            // exit_group(1). The difference from ?session=0 is only what happens
            // AFTER: we keep the kernel alive (so the emulator's main loop doesn't
            // quit when the app exits) by spawning `wineserver64 -p` right after
            // boot to pin the running server persistent (see maybeStartSessionApp),
            // and switch apps via bw64_spawn with no reload.
            prefixEnv().forEach(function (kv) { args.push("-env", kv); });
            wineProgArgv(PROG).forEach(function (tok) { args.push(tok); });
        } else if (USE_PREFIX) {
            // Run a program against the PRE-BOOTED prefix (prefix64.zip). HOME +
            // WINEPREFIX point at the existing /home/username/.wine, so wine finds
            // a populated prefix and does NOT run wineboot --init. (Legacy
            // reload-per-app path; ?session=0.)
            prefixEnv().forEach(function (kv) { args.push("-env", kv); });
            wineProgArgv(PROG).forEach(function (tok) { args.push(tok); });
        } else {
            // Bare wine64 --version (correctness boot, no prefix needed).
            args.push("-env", "WINEDLLPATH=/usr/lib/x86_64-linux-gnu/wine");
            args.push("-env", "WINESERVER=" + WINESERVER64);
            args.push(WINE64);
            var prog = (PROG && PROG.length) ? PROG : "--version";
            prog.split(/\s+/).forEach(function (tok) {
                if (tok.length) args.push(tok);
            });
        }
        return args;
    }

    // --- fetch one URL to a Uint8Array, streaming progress ------------------
    // `baseReceived` lets callers offset the progress so a multi-part download
    // reports cumulative bytes against a known grand total.
    // ?fresh=1 forces fetch(cache:'reload') on the rootfs zips so the browser
    // bypasses its (possibly immutable-cached) copy and re-pulls from the server.
    // Used during local rootfs iteration; harmless in prod (off by default).
    var FRESH_FETCH = (typeof param === "function" && param("fresh") === "1");
    function fetchOpts() { return FRESH_FETCH ? { cache: "reload" } : undefined; }

    function fetchBytes(url, label, onProgress, baseReceived, grandTotal) {
        baseReceived = baseReceived || 0;
        return fetch(url, fetchOpts()).then(function (resp) {
            if (!resp.ok) throw new Error("fetch " + url + " -> HTTP " + resp.status);
            var partTotal = Number(resp.headers.get("Content-Length")) || 0;
            var total = grandTotal || partTotal;
            if (!resp.body || !partTotal) {
                return resp.arrayBuffer().then(function (buf) {
                    var b = new Uint8Array(buf);
                    if (onProgress) onProgress(label, baseReceived + b.length, total);
                    return b;
                });
            }
            var reader = resp.body.getReader();
            var chunks = [];
            var received = 0;
            return (function pump() {
                return reader.read().then(function (r) {
                    if (r.done) {
                        var out = new Uint8Array(received);
                        var off = 0;
                        chunks.forEach(function (c) { out.set(c, off); off += c.length; });
                        return out;
                    }
                    chunks.push(r.value);
                    received += r.value.length;
                    if (onProgress) onProgress(label, baseReceived + received, total);
                    return pump();
                });
            })();
        });
    }

    // The LIVE Emscripten module. CRUCIAL: with the classic global-Module pattern
    // (this build is not MODULARIZE'd) the runtime copies our config object's
    // properties into its OWN internal Module and attaches FS / addRunDependency /
    // createDataFile to THAT — it does not necessarily write them back onto
    // window.Module. So window.Module.FS can stay undefined forever even though the
    // runtime is fully up. Inside a preRun callback the `Module` identifier IS that
    // live object, so loadFilesystem captures it here and everything that needs FS
    // / removeRunDependency uses it instead of window.Module.
    var liveModule = null;

    // The live module's FS (see liveModule note). Falls back to window.Module.FS.
    // May be undefined before the runtime is up — callers that run after boot
    // (download button, prefix prep) are fine since FS exists by then.
    function getFS() {
        var M = liveModule || window.Module;
        return M ? M.FS : undefined;
    }

    // Resolve the FS object from the live module. preRun runs before main(), and FS
    // (with createDataFile) is already available there — that's exactly when files
    // are meant to be written into the VFS. Returns the FS object, or null if only
    // the FS_createDataFile helper export exists (we handle both call shapes).
    function whenFsReady() {
        return new Promise(function (resolve, reject) {
            var waited = 0, STEP = 30, LIMIT = 30000;
            (function poll() {
                var M = liveModule || window.Module;
                if (M && M.FS && typeof M.FS.createDataFile === "function") return resolve({ fs: M.FS });
                if (M && typeof M.FS_createDataFile === "function") return resolve({ fs: null, M: M });
                waited += STEP;
                if (waited >= LIMIT) return reject(new Error("Module.FS never became ready (" + LIMIT + "ms)"));
                setTimeout(poll, STEP);
            })();
        });
    }

    function dropBytesIntoVfs(name, bytes) {
        return whenFsReady().then(function (r) {
            try {
                if (r.fs) r.fs.createDataFile("/", name, bytes, true, true);
                else r.M.FS_createDataFile("/", name, bytes, true, true);
            } catch (e) {
                console.log("createDataFile " + name + " failed: " + e);
                throw e;
            }
            console.log("loaded " + name + " (" + bytes.length + " bytes) into VFS");
            return bytes.length;
        });
    }

    // --- fetch a zip's bytes with progress -----------------------------------
    // Two paths, selected by the ?chunked flag:
    //   * whole-file: fetch BASE/<name> directly (local `node server.mjs`).
    //   * chunked: fetch BASE/<name>.manifest.json, then each listed part, and
    //     stitch them into the original <name> bytes. This is how GitHub
    //     Pages serves wine64.zip (split <100 MB, same-origin) — see
    //     tools/rootfs64/split-rootfs.sh and ?chunked above.
    // Both resolve with the *original* zip's bytes; the caller createDataFile()s
    // them under the zip's own name, so the wine64 argv (`-zip <name>`) is
    // identical regardless of how it was fetched.
    function fetchZipBytes(name, onProgress) {
        // Whole-file path. If it 404s (e.g. on GitHub Pages, where wine64.zip is
        // shipped only as split parts), transparently fall back to chunked — so
        // the page works regardless of whether ?chunked=1 was on the URL. Explicit
        // ?chunked=1 skips straight to the chunked path.
        if (!CHUNKED) {
            return fetchBytes(BASE + name, name, onProgress).catch(function (err) {
                var msg = "" + (err && err.message ? err.message : err);
                if (msg.indexOf("HTTP 404") === -1) throw err; // a real error, not "missing whole zip"
                console.log(name + ": whole zip not found (404) — falling back to chunked parts");
                return fetchChunkedBytes(name, onProgress);
            });
        }
        return fetchChunkedBytes(name, onProgress);
    }

    // Chunked: read the manifest, then pull the parts IN PARALLEL and stitch them
    // into <name>. split(1) emits fixed-size parts (manifest chunkBytes) with only
    // the last one short, so part i's bytes belong at exactly i*chunkBytes — each
    // fetch writes straight into the preallocated buffer, no concatenation copy,
    // and the parts ride the network concurrently instead of back-to-back.
    function fetchChunkedBytes(name, onProgress) {
        return fetch(BASE + name + ".manifest.json", fetchOpts()).then(function (resp) {
            if (!resp.ok) throw new Error("fetch " + name + ".manifest.json -> HTTP " + resp.status);
            return resp.json();
        }).then(function (manifest) {
            var parts = manifest.parts || [name];
            var total = Number(manifest.totalBytes) || 0;
            var chunk = Number(manifest.chunkBytes) || 0;
            if (!chunk && parts.length > 1) {
                throw new Error(name + ".manifest.json: multi-part manifest without chunkBytes");
            }
            var out = new Uint8Array(total);
            var assembled = 0;
            return Promise.all(parts.map(function (part, i) {
                return fetchBytes(BASE + part, part, onProgress).then(function (bytes) {
                    var offset = i * chunk;
                    if (offset + bytes.length > total) {
                        throw new Error(name + ": part " + part + " overflows manifest totalBytes");
                    }
                    out.set(bytes, offset);
                    assembled += bytes.length;
                });
            })).then(function () {
                if (total && assembled !== total) {
                    throw new Error(name + ": assembled " + assembled + " bytes, manifest said " + total);
                }
                return out;
            });
        });
    }

    // --- start the rootfs downloads ------------------------------------------
    // Kicked off from bootWine() the moment we decide to boot — BEFORE the
    // emscripten script is appended — so the big zip downloads overlap the wasm
    // fetch + compile + pthread-pool spawn instead of waiting for preRun. All
    // needed zips (and their split parts) download in parallel; loadFilesystem()
    // just awaits the bytes. The resolved promises double as an in-memory cache,
    // so an in-page relaunch reuses the bytes without touching the network.
    var zipDownloads = null; // name -> Promise<Uint8Array>
    function neededZips() {
        var names = [GLIBC_ZIP, WINE_ZIP];
        if (USE_PREFIX) names.push(PREFIX_ZIP);
        return names;
    }
    // One progress line for the whole concurrent download set: sum the per-URL
    // byte counts (each zip/part reports under its own label) into a single
    // monotonic-ish "Loading rootfs NN%". Totals register as each response's
    // Content-Length / manifest arrives, so the percentage firms up as fetches
    // start — cosmetic, and far better than three sequential 0-100% sweeps.
    var dlReceived = {}, dlTotals = {};
    function aggregateProgress(label, recv, total) {
        dlReceived[label] = recv;
        if (total) dlTotals[label] = total;
        var r = 0, t = 0;
        Object.keys(dlReceived).forEach(function (k) { r += dlReceived[k]; });
        Object.keys(dlTotals).forEach(function (k) { t += dlTotals[k]; });
        var pct = t ? Math.round((r / t) * 100) : 0;
        setStatusText("Loading rootfs " + pct + "%");
        if (progressElement) {
            progressElement.hidden = false;
            progressElement.value = r;
            progressElement.max = t || 1;
        }
    }
    function startZipDownloads() {
        if (!zipDownloads) zipDownloads = {};
        neededZips().forEach(function (name) {
            if (zipDownloads[name]) return; // already in flight / cached
            zipDownloads[name] = fetchZipBytes(name, aggregateProgress);
            // Swallow here only to avoid unhandled-rejection console noise before
            // loadFilesystem chains on; IT surfaces the error to the user.
            zipDownloads[name].catch(function () {});
        });
        return zipDownloads;
    }

    // --- writable WINEPREFIX -----------------------------------------------
    // Guest "/" maps to the Emscripten MEMFS dir passed via -root (ROON = /root).
    // wine64 chdir()s into WINEPREFIX before creating it, so HOME (/winePrefix)
    // and the prefix dir must already exist as writable dirs. Create them in the
    // host MEMFS under ROOT so the guest sees writable /winePrefix/.wine.
    function mkdirHost(path) {
        try { getFS().mkdir(path); } catch (e) { /* EEXIST is fine */ }
    }
    function prepareWinePrefix() {
        // ROOT (/root in MEMFS) is the guest "/". Boxedwine MKDIR()s ROOT itself
        // inside main(), but that runs AFTER this preRun hook, so create the full
        // chain here (ROOT first) — a later MKDIR of an existing dir is a no-op.
        mkdirHost(ROOT);
        mkdirHost(ROOT + "/winePrefix");
        mkdirHost(ROOT + "/winePrefix/.wine");
        try {
            var st = getFS().stat(ROOT + "/winePrefix/.wine");
            console.log("created writable WINEPREFIX at " + ROOT + "/winePrefix/.wine (mode " + st.mode.toString(8) + ")");
        } catch (e) {
            console.error("WINEPREFIX dir NOT created: " + e);
        }
    }

    // --- download files the user saved -------------------------------------
    // Notepad (and any guest app) writes through Boxedwine's kernel to the
    // WRITABLE native root, which is this Emscripten MEMFS under ROOT (/root).
    // Two save locations matter, both rooted in MEMFS:
    //
    //   * Z:\home\username  — wine's DEFAULT save dir. z: maps to guest "/",
    //     guest "/" maps to MEMFS ROOT, and HOME is /home/username, so this is
    //     MEMFS ROOT + "/home/username". This is where files land if the user
    //     just hits Save without browsing. NOTE this dir also contains the whole
    //     .wine prefix (registry, glcube.exe, …) — we EXCLUDE .wine so prefix
    //     internals don't leak into the download.
    //   * C:\users\username — the shell "Documents/Desktop" profile. c: maps to
    //     .../drive_c, so this is ROOT + "/home/username/.wine/drive_c/users/
    //     username". Holds many empty Wine shell-folder dirs (AppData, Searches,
    //     Links, …) we DON'T want to walk.
    //
    // To keep the zip clean we grab only the places users actually save:
    //   - regular files sitting directly in Z:\home\username  (minus .wine)
    //   - regular files directly in C:\users\username
    //   - everything under Documents\ and Desktop\ of BOTH homes (recursively)
    // Packed into a STORE-only zip (no deps; Notepad text doesn't need DEFLATE)
    // and handed to the browser. Mirrors the FS.readdir/FS.readFile + Blob +
    // anchor pattern proven in boxedwine-shell.js (the 32-bit web shell).
    var HOME_IN_MEMFS = ROOT + "/home/username";                       // Z:\home\username
    var PROFILE_IN_MEMFS = HOME_IN_MEMFS + "/.wine/drive_c/users/username"; // C:\users\username

    function fsIsDir(path) {
        try { return getFS().isDir(getFS().stat(path).mode); }
        catch (e) { return false; }
    }

    function readFileSafe(path) {
        try { return getFS().readFile(path, { encoding: "binary" }); }
        catch (e) { return null; /* unreadable (e.g. a dangling link) */ }
    }

    // Collect ONLY the regular files directly inside `dir` (no recursion),
    // naming them relative to `base`. `skip` is an optional set of child names
    // to ignore (e.g. ".wine" so we don't recurse the prefix — though we don't
    // recurse here anyway, it documents intent and guards a future change).
    function collectTopLevelFiles(dir, base, out, skip) {
        var entries;
        try { entries = getFS().readdir(dir); } catch (e) { return; }
        entries.forEach(function (name) {
            if (name === "." || name === ".." || name === ".keep") return;
            if (skip && skip[name]) return;
            var full = dir + "/" + name;
            if (fsIsDir(full)) return; // skip subfolders at the root level
            var data = readFileSafe(full);
            if (data) out.push({ name: full.slice(base.length + 1), data: data });
        });
    }

    // Recursively collect every regular file under `dir`, naming relative to
    // `base` (so the zip preserves the folder layout, e.g. Documents/foo.txt).
    function collectFiles(dir, base, out) {
        var entries;
        try { entries = getFS().readdir(dir); } catch (e) { return; }
        entries.forEach(function (name) {
            if (name === "." || name === ".." || name === ".keep") return;
            var full = dir + "/" + name;
            if (fsIsDir(full)) {
                collectFiles(full, base, out);
            } else {
                var data = readFileSafe(full);
                if (data) out.push({ name: full.slice(base.length + 1), data: data });
            }
        });
    }

    // Minimal STORE-only (compression method 0) ZIP writer. Enough to bundle
    // saved text files into one download without pulling in a zip library.
    function buildStoreZip(files) {
        function crc32(bytes) {
            var c, table = buildStoreZip._t || (buildStoreZip._t = (function () {
                var t = new Uint32Array(256);
                for (var n = 0; n < 256; n++) {
                    c = n;
                    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                    t[n] = c >>> 0;
                }
                return t;
            })());
            c = 0xFFFFFFFF;
            for (var i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
            return (c ^ 0xFFFFFFFF) >>> 0;
        }
        var enc = new TextEncoder();
        var locals = [], central = [], offset = 0;
        function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
        function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }
        files.forEach(function (f) {
            var nameBytes = enc.encode(f.name);
            var crc = crc32(f.data), sz = f.data.length;
            var local = [].concat(
                u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
                u32(crc), u32(sz), u32(sz), u16(nameBytes.length), u16(0)
            );
            locals.push(new Uint8Array(local), nameBytes, f.data);
            central.push([].concat(
                u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
                u32(crc), u32(sz), u32(sz), u16(nameBytes.length),
                u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)
            ), nameBytes);
            offset += local.length + nameBytes.length + sz;
        });
        var centralStart = offset, centralSize = 0;
        var centralChunks = [];
        central.forEach(function (c) {
            var u = (c instanceof Uint8Array) ? c : new Uint8Array(c);
            centralChunks.push(u); centralSize += u.length;
        });
        var end = new Uint8Array([].concat(
            u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
            u32(centralSize), u32(centralStart), u16(0)
        ));
        return new Blob(locals.concat(centralChunks, [end]), { type: "application/zip" });
    }

    function downloadSavedFiles() {
        if (!window.Module || !getFS()) {
            alert("Filesystem not ready yet — wait for the app to finish loading.");
            return;
        }
        var files = [];
        // (1) wine's DEFAULT save dir Z:\home\username — top-level files (minus
        // the .wine prefix) plus its Documents\/Desktop\ trees. Name these under
        // a "home/" prefix so they can't collide with the C: profile's files.
        collectTopLevelFiles(HOME_IN_MEMFS, ROOT, files, { ".wine": 1 });
        collectFiles(HOME_IN_MEMFS + "/Documents", ROOT, files);
        collectFiles(HOME_IN_MEMFS + "/Desktop", ROOT, files);
        // (2) The C:\users\username shell profile — top-level files plus its
        // Documents\/Desktop\ trees. Named "users/username/..." (relative to its
        // own grandparent) to keep them distinct from the Z: home above.
        var PROFILE_BASE = HOME_IN_MEMFS + "/.wine/drive_c";
        collectTopLevelFiles(PROFILE_IN_MEMFS, PROFILE_BASE, files);
        collectFiles(PROFILE_IN_MEMFS + "/Documents", PROFILE_BASE, files);
        collectFiles(PROFILE_IN_MEMFS + "/Desktop", PROFILE_BASE, files);
        if (!files.length) {
            alert("No saved files found yet.\n\nSave a file from the app first " +
                  "(e.g. Notepad → File → Save As, into Documents or Desktop), " +
                  "then click Download again.");
            return;
        }
        var blob = buildStoreZip(files);
        var ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "wine64-files-" + ts + ".zip";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
        console.log("downloadSavedFiles: zipped " + files.length + " file(s): " +
                    files.map(function (f) { return f.name; }).join(", "));
    }
    // Expose so the HTML button's onclick can reach it.
    window.downloadSavedFiles = downloadSavedFiles;

    // --- upload-your-own .exe ----------------------------------------------
    // Let the user run a Windows .exe they bring themselves (sidesteps the
    // bundling/licensing problem — IrfanView/Sysinternals/etc are free but not
    // redistributable, so users supply their own copy). We write the uploaded
    // bytes into the SAME writable MEMFS the prefix lives in (Z:\home\username,
    // i.e. HOME_IN_MEMFS), then spawn it in-session like any app-bar button.
    // Caveats users should know (shown in the UI): only a SINGLE PORTABLE Win32/
    // GDI exe works — not installers, not apps needing sibling DLLs, not .NET,
    // not D3D/GPU apps, not anything needing network. Best results: classic
    // small Win32 utilities (e.g. a portable HxD.exe, IrfanView i_view64.exe).
    function uploadAndRunExe(file) {
        if (!file) return;
        if (!window.Module || !getFS()) {
            alert("Not ready yet — wait for the prefix to finish booting (the " +
                  "first app you launch downloads the rootfs), then try again.");
            return;
        }
        var name = (file.name || "uploaded.exe").replace(/[\\/]/g, "_");
        if (!/\.exe$/i.test(name)) {
            if (!confirm('"' + name + '" is not a .exe — try to run it anyway?')) return;
        }
        // Guard against absurd sizes (the heap is ~4GB and the exe is copied a few
        // times through the spawn path); a portable utility is a few MB.
        if (file.size > 256 * 1024 * 1024) {
            alert("That file is " + Math.round(file.size / 1048576) + " MB — too big " +
                  "for the in-browser sandbox. Use a small portable .exe (a few MB).");
            return;
        }
        var reader = new FileReader();
        reader.onerror = function () { alert("Could not read " + name + "."); };
        reader.onload = function () {
            var bytes = new Uint8Array(reader.result);
            var dest = HOME_IN_MEMFS + "/" + name;       // Z:\home\username\<name>
            try {
                // Overwrite any prior upload of the same name.
                try { getFS().unlink(dest); } catch (e) {}
                getFS().writeFile(dest, bytes);
            } catch (e) {
                console.log("uploadAndRunExe: writeFile " + dest + " failed: " + e);
                alert("Failed to place " + name + " into the sandbox: " + e);
                return;
            }
            console.log("uploadAndRunExe: wrote " + bytes.length + " bytes to " + dest +
                        " — registering in VFS + launching");
            // Register the freshly-written file in Boxedwine's VFS, or a spawned
            // wine process can't see it: the prefix dir was scanned (and cached)
            // at boot, so a raw MEMFS write is invisible to the path resolver
            // (wine returns c0000135). bw64_register_file injects the node; it's
            // QUEUED and drained on the main-loop thread BEFORE the spawn below
            // (same queue, FIFO), so the file exists in the VFS when wine looks.
            var guestPath = "/home/username/" + name;     // VFS local path (Z: == guest /)
            callExport("bw64_register_file", ["string"], [guestPath]);
            var prog = "Z:\\home\\username\\" + name;      // explicit Z: path, like DOOM/HxD
            if (window.launchApp) window.launchApp(prog);
            else window.location.search = "?p=" + encodeURIComponent(prog);
        };
        reader.readAsArrayBuffer(file);
    }
    window.uploadAndRunExe = uploadAndRunExe;

    // --- orchestration ------------------------------------------------------
    // The zips are large (wine64.zip ~205MB) on the FIRST boot. Their downloads
    // were already started by bootWine() (overlapping the wasm compile); here we
    // await the bytes, drop them in the VFS, push the argv, then release the run
    // dependency so main() proceeds. On an in-page relaunch the resolved
    // promises hand the bytes back instantly.
    function loadFilesystem(els) {
        console.log("wine64-launcher: loading 64-bit rootfs from " + (BASE || "./"));
        var downloads = startZipDownloads(); // no-op if already in flight
        var names = neededZips();
        Promise.all(names.map(function (name) { return downloads[name]; }))
            .then(function (allBytes) {
                // createDataFile is synchronous-cheap; do them in order. After a
                // zip's bytes are copied into MEMFS (what wine actually reads),
                // DROP the JS-side Uint8Array (M8): startZipDownloads kept it as
                // an in-page-relaunch cache, but that doubled peak memory — each
                // ~50-196MB zip was resident BOTH in MEMFS and in zipDownloads.
                // The reload-fallback relaunch path re-fetches from the HTTP
                // cache anyway (and the in-session relaunch doesn't re-mount), so
                // nothing needs the JS copy after the mount. Replacing the cached
                // promise with a tombstone frees the buffer to GC while still
                // de-duping any concurrent in-flight request for the same name.
                return names.reduce(function (chain, name, i) {
                    return chain.then(function () {
                        return dropBytesIntoVfs(name, allBytes[i]);
                    }).then(function () {
                        allBytes[i] = null;
                        if (zipDownloads) zipDownloads[name] = Promise.resolve(null);
                    });
                }, Promise.resolve());
            })
            .then(function () {
                // Restore persisted user files into the writable MEMFS layer
                // BEFORE main() runs (we still hold the loadWine64Fs run
                // dependency), so the guest's very first VFS scan sees them.
                return restorePersistedFiles();
            })
            .then(function () {
                if (els.progress) els.progress.hidden = true;
                if (els.spinner) els.spinner.hidden = true;
                setStatusText(DO_BOOT ? "Booting wine prefix..." :
                              SESSION ? "Starting wine session..." :
                              USE_PREFIX ? "Starting " + PROG + " (pre-booted prefix)..." :
                              "Starting wine64...");

                if (DO_BOOT) prepareWinePrefix();

                var M = liveModule || window.Module;
                var args = buildArguments();
                for (var i = 0; i < args.length; i++) M["arguments"].push(args[i]);
                console.log("wine64 argv: " + JSON.stringify(args));

                M["removeRunDependency"]("loadWine64Fs");

                // In session mode the boot argv launched the requested app the
                // normal way (which brings up wineserver + services). Once the
                // kernel is up, pin the running wineserver persistent so the
                // emulator's main loop won't quit when the app later exits — that
                // resident server is what makes this a persistent session.
                if (SESSION) pinSessionServerWhenReady();
                startPersistLoop();
            })
            .catch(function (err) {
                console.error("wine64-launcher failed: " + err);
                setStatusText("Failed to load rootfs: " + err);
            });
    }

    // --- one boot of the wasm module ----------------------------------------
    // Builds a fresh window.Module against the current run config and appends the
    // emscripten script so it boots. Safe to call repeatedly (teardown first).
    function bootWine() {
        var canvas = document.getElementById("canvas");
        if (canvas) {
            canvas.addEventListener("webglcontextlost", function (e) {
                // On relaunch this is expected (we tear the old context down); only
                // alarm the user on the live instance.
                console.warn("webglcontextlost on #canvas");
                e.preventDefault();
            }, false);
            canvas.width = 800;
            canvas.height = 600;
        }
        var els = {
            progress: document.getElementById("progress"),
            spinner: document.getElementById("spinner"),
            output: document.getElementById("output")
        };

        window.Module = {
            arguments: [],
            canvas: canvas,
            preRun: [function () {
                // Inside preRun the `Module` identifier is the LIVE Emscripten
                // module (the one that actually owns FS / run dependencies), which
                // is NOT necessarily === window.Module. Capture it so loadFilesystem
                // and the FS writes target the real object.
                liveModule = (typeof Module !== "undefined") ? Module : window.Module;
                // Host-side GL trace (read via getenv in gl64bridge.cpp). Emscripten
                // getenv() reads Module.ENV; set it before main() runs.
                try { liveModule["ENV"] = liveModule["ENV"] || {}; liveModule["ENV"]["BW64_GLTRACE"] = (param("gltrace") || "1"); } catch (e) {}
                // ?ripsample=1 turns on the guest RIP sampler + heartbeat (every ~2s
                // dump each live thread's instruction-delta + rip + module) — used to
                // locate where the D3D Present() thread spins/blocks. Off by default.
                try { if (param("ripsample") === "1") { liveModule["ENV"]["BW64_RIPSAMPLE"] = "1"; liveModule["ENV"]["BW64_RIPSAMPLE_HB"] = "1"; } } catch (e) {}
                // Hold main() until the rootfs is in the VFS.
                liveModule["addRunDependency"]("loadWine64Fs");
                loadFilesystem(els);
            }],
            print: function () {
                var text = Array.prototype.slice.call(arguments).join(" ");
                console.log(text);
                if (els.output) { els.output.value += text + "\n"; els.output.scrollTop = els.output.scrollHeight; }
            },
            printErr: function () {
                var text = Array.prototype.slice.call(arguments).join(" ");
                console.error(text);
                if (els.output) { els.output.value += text + "\n"; els.output.scrollTop = els.output.scrollHeight; }
            },
            setStatus: function (text) { if (text) setStatusText(text); },
            totalDependencies: 0,
            monitorRunDependencies: function () {}
        };

        // Gate the emscripten glue on cross-origin isolation. The wasm64-mt build
        // needs SharedArrayBuffer AND a WebGL2 context (the gl64 bridge), both of
        // which require crossOriginIsolated===true. On `node server.mjs` (real
        // COOP/COEP headers) that's true on first paint. On GitHub Pages,
        // coi-serviceworker.js injects the headers but only after it reloads the
        // page once; until then crossOriginIsolated is false and booting anyway
        // makes emscripten_webgl_create_context fail ("ensureContext FAILED") so
        // the cube never renders. So: only append the script once isolated.
        function appendModuleScript() {
            // Boot is going ahead: start the rootfs downloads NOW so they ride
            // the network while the browser fetches + compiles boxedwine64.wasm
            // and spawns the pthread worker pool. preRun's loadFilesystem awaits
            // these same promises.
            startZipDownloads();
            var s = document.createElement("script");
            s.id = "boxedwine64-module-script";
            s.async = true;
            s.src = "boxedwine64.js";
            document.body.appendChild(s);
        }
        if (window.crossOriginIsolated || typeof window.crossOriginIsolated === "undefined") {
            // Already isolated (real headers / coi reload landed), or a browser with
            // no isolation concept (coi shim gave up) — just boot.
            appendModuleScript();
            return;
        }
        // Not isolated yet: coi-serviceworker registers + reloads to turn it on.
        // Poll briefly for isolation; surface a clear message if it never lands.
        setStatusText("Enabling cross-origin isolation (service worker)…");
        var waited = 0, STEP = 250, LIMIT = 15000;
        var iv = setInterval(function () {
            if (window.crossOriginIsolated) { clearInterval(iv); appendModuleScript(); return; }
            waited += STEP;
            if (waited >= LIMIT) {
                clearInterval(iv);
                setStatusText("Could not enable cross-origin isolation — try a hard reload " +
                              "(⌘/Ctrl+Shift+R). SharedArrayBuffer/WebGL need COOP/COEP.");
                console.error("crossOriginIsolated still false after " + LIMIT +
                              "ms; not booting (WebGL context would fail).");
            }
        }, STEP);
    }

    // --- persistent session: spawn an app into the RUNNING wine -------------
    // The C side (source/sdl/emscripten/wine64session.cpp) exports:
    //   int bw64_session_ready()                       -> 1 once boot captured ctx
    //   int bw64_spawn(argvJoined, envJoined)          -> 1 if a process scheduled
    // argv/env are '\n'-joined strings (no '\n' ever appears in our paths/values).
    function callExport(name, argTypes, args) {
        var M = liveModule || window.Module;
        if (!M || typeof M.ccall !== "function") return null;
        try { return M.ccall(name, "number", argTypes, args); }
        catch (e) { console.warn("ccall " + name + " failed: " + e); return null; }
    }
    function sessionReady() {
        return callExport("bw64_session_ready", [], []) === 1;
    }
    function lastSpawnedPid() {
        return callExport("bw64_last_spawned_pid", [], []) || 0;
    }
    // The pid of the app currently shown on the canvas — the one to close when the
    // user switches. Seeded from the boot app once the session is ready, then
    // updated to each newly-spawned app's pid. (The wineserver64 -p pin spawn also
    // bumps the C-side last-spawned pid, so we capture the boot pid BEFORE pinning
    // and only re-read after real app spawns.)
    var currentAppPid = 0;
    // Spawn an arbitrary guest argv (array) into the live kernel, sharing the
    // session's prefix env. Returns true if the C side queued the process.
    function spawnArgv(argvArray, label) {
        var argv = argvArray.join("\n");
        var env = prefixEnv().join("\n");
        var r = callExport("bw64_spawn", ["string", "string"], [argv, env]);
        if (r === 1) {
            console.log("session: spawned " + (label || argvArray.join(" ")) + " into the running wine");
            return true;
        }
        console.warn("session: spawn of " + (label || argvArray.join(" ")) + " did not schedule (r=" + r + ")");
        return false;
    }
    // Switch to `prog` IN-SESSION: arm "adopt the next app window as the canvas
    // base", spawn the new app, then KILL the previous app. Leaving the old app
    // running invisibly (the earlier design) didn't hold up: wine never learns
    // its window is hidden, so a background notepad kept repainting (caret
    // blink), could steal the canvas + keyboard back from the new app, and a
    // background DOOM busy-spins a whole core. The kill is kernel-side (no
    // guest SIGTERM — that's what crashed the runtime when kill was first
    // tried); the C side also erases the dead app's windows from the X server,
    // so input + canvas can only belong to the new app.
    function spawnIntoSession(prog) {
        // Arm the adopt-next-window switch BEFORE spawning, so the new app's very
        // first window is the one adopted (not some late repaint of the old app).
        try { callExport("bw64_reset_present", [], []); } catch (e) {}
        var prevPid = currentAppPid;
        var pidBeforeSpawn = lastSpawnedPid();
        if (!spawnArgv(wineProgArgv(prog), prog)) return false;
        // Kill the outgoing app AFTER the new spawn is queued (the C-side FIFO
        // runs them in order). prevPid is only ever an APP pid (boot app or a
        // prior in-session app) — never the wineserver/pin, which JS tracks
        // separately — so the session itself can't be killed here.
        if (prevPid > 0) {
            console.log("session: closing previous app pid=" + prevPid);
            callExport("bw64_kill", ["number"], [prevPid]);
        }
        // The spawn is queued (drained on the next main-loop tick), so the new
        // pid isn't known yet — poll it for the NEXT switch's kill.
        var waited = 0, STEP = 200, LIMIT = 30000;
        (function pollPid() {
            var p = lastSpawnedPid();
            if (p && p !== pidBeforeSpawn) {
                currentAppPid = p;
                console.log("session: current app pid=" + p);
                return;
            }
            waited += STEP;
            if (waited >= LIMIT) {
                console.warn("session: never saw the new app's pid (spawn failed?)");
                return;
            }
            setTimeout(pollPid, STEP);
        })();
        return true;
    }
    // Once the kernel is up: remember the boot app as the current app, then pin
    // the running wineserver persistent (spawn `wineserver64 -p`) so the
    // emulator's main loop won't quit when an app later exits — that's what keeps
    // the prefix/X11/GL warm so later launchApp() spawns land in the SAME wine.
    var sessionServerPinned = false;
    function pinSessionServerWhenReady() {
        var waited = 0, STEP = 100, LIMIT = 60000;
        (function poll() {
            if (sessionReady()) {
                if (!sessionServerPinned) {
                    sessionServerPinned = true;
                    // Capture the boot app pid BEFORE the pin spawn overwrites the
                    // C-side last-spawned pid.
                    currentAppPid = lastSpawnedPid();
                    console.log("session: boot app pid=" + currentAppPid);
                    spawnArgv([WINESERVER64, "-p"], "wineserver64 -p (pin persistent)");
                }
                return;
            }
            waited += STEP;
            if (waited >= LIMIT) {
                console.error("session never became ready after " + LIMIT + "ms");
                return;
            }
            setTimeout(poll, STEP);
        })();
    }

    // --- public: switch to another app --------------------------------------
    // PREFERRED PATH (persistent session): if a live wine session exists, spawn
    // the new app straight into it — no page reload, the prefix / X11 server / GL
    // context all stay warm. This is the real "load a new app into the SAME
    // running wine".
    //
    // FALLBACK PATH (reload): if there's no live session (e.g. ?session=0, or the
    // app was booted with ?boot=1, or the session never came up), navigate to the
    // new app's URL for a clean reboot. A true in-page *reboot* is impossible here
    // because this wasm64-mt build is NOT MODULARIZE'd — boxedwine64.js declares
    // top-level globals (e.g. `class ExitStatus`) in the page realm, so re-running
    // it throws "duplicate variable", and the gl64 OffscreenCanvas can't be
    // transferred twice. The rootfs isn't re-downloaded (immutable HTTP cache).
    //
    // opts: { boot, novideo } mirror the query params; ?chunked=1 etc. preserved.
    function launchApp(prog, opts) {
        if (window.setActiveApp) try { window.setActiveApp(prog); } catch (e) {}
        // In-session spawn when we can (default session mode, kernel up, real app).
        if (SESSION && !(opts && opts.boot) && prog && prog !== "--version" && sessionReady()) {
            setStatusText("Launching " + prog + " (session)…");
            if (spawnIntoSession(prog)) return;
            // fall through to reload if the spawn somehow failed
        }
        setStatusText("Switching to " + prog + "…");
        try {
            var url = new URL(window.location.href);
            url.searchParams.set("p", prog);
            if (opts && opts.boot) url.searchParams.set("boot", "1"); else url.searchParams.delete("boot");
            if (opts && opts.novideo) url.searchParams.set("novideo", "1"); else url.searchParams.delete("novideo");
            window.location.href = url.toString();
        } catch (e) {
            window.location.search = "?p=" + encodeURIComponent(prog);
        }
    }
    window.launchApp = launchApp;
    // Expose so the HTML button's onclick can reach it.
    window.downloadSavedFiles = downloadSavedFiles;

    // --- clipboard bridge (M2): host <-> guest copy/paste --------------------
    // Implemented with two tiny bundled win32 helpers (clipset.exe/clipget.exe
    // in the prefix HOME) that talk to the wineserver-managed WIN32 clipboard
    // directly — the X-selection clipboard manager (explorer's clipboard
    // thread) is not functional under the minimal XWire server, but every wine
    // app's OpenClipboard/GetClipboardData against wineserver works.
    //   Paste to app: browser clipboard -> MEMFS .bw64clip.txt ->
    //     bw64_register_file -> spawn clipset.exe (SetClipboardData) -> the
    //     user pastes inside the app (Ctrl+V / Edit▸Paste).
    //   Copy from app: spawn clipget.exe (GetClipboardData -> .bw64clip.out)
    //     -> poll MEMFS for the file -> navigator.clipboard.writeText.
    // Buttons (not automatic) because navigator.clipboard needs a user gesture.
    // The X-selection path (bw64_clipboard_get/set + ConvertSelection in the
    // XWire server) stays as substrate; these helpers are the working route.
    var CLIP_IN_MEMFS = HOME_IN_MEMFS + "/.bw64clip.txt";    // host -> guest
    var CLIP_OUT_MEMFS = HOME_IN_MEMFS + "/.bw64clip.out";   // guest -> host
    var clipInRegistered = false;
    function copyFromApp() {
        var FS = getFS();
        if (!FS || !sessionReady()) { setStatusText("Clipboard: wine session not ready yet"); return; }
        try { FS.unlink(CLIP_OUT_MEMFS); } catch (e) {}
        if (!spawnArgv(wineProgArgv("Z:\\home\\username\\clipget.exe"), "clipget")) {
            setStatusText("Clipboard helper failed to start");
            return;
        }
        setStatusText("Reading the app's clipboard…");
        var waited = 0, STEP = 500, LIMIT = 30000;
        (function poll() {
            var bytes = null;
            try { bytes = FS.readFile(CLIP_OUT_MEMFS); } catch (e) {}
            if (bytes !== null) {
                var text = new TextDecoder().decode(bytes);
                if (!text) { setStatusText("App clipboard is empty (copy something in the app first)"); return; }
                var done = function () { setStatusText("Copied " + text.length + " chars from the app → your clipboard"); };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(done, function (err) {
                        setStatusText("Browser blocked the clipboard write (" + err + ") — text: " + text.slice(0, 120));
                    });
                } else {
                    var ta = document.createElement("textarea");
                    ta.value = text; document.body.appendChild(ta); ta.select();
                    try { document.execCommand("copy"); done(); }
                    catch (e) { setStatusText("Clipboard write failed: " + e); }
                    document.body.removeChild(ta);
                }
                return;
            }
            waited += STEP;
            if (waited >= LIMIT) { setStatusText("Clipboard read timed out (helper didn't finish)"); return; }
            setTimeout(poll, STEP);
        })();
    }
    function pasteToApp() {
        var FS = getFS();
        if (!FS || !sessionReady()) { setStatusText("Clipboard: wine session not ready yet"); return; }
        var stage = function (text) {
            if (!text) { setStatusText("Your clipboard is empty"); return; }
            try {
                FS.writeFile(CLIP_IN_MEMFS, new TextEncoder().encode(text));
            } catch (e) { setStatusText("Could not stage clipboard file: " + e); return; }
            if (!clipInRegistered) {
                // Make the freshly written MEMFS file visible to the guest VFS
                // (same mechanism as the .exe upload — see uploadAndRunExe).
                callExport("bw64_register_file", ["string"], ["/home/username/.bw64clip.txt"]);
                clipInRegistered = true;
            }
            if (!spawnArgv(wineProgArgv("Z:\\home\\username\\clipset.exe"), "clipset")) {
                setStatusText("Clipboard helper failed to start");
                return;
            }
            setStatusText("Sending " + text.length + " chars to the app… paste inside the app in a few seconds (Ctrl+V)");
        };
        if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText().then(stage, function () {
                // Permission denied or unsupported — fall back to a prompt.
                var t = window.prompt("Paste the text to send to the app:", "");
                if (t !== null) stage(t);
            });
        } else {
            var t = window.prompt("Paste the text to send to the app:", "");
            if (t !== null) stage(t);
        }
    }
    window.bw64CopyFromApp = copyFromApp;
    window.bw64PasteToApp = pasteToApp;

    // --- persistence across reloads (M3) -------------------------------------
    // Guest writes land in the writable MEMFS layer under ROOT; the rootfs zips
    // are read-only layers below it. Persist the user-visible writable tree
    // (HOME: Z:\home\username — includes the .wine prefix, so app settings and
    // registry changes survive too) into IndexedDB on an interval, and restore
    // it during preRun BEFORE wine boots — restored files are then part of the
    // very first VFS scan (no post-boot cache registration needed) and shadow
    // the zip contents naturally. ?persist=0 disables both halves.
    var PERSIST = param("persist") !== "0";
    var PERSIST_DB = "bw64persist", PERSIST_STORE = "files";
    var PERSIST_FILE_CAP = 16 * 1024 * 1024;       // skip single files above this
    var PERSIST_SKIP = { ".bw64clip.txt": 1, ".bw64clip.out": 1, ".bw64clip.tmp": 1 };
    var persistManifest = {};                      // path -> mtimeMs:size signature

    function persistOpenDb() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(PERSIST_DB, 1);
            req.onupgradeneeded = function () { req.result.createObjectStore(PERSIST_STORE); };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }
    function mkdirTreeHost(FS, dir) {
        var parts = dir.split("/").filter(Boolean);
        var p = "";
        for (var i = 0; i < parts.length; i++) {
            p += "/" + parts[i];
            try { FS.mkdir(p); } catch (e) { /* EEXIST is fine */ }
        }
    }
    // Restore every persisted file into MEMFS. Runs inside preRun (FS ready,
    // main() held by the loadWine64Fs run dependency). Never rejects — a broken
    // store must not block boot.
    function restorePersistedFiles() {
        if (!PERSIST || typeof indexedDB === "undefined") return Promise.resolve();
        var FS = getFS();
        if (!FS) return Promise.resolve();
        return persistOpenDb().then(function (db) {
            return new Promise(function (resolve) {
                var n = 0, bytes = 0;
                var tx = db.transaction(PERSIST_STORE, "readonly");
                var cur = tx.objectStore(PERSIST_STORE).openCursor();
                cur.onsuccess = function () {
                    var c = cur.result;
                    if (!c) return;
                    var path = String(c.key);
                    var rec = c.value;
                    try {
                        mkdirTreeHost(FS, path.slice(0, path.lastIndexOf("/")));
                        FS.writeFile(path, rec.data);
                        persistManifest[path] = rec.sig;
                        n++; bytes += rec.data.length;
                    } catch (e) {
                        console.warn("persist: restore of " + path + " failed: " + e);
                    }
                    c.continue();
                };
                tx.oncomplete = function () {
                    if (n) console.log("persist: restored " + n + " file(s), " + bytes + " bytes");
                    db.close(); resolve();
                };
                tx.onerror = function () { db.close(); resolve(); };
            });
        }).catch(function (e) { console.warn("persist: restore skipped: " + e); });
    }
    function persistWalk(FS, dir, out) {
        var names;
        try { names = FS.readdir(dir); } catch (e) { return; }
        for (var i = 0; i < names.length; i++) {
            var name = names[i];
            if (name === "." || name === "..") continue;
            if (PERSIST_SKIP[name]) continue;
            var p = dir + "/" + name;
            var st;
            try { st = FS.stat(p); } catch (e) { continue; }
            if (FS.isDir(st.mode)) persistWalk(FS, p, out);
            else if (FS.isFile(st.mode) && st.size <= PERSIST_FILE_CAP) {
                out[p] = (st.mtime && st.mtime.getTime ? st.mtime.getTime() : Number(st.mtime) || 0) + ":" + st.size;
            }
        }
    }
    // One incremental sync of HOME into IndexedDB (changed/new files written,
    // deleted files removed). Cheap when nothing changed: a stat walk + map diff.
    var persistBusy = false;
    function persistTick() {
        if (persistBusy || !PERSIST) return;
        var FS = getFS();
        if (!FS) return;
        var now = {};
        try { persistWalk(FS, HOME_IN_MEMFS, now); } catch (e) { return; }
        var puts = [], dels = [];
        for (var p in now) if (now[p] !== persistManifest[p]) puts.push(p);
        for (var q2 in persistManifest) if (!(q2 in now)) dels.push(q2);
        if (!puts.length && !dels.length) return;
        persistBusy = true;
        persistOpenDb().then(function (db) {
            var tx = db.transaction(PERSIST_STORE, "readwrite");
            var store = tx.objectStore(PERSIST_STORE);
            puts.forEach(function (p) {
                var data = readFileSafe(p);
                if (data === null) return;
                store.put({ data: data, sig: now[p] }, p);
            });
            dels.forEach(function (p) { store.delete(p); });
            tx.oncomplete = function () {
                puts.forEach(function (p) { persistManifest[p] = now[p]; });
                dels.forEach(function (p) { delete persistManifest[p]; });
                console.log("persist: synced " + puts.length + " changed, " + dels.length + " removed");
                db.close(); persistBusy = false;
            };
            tx.onerror = function () { db.close(); persistBusy = false; };
        }).catch(function () { persistBusy = false; });
    }
    function startPersistLoop() {
        if (!PERSIST || typeof indexedDB === "undefined") return;
        // Wait for the session (boot done, guest writing possible), then sync
        // every 5s. A final flush on pagehide is racy (IndexedDB is async), so
        // the interval is the real mechanism; visibilitychange gives one extra
        // early chance when the user switches tabs before closing.
        var armed = false;
        (function poll() {
            if (sessionReady()) {
                if (!armed) {
                    armed = true;
                    setInterval(persistTick, 5000);
                    document.addEventListener("visibilitychange", function () {
                        if (document.visibilityState === "hidden") persistTick();
                    });
                    console.log("persist: sync loop armed (every 5s; ?persist=0 to disable)");
                }
                return;
            }
            setTimeout(poll, 1000);
        })();
    }

    // --- first boot from the page load --------------------------------------
    setStatusText("Loading wine64 (WASM)...");
    window.onerror = function (msg, file, line, col, error) {
        // Surface as much as the browser gives us. Cross-origin / opaque errors
        // arrive as the bare string "Script error." with a null error object —
        // when that happens, say so explicitly instead of a blank console line.
        var detail = (error && error.stack) ? error.stack
                   : (msg && msg !== "Script error.") ? (msg + (file ? " @ " + file + ":" + line + ":" + col : ""))
                   : "opaque error (no detail available — usually a cross-origin script error or a wasm abort logged separately above)";
        setStatusText("Exception: " + (typeof msg === "string" ? msg : "see console"));
        console.error("wine64-launcher window.onerror:", detail, { msg: msg, file: file, line: line, col: col, error: error });
    };
    window.addEventListener("unhandledrejection", function (ev) {
        // A rejected promise in the boot chain (e.g. the rootfs fetch) otherwise
        // shows up only as the vague onerror. Log the real reason.
        console.error("wine64-launcher unhandledrejection:", ev.reason);
        setStatusText("Boot failed: " + (ev.reason && ev.reason.message ? ev.reason.message : ev.reason));
    });
    if (window.setActiveApp) try { window.setActiveApp(PROG || "--version"); } catch (e) {}
    bootWine();
})();
