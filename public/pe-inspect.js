// PE / EXE inspector — parses a Windows executable in the tab and reports what
// is inside it. Nothing is uploaded and nothing is executed.
//
// ── Why this is a separate page from /load-exe/ ────────────────────────────
// "inspect" and "run" are different intents. Someone who has downloaded an
// .exe they are unsure about wants to know what it is *before* running it
// anywhere, including here. Serving that with the emulator would be answering
// a question with the thing the question is about.
//
// No dependencies, no Worker, no SharedArrayBuffer: COOP/COEP are deliberately
// absent from the /* catch-all in public/_headers because they broke AdSense,
// so this parses on the main thread off a plain File.arrayBuffer(). Header
// parsing touches a few KB; the only bulk reads are section entropy (sampled)
// and the icon.
(function () {
  "use strict";

  // Same derivation as app.js's private track(): yields app_slug "exe-inspector"
  // here without a hardcoded literal. No runtime field — nothing is emulated.
  function track(name, params) {
    if (typeof window.gtag === "function") {
      var slug = location.pathname.replace(/^\/|\/$/g, "") || "home";
      window.gtag("event", name, Object.assign({ app_slug: slug }, params || {}));
    }
  }

  var esc = function (v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // ── Byte helpers ────────────────────────────────────────────────────────
  function Reader(buf) {
    this.buf = buf;
    this.u8 = new Uint8Array(buf);
    this.dv = new DataView(buf);
    this.size = buf.byteLength;
  }
  Reader.prototype.ok = function (off, len) {
    return off >= 0 && len >= 0 && off + len <= this.size;
  };
  Reader.prototype.u16 = function (off) { return this.ok(off, 2) ? this.dv.getUint16(off, true) : null; };
  Reader.prototype.u32 = function (off) { return this.ok(off, 4) ? this.dv.getUint32(off, true) : null; };
  Reader.prototype.u64 = function (off) {
    if (!this.ok(off, 8)) return null;
    var lo = this.dv.getUint32(off, true), hi = this.dv.getUint32(off + 4, true);
    return hi * 4294967296 + lo;
  };
  // ASCII, NUL-terminated, bounded — an unterminated string in a malformed
  // file must not walk the whole buffer.
  Reader.prototype.strz = function (off, max) {
    if (!this.ok(off, 1)) return null;
    var end = Math.min(this.size, off + (max || 512)), s = "";
    for (var i = off; i < end; i++) {
      var c = this.u8[i];
      if (c === 0) return s;
      s += c >= 32 && c < 127 ? String.fromCharCode(c) : ".";
    }
    return s;
  };
  Reader.prototype.utf16 = function (off, chars) {
    var s = "";
    for (var i = 0; i < chars; i++) {
      var c = this.u16(off + i * 2);
      if (c === null || c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };

  var hex = function (n, w) {
    if (n == null) return "—";
    var s = (n >>> 0).toString(16).toUpperCase();
    while (s.length < (w || 8)) s = "0" + s;
    return "0x" + s;
  };
  var bytes = function (n) {
    if (n == null) return "—";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(2) + " MB";
  };

  // ── Constant tables ─────────────────────────────────────────────────────
  var MACHINE = {
    0x014c: { name: "x86 (32-bit, i386)", arch: "x86" },
    0x0162: { name: "MIPS R3000", arch: "mips" },
    0x0166: { name: "MIPS R4000", arch: "mips" },
    0x01a2: { name: "Hitachi SH3", arch: "sh" },
    0x01a6: { name: "Hitachi SH4", arch: "sh" },
    0x01c0: { name: "ARM (little-endian)", arch: "arm" },
    0x01c2: { name: "ARM or Thumb", arch: "arm" },
    0x01c4: { name: "ARMv7 Thumb-2", arch: "arm" },
    0x0200: { name: "Intel Itanium (IA-64)", arch: "ia64" },
    0x0266: { name: "MIPS16", arch: "mips" },
    0x0ebc: { name: "EFI byte code", arch: "efi" },
    0x5032: { name: "RISC-V 32-bit", arch: "riscv" },
    0x5064: { name: "RISC-V 64-bit", arch: "riscv" },
    0x8664: { name: "x86-64 (64-bit, AMD64)", arch: "x64" },
    0xaa64: { name: "ARM64", arch: "arm64" },
  };

  var SUBSYSTEM = {
    0: "Unknown",
    1: "Native (driver / kernel)",
    2: "Windows GUI",
    3: "Windows console",
    5: "OS/2 console",
    7: "POSIX console",
    9: "Windows CE GUI",
    10: "EFI application",
    11: "EFI boot service driver",
    12: "EFI runtime driver",
    13: "EFI ROM",
    14: "Xbox",
    16: "Windows boot application",
  };

  var DLLCHAR = [
    [0x0020, "High-entropy ASLR"],
    [0x0040, "ASLR (relocatable)"],
    [0x0080, "Forced integrity checks"],
    [0x0100, "DEP compatible"],
    [0x0200, "No isolation"],
    [0x0400, "No structured exception handling"],
    [0x0800, "Do not bind"],
    [0x1000, "AppContainer"],
    [0x2000, "WDM driver"],
    [0x4000, "Control Flow Guard"],
    [0x8000, "Terminal Server aware"],
  ];

  var DIRNAMES = [
    "Export table", "Import table", "Resources", "Exception table",
    "Certificate (signature)", "Base relocations", "Debug", "Architecture",
    "Global pointer", "Thread-local storage", "Load config", "Bound imports",
    "Import address table", "Delay-load imports", ".NET (CLR) header", "Reserved",
  ];

  var RES_TYPES = {
    1: "Cursor", 2: "Bitmap", 3: "Icon", 4: "Menu", 5: "Dialog", 6: "String table",
    7: "Font directory", 8: "Font", 9: "Accelerator", 10: "Raw data (RCDATA)",
    11: "Message table", 12: "Cursor group", 14: "Icon group", 16: "Version info",
    17: "DLG include", 19: "Plug and Play", 20: "VXD", 21: "Animated cursor",
    22: "Animated icon", 23: "HTML", 24: "Side-by-side manifest",
  };

  // ── The parser ──────────────────────────────────────────────────────────
  // Never throws on malformed input: every read is bounds-checked and anything
  // unreadable comes back null, so the report can say "couldn't read this"
  // rather than rendering a blank page.
  function parse(buf) {
    var r = new Reader(buf);
    var out = { size: r.size, warnings: [] };

    if (r.size < 64 || r.u8[0] !== 0x4d || r.u8[1] !== 0x5a) {
      out.format = "not-exe";
      return out;
    }

    // The DOS stub is the one string almost everyone has seen without knowing
    // what it was, and it is still in every Windows binary thirty years on.
    out.dosStub = (function () {
      var scan = Math.min(r.size, 0x200), s = "";
      for (var i = 0; i < scan; i++) {
        var c = r.u8[i];
        s += c >= 32 && c < 127 ? String.fromCharCode(c) : "";
      }
      // The stub message is "$"-terminated. Without that bound the match runs
      // straight on into the printable bytes of the Rich header.
      var m = s.match(/This program [^$]{5,120}/);
      return m ? m[0].trim() : null;
    })();

    // THE TRAP: e_lfanew is only a PE pointer in a file that actually has a PE
    // header. In a plain DOS MZ binary those four bytes are relocation data.
    // public/data/games/lure/Lure.exe reads 0x2C4E0000 there, and a parser that
    // trusts it follows the pointer straight off the end of the buffer.
    var lfanew = r.u32(0x3c);
    out.lfanew = lfanew;
    var sigOk = lfanew != null && lfanew >= 0x40 && r.ok(lfanew, 4);
    var sig = sigOk ? r.u32(lfanew) : null;
    var sig16 = sigOk ? r.u16(lfanew) : null;

    if (!sigOk) { out.format = "dos"; return out; }
    if (sig16 === 0x454e) { out.format = "ne"; return neExtras(r, lfanew, out); }
    if (sig16 === 0x454c || sig16 === 0x584c) { out.format = "le"; return out; }
    if (sig !== 0x00004550) { out.format = "dos"; return out; }
    out.format = "pe";

    // ── COFF file header ──────────────────────────────────────────────────
    var coff = lfanew + 4;
    var machine = r.u16(coff);
    out.machine = machine;
    out.machineInfo = MACHINE[machine] || { name: "Unrecognised (" + hex(machine, 4) + ")", arch: "?" };
    out.numSections = r.u16(coff + 2);
    out.timeDateStamp = r.u32(coff + 4);
    out.sizeOfOptional = r.u16(coff + 16);
    var chars = r.u16(coff + 18) || 0;
    out.characteristics = chars;
    out.isDll = !!(chars & 0x2000);
    out.isSystemFile = !!(chars & 0x1000);
    out.is32BitMachine = !!(chars & 0x0100);

    // ── Optional header ───────────────────────────────────────────────────
    var opt = coff + 20;
    var magic = r.u16(opt);
    out.optMagic = magic;
    var plus = magic === 0x20b;
    out.pe32Plus = plus;
    if (magic !== 0x10b && magic !== 0x20b && magic !== 0x107) {
      out.warnings.push("The optional header magic is " + hex(magic, 4) + ", which is neither PE32 nor PE32+. Everything below it may be unreliable.");
    }
    out.linkerVersion = r.u8[opt + 2] + "." + r.u8[opt + 3];
    out.sizeOfCode = r.u32(opt + 4);
    out.entryPoint = r.u32(opt + 16);
    out.imageBase = plus ? r.u64(opt + 24) : r.u32(opt + 28);
    out.sectionAlignment = r.u32(opt + 32);
    out.fileAlignment = r.u32(opt + 36);
    out.osVersion = r.u16(opt + 40) + "." + r.u16(opt + 42);
    out.subsystemVersion = r.u16(opt + 48) + "." + r.u16(opt + 50);
    out.sizeOfImage = r.u32(opt + 56);
    out.sizeOfHeaders = r.u32(opt + 60);
    out.checksum = r.u32(opt + 64);
    out.subsystem = r.u16(opt + 68);
    out.dllCharacteristics = r.u16(opt + 70) || 0;
    var ddOff = opt + (plus ? 112 : 96);
    out.numRvaAndSizes = r.u32(opt + (plus ? 108 : 92));

    out.dirs = [];
    var dirCount = Math.min(16, out.numRvaAndSizes || 0);
    for (var i = 0; i < dirCount; i++) {
      out.dirs.push({
        name: DIRNAMES[i] || "Directory " + i,
        rva: r.u32(ddOff + i * 8),
        size: r.u32(ddOff + i * 8 + 4),
      });
    }

    // ── Section table ─────────────────────────────────────────────────────
    var secOff = opt + (out.sizeOfOptional || 0);
    out.sections = [];
    var n = Math.min(out.numSections || 0, 96);
    if ((out.numSections || 0) > 96) {
      out.warnings.push("The file declares " + out.numSections + " sections; only the first 96 are listed.");
    }
    for (var s = 0; s < n; s++) {
      var so = secOff + s * 40;
      if (!r.ok(so, 40)) { out.warnings.push("The section table runs past the end of the file."); break; }
      var nm = "";
      for (var j = 0; j < 8; j++) {
        var cc = r.u8[so + j];
        if (cc === 0) break;
        nm += cc >= 32 && cc < 127 ? String.fromCharCode(cc) : ".";
      }
      out.sections.push({
        name: nm || "(unnamed)",
        virtualSize: r.u32(so + 8),
        virtualAddress: r.u32(so + 12),
        rawSize: r.u32(so + 16),
        rawPointer: r.u32(so + 20),
        flags: r.u32(so + 36) || 0,
      });
    }

    // RVA to file offset. Sections can be sparse and out of order, so this
    // walks the table rather than assuming the first one that fits is right.
    function rva2off(rva) {
      if (rva == null) return null;
      for (var k = 0; k < out.sections.length; k++) {
        var sec = out.sections[k];
        var span = Math.max(sec.virtualSize || 0, sec.rawSize || 0);
        if (rva >= sec.virtualAddress && rva < sec.virtualAddress + span) {
          var off = sec.rawPointer + (rva - sec.virtualAddress);
          return r.ok(off, 1) ? off : null;
        }
      }
      // Data living in the headers themselves has RVA === file offset.
      if (rva > 0 && rva < (out.sizeOfHeaders || 0)) return rva;
      return null;
    }

    // ── Entropy, sampled ──────────────────────────────────────────────────
    // A 64 KB window separates compressed or encrypted data (7.8+) from
    // ordinary code (around 6) perfectly well, and it keeps a 40 MB installer
    // responsive instead of hashing the whole thing on the main thread.
    out.sections.forEach(function (sec) {
      sec.entropy = entropy(r.u8, sec.rawPointer, Math.min(sec.rawSize || 0, 65536));
    });

    // ── Overlay: bytes past the last section ──────────────────────────────
    var end = 0;
    out.sections.forEach(function (sec) {
      var e = (sec.rawPointer || 0) + (sec.rawSize || 0);
      if (e > end) end = e;
    });
    // A file shorter than its own headers claim is almost always an
    // incomplete download, and that is worth saying plainly: it is the most
    // common reason an .exe "does nothing" when you double-click it.
    out.truncated = end > r.size ? end - r.size : 0;
    out.overlayStart = end;
    out.overlaySize = end && r.size > end ? r.size - end : 0;
    // Installer payloads live in the overlay. Two different signals: an archive
    // announces itself with a magic number in the first bytes, while a builder
    // toolkit leaves its name somewhere in the first few KB. Searching for the
    // magic anywhere would be worthless — "PK" occurs in any large blob.
    if (out.overlaySize > 0) {
      out.overlayMagic = [r.u8[end], r.u8[end + 1], r.u8[end + 2], r.u8[end + 3],
        r.u8[end + 4], r.u8[end + 5]].map(function (b) { return (b || 0).toString(16); }).join(" ");
      var scan = Math.min(out.overlaySize, 65536), t = "";
      for (var q = 0; q < scan; q++) {
        var ch = r.u8[end + q];
        t += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : " ";
      }
      out.overlayText = t;
      out.overlayHead = t.slice(0, 8);
    } else {
      out.overlayText = "";
      out.overlayHead = "";
    }

    out.imports = readImports(r, out, rva2off, plus);
    out.exportInfo = readExports(r, out, rva2off);
    out.resources = readResources(r, out, rva2off);
    out.dotnet = readClr(r, out, rva2off);
    out.rich = readRich(r, lfanew);

    // The certificate directory is the one whose "VirtualAddress" is a plain
    // file offset rather than an RVA. Running it through rva2off is a classic
    // way to report nonsense.
    var certDir = out.dirs[4];
    out.signature = certDir && certDir.rva ? { offset: certDir.rva, size: certDir.size } : null;

    return out;
  }

  function entropy(u8, off, len) {
    if (!len || off == null || off < 0 || off + len > u8.length) return null;
    var counts = new Uint32Array(256);
    for (var i = 0; i < len; i++) counts[u8[off + i]]++;
    var h = 0;
    for (var b = 0; b < 256; b++) {
      if (!counts[b]) continue;
      var p = counts[b] / len;
      h -= p * (Math.log(p) / Math.LN2);
    }
    return h;
  }

  // A 16-bit Windows New Executable. Worth naming precisely: this is the one
  // class of "it will not open on my PC" file that the 16-bit engine here runs.
  function neExtras(r, off, out) {
    var targetOs = r.u8[off + 0x36];
    out.neTargetOs = { 1: "OS/2", 2: "Windows", 3: "European MS-DOS 4.x", 4: "Windows 386", 5: "BOSS" }[targetOs] || "unidentified";
    out.neIsDll = !!(r.u8[off + 0x0d] & 0x80);
    return out;
  }

  // ── Imports ─────────────────────────────────────────────────────────────
  // The most useful view in the whole report: the DLLs and functions a program
  // asks Windows for are what tell you whether it touches the network, the
  // registry or the filesystem, without running a single instruction of it.
  function readImports(r, out, rva2off, plus) {
    var dir = out.dirs[1];
    if (!dir || !dir.rva) return [];
    var base = rva2off(dir.rva);
    if (base == null) { out.warnings.push("The import table points outside the file."); return []; }

    var dlls = [], step = plus ? 8 : 4;
    for (var i = 0; i < 512; i++) {
      var e = base + i * 20;
      if (!r.ok(e, 20)) break;
      var ilt = r.u32(e), nameRva = r.u32(e + 12), iat = r.u32(e + 16);
      if (!ilt && !nameRva && !iat) break;
      var nameOff = rva2off(nameRva);
      var dllName = nameOff == null ? "(unreadable)" : (r.strz(nameOff, 128) || "(empty)");
      // The original thunk array survives binding; the IAT gets overwritten by
      // the loader, so prefer the former and fall back only when it is absent.
      var thunkRva = ilt || iat, fns = [], truncated = false;
      var tOff = rva2off(thunkRva);
      if (tOff != null) {
        for (var k = 0; k < 4096; k++) {
          var to = tOff + k * step;
          var lo = r.u32(to);
          if (lo == null) break;
          var hi = plus ? r.u32(to + 4) : 0;
          if (!lo && !hi) break;
          if (fns.length >= 256) { truncated = true; break; }
          var isOrdinal = plus ? (hi & 0x80000000) !== 0 : (lo & 0x80000000) !== 0;
          if (isOrdinal) {
            fns.push({ ordinal: lo & 0xffff });
          } else {
            var ho = rva2off(lo);
            fns.push({ name: ho == null ? "(unreadable)" : (r.strz(ho + 2, 192) || "(empty)") });
          }
        }
      }
      dlls.push({ dll: dllName, fns: fns, truncated: truncated, bound: !ilt && !!iat });
    }
    return dlls;
  }

  // ── Exports ─────────────────────────────────────────────────────────────
  function readExports(r, out, rva2off) {
    var dir = out.dirs[0];
    if (!dir || !dir.rva) return null;
    var base = rva2off(dir.rva);
    if (base == null) return null;
    var nameOff = rva2off(r.u32(base + 12));
    var info = {
      name: nameOff == null ? null : r.strz(nameOff, 128),
      ordinalBase: r.u32(base + 16),
      numFunctions: r.u32(base + 20),
      numNames: r.u32(base + 24),
      names: [],
      truncated: false,
    };
    // An EXE can carry an empty export directory. Reporting "0 exported
    // functions" as a finding is noise, so say nothing instead.
    if (!info.numFunctions && !info.numNames && !info.name) return null;

    var namesOff = rva2off(r.u32(base + 32));
    if (namesOff != null) {
      var count = Math.min(info.numNames || 0, 4096);
      for (var i = 0; i < count; i++) {
        if (info.names.length >= 256) { info.truncated = true; break; }
        var no = rva2off(r.u32(namesOff + i * 4));
        if (no == null) continue;
        info.names.push(r.strz(no, 192));
      }
    }
    return info;
  }

  // ── Resources ───────────────────────────────────────────────────────────
  // A three-level tree: type, then name/ID, then language. Only the leaves
  // carry data, and every offset in it is relative to the directory root.
  function readResources(r, out, rva2off) {
    var dir = out.dirs[2];
    if (!dir || !dir.rva) return null;
    var root = rva2off(dir.rva);
    if (root == null) { out.warnings.push("The resource directory points outside the file."); return null; }

    var leaves = [], guard = 0;

    function walk(off, depth, path) {
      if (guard++ > 4000 || depth > 3 || !r.ok(off, 16)) return;
      var named = r.u16(off + 12) || 0, ids = r.u16(off + 14) || 0;
      var total = Math.min(named + ids, 1024);
      for (var i = 0; i < total; i++) {
        var e = off + 16 + i * 8;
        if (!r.ok(e, 8)) return;
        var nameField = r.u32(e), dataField = r.u32(e + 4);
        var id;
        if (nameField & 0x80000000) {
          var so = root + (nameField & 0x7fffffff);
          var len = r.u16(so) || 0;
          id = r.utf16(so + 2, Math.min(len, 64));
        } else {
          id = nameField;
        }
        var next = path.concat([id]);
        if (dataField & 0x80000000) {
          walk(root + (dataField & 0x7fffffff), depth + 1, next);
        } else {
          var leafOff = root + dataField;
          if (!r.ok(leafOff, 16)) continue;
          leaves.push({
            path: next,
            type: next[0],
            id: next[1],
            lang: next[2],
            dataRva: r.u32(leafOff),
            size: r.u32(leafOff + 4),
          });
        }
      }
    }
    walk(root, 1, []);

    var byType = {};
    leaves.forEach(function (l) {
      var label = typeof l.type === "number" ? (RES_TYPES[l.type] || "Type " + l.type) : String(l.type);
      if (!byType[label]) byType[label] = { count: 0, size: 0 };
      byType[label].count++;
      byType[label].size += l.size || 0;
    });

    return {
      leaves: leaves,
      byType: byType,
      version: readVersionInfo(r, leaves, rva2off),
      icon: readIcon(r, leaves, rva2off),
      manifest: readManifest(r, leaves, rva2off),
    };
  }

  // VS_VERSIONINFO: nested length-prefixed blocks, each 4-byte aligned, keys in
  // UTF-16. This is where a program's real publisher and version live, and it
  // is the part most people actually want off an unknown file.
  function readVersionInfo(r, leaves, rva2off) {
    var leaf = leaves.filter(function (l) { return l.type === 16; })[0];
    if (!leaf) return null;
    var off = rva2off(leaf.dataRva);
    if (off == null) return null;
    var limit = Math.min(r.size, off + (leaf.size || 0));
    var fields = {}, fixed = null, guard = 0;

    function align(x) { return (x + 3) & ~3; }

    function block(pos, parentKey) {
      if (guard++ > 4000 || pos + 6 > limit) return limit;
      var len = r.u16(pos), valLen = r.u16(pos + 2), type = r.u16(pos + 4);
      if (!len || pos + len > limit) return limit;
      var keyStart = pos + 6, key = "", i = 0;
      for (; keyStart + i * 2 + 1 < limit && i < 256; i++) {
        var c = r.u16(keyStart + i * 2);
        if (!c) break;
        key += String.fromCharCode(c);
      }
      var valStart = align(keyStart + (i + 1) * 2);

      if (key === "VS_VERSION_INFO" && valLen >= 52 && r.ok(valStart, 52)) {
        var ms = r.u32(valStart + 8), ls = r.u32(valStart + 12);
        var pms = r.u32(valStart + 16), pls = r.u32(valStart + 20);
        fixed = {
          fileVersion: [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff].join("."),
          productVersion: [pms >>> 16, pms & 0xffff, pls >>> 16, pls & 0xffff].join("."),
          fileFlags: r.u32(valStart + 28),
          fileOs: r.u32(valStart + 32),
          fileType: r.u32(valStart + 36),
        };
      } else if (parentKey === "StringTable" && type === 1) {
        // valLen is in characters for text values, bytes for binary ones.
        fields[key] = r.utf16(valStart, Math.min(valLen, 512));
      }

      var childStart = valLen ? align(valStart + (type === 1 ? valLen * 2 : valLen)) : valStart;
      var childKey = key === "StringFileInfo" ? "StringFileInfo"
        : parentKey === "StringFileInfo" ? "StringTable" : key;
      var p = childStart;
      while (p + 6 <= pos + len) {
        var np = block(p, childKey);
        if (np <= p) break;
        p = align(np);
      }
      return pos + len;
    }
    block(off, null);

    if (!fixed && !Object.keys(fields).length) return null;
    return { fixed: fixed, fields: fields };
  }

  // The icon is the single most recognisable thing in the file, and showing it
  // is how a reader confirms in one glance that they have the program they
  // think they have.
  function readIcon(r, leaves, rva2off) {
    var group = leaves.filter(function (l) { return l.type === 14; })[0];
    if (!group) return null;
    var off = rva2off(group.dataRva);
    if (off == null || !r.ok(off, 6)) return null;
    var count = r.u16(off + 4) || 0;
    var best = null;
    for (var i = 0; i < Math.min(count, 64); i++) {
      var e = off + 6 + i * 14;
      if (!r.ok(e, 14)) break;
      var w = r.u8[e] || 256, h = r.u8[e + 1] || 256;
      var bits = r.u16(e + 6) || 0;
      var entry = { w: w, h: h, bits: bits, size: r.u32(e + 8), id: r.u16(e + 12) };
      // Prefer the largest, then the deepest colour — a 16-colour 16px icon
      // next to a 32-bit 256px one is not the one anybody wants to look at.
      if (!best || entry.w * entry.h > best.w * best.h ||
          (entry.w === best.w && entry.bits > best.bits)) best = entry;
    }
    if (!best) return null;

    var img = leaves.filter(function (l) { return l.type === 3 && l.id === best.id; })[0];
    if (!img) return null;
    var imgOff = rva2off(img.dataRva);
    if (imgOff == null || !r.ok(imgOff, img.size || 0)) return null;
    var data = new Uint8Array(r.buf, imgOff, img.size);

    // Vista-era icons store a whole PNG; older ones store a bare DIB. Wrapping
    // the DIB in a one-entry .ico header lets the browser decode it, which is
    // far less code than rendering a 4-bit-palette bitmap by hand.
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
      return { blob: new Blob([data], { type: "image/png" }), w: best.w, h: best.h, bits: best.bits, format: "PNG" };
    }
    var head = new Uint8Array(22);
    var hv = new DataView(head.buffer);
    hv.setUint16(0, 0, true); hv.setUint16(2, 1, true); hv.setUint16(4, 1, true);
    head[6] = best.w >= 256 ? 0 : best.w;
    head[7] = best.h >= 256 ? 0 : best.h;
    head[8] = 0; head[9] = 0;
    hv.setUint16(10, 1, true);
    hv.setUint16(12, best.bits, true);
    hv.setUint32(14, data.length, true);
    hv.setUint32(18, 22, true);
    return { blob: new Blob([head, data], { type: "image/x-icon" }), w: best.w, h: best.h, bits: best.bits, format: "DIB" };
  }

  function readManifest(r, leaves, rva2off) {
    var leaf = leaves.filter(function (l) { return l.type === 24; })[0];
    if (!leaf) return null;
    var off = rva2off(leaf.dataRva);
    if (off == null) return null;
    var text = r.strz(off, Math.min(leaf.size || 0, 8192));
    if (!text) return null;
    var level = text.match(/level\s*=\s*"([^"]+)"/);
    var dpi = /dpiAware/i.test(text);
    var ids = [];
    var re = /name\s*=\s*"(Microsoft\.[^"]+)"/g, m;
    while ((m = re.exec(text)) && ids.length < 8) ids.push(m[1]);
    return { requestedLevel: level ? level[1] : null, dpiAware: dpi, assemblies: ids, size: leaf.size };
  }

  function readClr(r, out, rva2off) {
    var dir = out.dirs[14];
    if (!dir || !dir.rva) return null;
    var off = rva2off(dir.rva);
    if (off == null) return { version: null, flags: null };
    var flags = r.u32(off + 16) || 0;
    return {
      runtime: r.u16(off + 4) + "." + r.u16(off + 6),
      flags: flags,
      ilOnly: !!(flags & 0x1),
      require32Bit: !!(flags & 0x2),
      signed: !!(flags & 0x8),
    };
  }

  // The Rich header is undocumented Microsoft build provenance stamped between
  // the DOS stub and the PE header. Its presence alone is the reliable signal —
  // it means an MSVC-era toolchain — so this reports that and the record count
  // rather than shipping a product-ID table that would go stale.
  function readRich(r, lfanew) {
    var end = Math.min(lfanew, r.size);
    var at = -1;
    for (var i = 0x40; i + 4 <= end; i += 4) {
      if (r.u8[i] === 0x52 && r.u8[i + 1] === 0x69 && r.u8[i + 2] === 0x63 && r.u8[i + 3] === 0x68) { at = i; break; }
    }
    if (at < 0) return null;
    var key = r.u32(at + 4);
    if (key == null) return null;
    // Walk back to the XOR-obscured "DanS" marker that opens the block.
    var start = -1;
    for (var p = at - 4; p >= 0x40; p -= 4) {
      if (((r.u32(p) ^ key) >>> 0) === 0x536e6144) { start = p; break; }
    }
    if (start < 0) return null;
    var records = Math.max(0, Math.floor((at - start - 16) / 8));
    return { records: records, key: hex(key) };
  }

  // ── Interpretation ──────────────────────────────────────────────────────

  var PACKERS = [
    [/^UPX[0-9!]/i, "UPX"],
    [/^\.aspack|^\.adata$/i, "ASPack"],
    [/^\.vmp[0-9]/i, "VMProtect"],
    [/^\.themida|^\.winlice/i, "Themida / WinLicense"],
    [/^\.petite$/i, "Petite"],
    [/^\.mpress/i, "MPRESS"],
    [/^\.nsp[0-9]|^nsp[0-9]/i, "NsPack"],
    [/^\.enigma/i, "Enigma Protector"],
    [/^\.y0da|^\.yP$/i, "yoda's Protector"],
  ];

  // Matched against the FIRST bytes of the overlay only. Searching a 64 KB
  // blob for "PK" would match almost anything; a zip that is the payload of
  // a self-extractor starts at byte zero of the overlay.
  var OVERLAY_MAGIC = [
    [/^PK/, "a self-extracting zip archive"],
    [/^MSCF/, "a Microsoft Cabinet (CAB) payload"],
    [/^Rar!/, "a self-extracting RAR archive"],
    [/^7z/, "a 7-Zip self-extracting archive"],
    [/^MZ/, "a second executable appended to this one"],
  ];
  // Matched anywhere in the first 64 KB: builder toolkits stamp their name
  // into the payload rather than at a fixed offset.
  var OVERLAY_SIGS = [
    ["Nullsoft", "an NSIS installer"],
    ["Inno Setup", "an Inno Setup installer"],
    ["InstallShield", "an InstallShield installer"],
    ["WiseMain", "a Wise installer"],
    ["SFXFolder", "a WinRAR self-extracting archive"],
  ];

  // Capabilities read off the import table. The names are deliberately plain:
  // the reader is usually someone deciding whether to double-click a download,
  // not someone who knows what advapi32 is.
  var CAPS = [
    { label: "Talks to the network", dlls: /^(ws2_32|wsock32|wininet|winhttp|urlmon|dnsapi|netapi32)\.dll$/i },
    { label: "Reads or writes the registry", fns: /^Reg(Open|Create|Set|Delete|Query)/ },
    { label: "Starts other programs", fns: /^(ShellExecute|WinExec|CreateProcess)/ },
    { label: "Reads or writes files", fns: /^(CreateFile|WriteFile|DeleteFile|MoveFile|CopyFile)/ },
    { label: "Uses cryptography", dlls: /^(crypt32|bcrypt|advapi32)\.dll$/i, fns: /^(Crypt|BCrypt)/ },
    { label: "Installs or controls Windows services", fns: /^(OpenSCManager|CreateService|StartService)/ },
    { label: "Writes into other running processes", fns: /^(WriteProcessMemory|CreateRemoteThread|VirtualAllocEx|OpenProcess)/ },
    { label: "Watches the keyboard or mouse globally", fns: /^(SetWindowsHookEx|GetAsyncKeyState|GetKeyboardState)/ },
    { label: "Checks whether it is being debugged", fns: /^(IsDebuggerPresent|CheckRemoteDebuggerPresent|NtQueryInformationProcess)/ },
    { label: "Loads code by name at runtime", fns: /^(LoadLibrary|GetProcAddress)/ },
    { label: "Plays sound", dlls: /^(winmm|dsound|xaudio)/i },
    { label: "Draws with Direct3D or OpenGL", dlls: /^(d3d|ddraw|dxgi|opengl32)/i },
  ];

  function interpret(p) {
    var out = { capabilities: [], packer: null, toolchain: null, installer: null, notes: [] };
    if (p.format !== "pe") return out;

    var dllNames = (p.imports || []).map(function (d) { return (d.dll || "").toLowerCase(); });
    var allFns = [];
    (p.imports || []).forEach(function (d) {
      d.fns.forEach(function (f) { if (f.name) allFns.push(f.name); });
    });

    CAPS.forEach(function (c) {
      var hit = false;
      if (c.dlls) hit = dllNames.some(function (d) { return c.dlls.test(d); });
      if (!hit && c.fns) hit = allFns.some(function (f) { return c.fns.test(f); });
      if (hit) out.capabilities.push(c.label);
    });

    (p.sections || []).forEach(function (s) {
      PACKERS.forEach(function (pk) {
        if (!out.packer && pk[0].test(s.name)) out.packer = pk[1];
      });
    });
    var hiEntropy = (p.sections || []).filter(function (s) {
      return s.entropy != null && s.entropy > 7.2 && (s.rawSize || 0) > 4096;
    });
    if (!out.packer && hiEntropy.length && allFns.length < 40) {
      out.packer = "unidentified (high entropy, very few imports)";
    }

    if (p.dotnet) out.toolchain = ".NET (managed code, CLR " + (p.dotnet.runtime || "?") + ")";
    else if (dllNames.indexOf("msvbvm60.dll") >= 0) out.toolchain = "Visual Basic 6";
    else if (dllNames.some(function (d) { return /^borlndmm|^rtl[0-9]+\.bpl/.test(d); }) ||
             (p.sections || []).some(function (s) { return s.name === "CODE"; })) out.toolchain = "Borland Delphi or C++Builder";
    else if (p.rich) out.toolchain = "Microsoft Visual C++ (linker " + p.linkerVersion + ")";
    // binutils emits COFF long section names as "/<offset>" in the image, and
    // nothing but a GNU toolchain does that.
    else if ((p.sections || []).some(function (s) { return /^\.eh_fram|^\.CRT$|^\/[0-9]+$/.test(s.name); })) out.toolchain = "GCC / MinGW";

    // A toolkit name is the better answer when both fire: "an Inno Setup
    // installer" tells a reader more than "a self-extracting zip archive".
    if (p.overlaySize > 1024) {
      OVERLAY_MAGIC.forEach(function (m) {
        if (!out.installer && m[0].test(p.overlayHead || "")) out.installer = m[1];
      });
      OVERLAY_SIGS.forEach(function (sig) {
        if ((p.overlayText || "").indexOf(sig[0]) >= 0) out.installer = sig[1];
      });
    }
    return out;
  }

  // ── "Would this run on ExeBrowser?" ─────────────────────────────────────
  // The honest version. The runtime here is Wine 1.7.55, 32-bit only, no GPU
  // passthrough and no network, so most of these answers are "no" — and saying
  // so is worth more than a hopeful maybe that wastes a 30 MB download.
  function verdict(p, info) {
    if (p.format === "not-exe") {
      return { kind: "bad", head: "Not a Windows executable", body: "This file does not begin with the <code>MZ</code> marker that every DOS and Windows executable starts with, so there is nothing here to inspect. It may be a renamed archive, a document, or a download that failed partway." };
    }
    if (p.format === "dos") {
      return { kind: "bad", head: "A DOS program, not a Windows one", body: "This is a real-mode MS-DOS executable. The loader on this site is Wine, which runs Windows programs, so it will not start this. DOS software here runs under DOSBox instead — the <a href=\"/run/\">app guides</a> list what is already set up, and <a href=\"/blog/run-16-bit-windows-3x-software/\">the 16-bit write-up</a> explains the split." };
    }
    if (p.format === "ne") {
      return { kind: "partial", head: "16-bit Windows — try the 16-bit engine", body: "This is a New Executable built for " + esc(p.neTargetOs) + ". Modern 64-bit Windows cannot run it at all, which is usually why people end up here. The <strong>Wine 3.1 · 16-bit</strong> option in the engine picker on <a href=\"/load-exe/\">the loader</a> is the one that has a chance with it." };
    }
    if (p.format === "le") {
      return { kind: "bad", head: "A driver or OS/2 binary", body: "This is an LE/LX executable — a virtual device driver or an OS/2 program. Nothing on this site runs these, and neither does modern Windows." };
    }

    var arch = p.machineInfo && p.machineInfo.arch;
    if (arch === "x64") {
      return { kind: "bad", head: "64-bit — the default runtime is 32-bit only", body: "Wine 1.7.55 here is a 32-bit build, so this will not start on it. Many programs still ship a 32-bit release of the same version, and that one often runs fine. There is also an <a href=\"/64/\">experimental 64-bit runtime</a>, though a lot does not render in it yet." };
    }
    if (!p.sections || !p.sections.length) {
      return { kind: "bad", head: "The headers are damaged", body: "The file claims to be a Windows executable but its section table could not be read at all, so there is nothing to load. A download that stopped part-way is the usual cause." };
    }
    if (p.truncated) {
      return { kind: "bad", head: "The file is incomplete", body: "Its own section table describes " + esc(bytes(p.truncated)) + " more data than the file actually contains, so this is a partial copy — a download that stopped early, or a file cut short by the disk it came off. Nothing will run it, here or on Windows. Fetch it again." };
    }
    if (!arch || arch === "?") {
      return { kind: "bad", head: "Unrecognised processor", body: "The COFF header names a machine type this page does not know (" + hex(p.machine, 4) + "). That is either a very unusual target or a header that has been tampered with. Either way the emulator here runs x86 only." };
    }
    if (arch !== "x86") {
      return { kind: "bad", head: "Built for " + esc(p.machineInfo.name), body: "The emulator here is an x86 CPU. Code compiled for a different processor cannot run on it." };
    }
    if (p.dotnet) {
      return { kind: "bad", head: ".NET — needs a runtime Wine 1.7.55 does not have", body: "This is managed code and needs the .NET Framework or .NET Core installed. The Wine build here predates both, so the program will fail at startup rather than run slowly." };
    }
    if (p.subsystem === 1) {
      return { kind: "bad", head: "A kernel driver, not an application", body: "The <em>native</em> subsystem means this loads into the Windows kernel. There is no kernel here to load it into." };
    }
    if (p.subsystem >= 10 && p.subsystem <= 13) {
      return { kind: "bad", head: "An EFI binary", body: "This runs before an operating system does. A browser tab is not the place for it." };
    }

    var caps = info.capabilities;
    var blockers = [];
    if (caps.indexOf("Draws with Direct3D or OpenGL") >= 0) blockers.push("it draws with Direct3D or OpenGL, and there is no GPU passthrough here");
    if (caps.indexOf("Talks to the network") >= 0) blockers.push("it expects a network, and the tab gives it none");
    var modernCrt = (p.imports || []).some(function (d) {
      return /^(vcruntime140|msvcp140|ucrtbase|api-ms-win-crt|msvcr(90|100|110|120))/i.test(d.dll || "");
    });
    if (modernCrt) blockers.push("it needs a Visual C++ runtime that is not part of Windows — load the whole folder, not the lone .exe, so the redistributable DLLs come with it");

    // When the payload dwarfs the program, the useful answer is "this is a
    // wrapper" — the thing the visitor actually wants is inside it, and saying
    // "yes it runs" about the wrapper answers a question they did not ask.
    var wrapper = "";
    if (info.installer && p.overlaySize > p.size * 0.5) {
      wrapper = "<strong>This is a wrapper, not the program.</strong> " +
        esc(bytes(p.overlaySize)) + " of the " + esc(bytes(p.size)) +
        " sits after the executable part, and it looks like " + esc(info.installer) +
        ". Running it here will unpack rather than start the thing you are after — often useful, but " +
        "<a href=\"/run/extract-archive/\">extracting it</a> may get you there faster. ";
    }

    if (blockers.length) {
      return {
        kind: "partial",
        head: "32-bit x86 — worth trying, with caveats",
        body: wrapper + "The architecture is right, so it will at least load. What may stop it: " + blockers.join("; ") + ". " + runLink(),
      };
    }
    return {
      kind: "good",
      head: "32-bit x86 — this is the shape that runs here",
      body: wrapper + "A " + (p.subsystem === 3 ? "console" : "windowed") + " 32-bit Win32 program with no obvious blocker. Expect roughly 10–40% of native speed, because every instruction is emulated. " + runLink(),
    };
  }

  function runLink() {
    return "<a class=\"cta-btn\" id=\"inspect-run-cta\" href=\"/load-exe/\">Try running it →</a>";
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  function rows(pairs) {
    var body = pairs.filter(function (p) { return p; }).map(function (p) {
      return "<tr><th scope=\"row\">" + esc(p[0]) + "</th><td>" + p[1] + "</td></tr>";
    }).join("");
    return "<div class=\"table-wrap\"><table class=\"spec-table\"><tbody>" + body + "</tbody></table></div>";
  }

  function buildDate(ts) {
    if (!ts) return "not recorded";
    var d = new Date(ts * 1000);
    var y = d.getUTCFullYear();
    // Reproducible builds and some linkers put a hash or a constant here, so a
    // value outside the plausible range is reported as such rather than as 1970.
    if (y < 1990 || d.getTime() > Date.now() + 31536000000) {
      return "<span class=\"muted\">" + hex(ts) + " — not a plausible date (reproducible build, or a packer wrote over it)</span>";
    }
    return esc(d.toISOString().slice(0, 10)) + " <span class=\"muted\">(" + esc(String(y)) + ")</span>";
  }

  function flagList(value, table) {
    var on = table.filter(function (f) { return (value & f[0]) !== 0; }).map(function (f) { return esc(f[1]); });
    return on.length ? on.join(", ") : "<span class=\"muted\">none set</span>";
  }

  function sectionFlags(f) {
    var parts = [];
    if (f & 0x20) parts.push("code");
    if (f & 0x40) parts.push("initialised data");
    if (f & 0x80) parts.push("uninitialised data");
    if (f & 0x20000000) parts.push("execute");
    if (f & 0x40000000) parts.push("read");
    if (f & 0x80000000) parts.push("write");
    return parts.join(", ") || "—";
  }

  function render(p, info, file, host) {
    var v = verdict(p, info);
    var html = "";

    // 1 — the answer people came for, above everything else.
    html += "<section class=\"card\">";
    html += "<h3 style=\"margin-top:0\">Can this run in the browser here?</h3>";
    html += "<p><span class=\"verdict " + v.kind + "\">" + esc(v.head) + "</span></p>";
    html += "<p>" + v.body + "</p>";
    html += "</section>";

    // 2 — identity: icon, version-info strings, the headline facts.
    var ver = p.resources && p.resources.version;
    var fields = (ver && ver.fields) || {};
    html += "<section class=\"card\">";
    html += "<h3 style=\"margin-top:0\">What the file says it is</h3>";
    html += "<div id=\"pe-identity\">";
    if (p.resources && p.resources.icon) {
      html += "<p id=\"pe-icon-slot\" class=\"center\"></p>";
    }
    var idRows = [
      ["File name", esc(file.name)],
      ["Size on disk", esc(bytes(file.size))],
      fields.FileDescription ? ["Description", esc(fields.FileDescription)] : null,
      fields.ProductName ? ["Product", esc(fields.ProductName)] : null,
      fields.CompanyName ? ["Company", esc(fields.CompanyName)] : null,
      fields.FileVersion ? ["File version", esc(fields.FileVersion)] : null,
      fields.ProductVersion ? ["Product version", esc(fields.ProductVersion)] : null,
      fields.OriginalFilename ? ["Original file name", esc(fields.OriginalFilename)] : null,
      fields.LegalCopyright ? ["Copyright", esc(fields.LegalCopyright)] : null,
    ];
    html += rows(idRows);
    if (!ver && p.format === "pe") {
      html += "<p class=\"muted small\">This file carries no version resource, so it does not state a publisher, product name or version. That is normal for small tools, compiler output and anything built without a resource script — it is not on its own a red flag.</p>";
    }
    html += "</div></section>";

    if (p.format === "not-exe") { host.innerHTML = html; return v; }

    // 3 — the format facts.
    var fmtLabel = { pe: "PE (32/64-bit Windows)", dos: "MZ (16-bit MS-DOS)", ne: "NE (16-bit Windows)", le: "LE/LX (driver or OS/2)" }[p.format];
    html += "<section class=\"card\">";
    html += "<h3 style=\"margin-top:0\">Format and headers</h3>";
    if (p.format === "pe") {
      html += rows([
        ["Executable format", esc(fmtLabel) + (p.pe32Plus ? " — PE32+" : " — PE32")],
        ["Processor", esc(p.machineInfo.name)],
        ["Kind", p.isDll ? "DLL (a library, not a program you start)" : "Application"],
        ["Subsystem", esc(SUBSYSTEM[p.subsystem] || "Unknown (" + p.subsystem + ")")],
        ["Linked", buildDate(p.timeDateStamp)],
        ["Linker version", esc(p.linkerVersion)],
        ["Minimum Windows", esc(p.subsystemVersion)],
        ["Built with", info.toolchain ? esc(info.toolchain) : "<span class=\"muted\">not identifiable from the headers</span>"],
        ["Compressed or protected", info.packer ? "<strong>" + esc(info.packer) + "</strong>" : "<span class=\"muted\">no packer signature</span>"],
        ["Code signature", p.signature
          ? "present, " + esc(bytes(p.signature.size)) + " <span class=\"muted\">— presence only; the certificate chain cannot be checked in a browser</span>"
          : "<span class=\"muted\">none — the file is unsigned</span>"],
        ["Security flags", flagList(p.dllCharacteristics, DLLCHAR)],
        ["Image base", hex(p.imageBase)],
        ["Entry point", hex(p.entryPoint) + " <span class=\"muted\">(RVA)</span>"],
        ["Header checksum", p.checksum ? hex(p.checksum) : "<span class=\"muted\">0 — not set</span>"],
        p.rich ? ["Rich header", esc(p.rich.records) + " build records, XOR key " + esc(p.rich.key) + " <span class=\"muted\">— undocumented Microsoft toolchain provenance</span>"] : null,
        p.overlaySize ? ["Data after the last section", esc(bytes(p.overlaySize)) + (info.installer ? " — looks like <strong>" + esc(info.installer) + "</strong>" : "") ] : null,
        p.truncated ? ["Missing from the end", "<strong>" + esc(bytes(p.truncated)) + "</strong> <span class=\"muted\">— the file is shorter than its own headers describe</span>"] : null,
        ["DOS stub message", p.dosStub ? esc(p.dosStub) : "<span class=\"muted\">none</span>"],
      ]);
    } else {
      html += rows([
        ["Executable format", esc(fmtLabel)],
        p.format === "ne" ? ["Built for", esc(p.neTargetOs)] : null,
        p.format === "ne" ? ["Kind", p.neIsDll ? "Library" : "Application"] : null,
        ["DOS stub message", p.dosStub ? esc(p.dosStub) : "<span class=\"muted\">none</span>"],
      ]);
      html += "<p class=\"muted small\">Only the PE format carries an import table, sections and resources, so there is nothing further to list for this file.</p>";
    }
    html += "</section>";

    if (p.format !== "pe") { host.innerHTML = html; return v; }

    // 4 — capabilities, with the caveat that makes it honest.
    html += "<section class=\"card\">";
    html += "<h3 style=\"margin-top:0\">What it asks Windows to do</h3>";
    if (info.capabilities.length) {
      html += "<ul>" + info.capabilities.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + "</ul>";
    } else {
      html += "<p class=\"muted\">Nothing recognisable — either the import table is empty or it is hidden behind a packer.</p>";
    }
    html += "<p class=\"muted small\"><strong>Read this before drawing a conclusion.</strong> Every item above is an ordinary Windows API that normal software uses constantly: an updater talks to the network, an installer writes files, a game reads the registry. Seeing them is not evidence of anything. And the reverse is weaker still — a packed or compressed program imports almost nothing until it unpacks itself at runtime, so a short list can mean the file is simple <em>or</em> that it is hiding. This page reads the file; it does not judge it. If you want a verdict on safety, upload it to <a href=\"https://www.virustotal.com/\" target=\"_blank\" rel=\"noopener\">VirusTotal</a>, which runs it past seventy scanners.</p>";
    html += "</section>";

    // 5 — imports, the detail behind the summary above.
    if (p.imports && p.imports.length) {
      html += "<section class=\"card\">";
      html += "<h3 style=\"margin-top:0\">Libraries it loads</h3>";
      html += "<p class=\"muted small\">" + p.imports.length + " " + (p.imports.length === 1 ? "library" : "libraries") + ". Open one to see the individual functions.</p>";
      p.imports.forEach(function (d) {
        html += "<details><summary>" + esc(d.dll) + " <span class=\"muted\">(" + d.fns.length + (d.truncated ? "+" : "") + ")</span></summary>";
        if (d.fns.length) {
          html += "<p style=\"font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;line-height:1.7;word-break:break-word\">" +
            d.fns.map(function (f) { return esc(f.name || "ordinal #" + f.ordinal); }).join(" · ") +
            (d.truncated ? " <span class=\"muted\">… list truncated at 256</span>" : "") + "</p>";
        } else {
          html += "<p class=\"muted\">No readable function names" + (d.bound ? " — this import is bound, so only the address table survives." : ".") + "</p>";
        }
        html += "</details>";
      });
      html += "</section>";
    }

    // 6 — exports, for a DLL.
    if (p.exportInfo) {
      html += "<section class=\"card\">";
      html += "<h3 style=\"margin-top:0\">What it offers to other programs</h3>";
      html += rows([
        ["Internal name", p.exportInfo.name ? esc(p.exportInfo.name) : "<span class=\"muted\">none</span>"],
        ["Exported functions", esc(p.exportInfo.numFunctions) + " (" + esc(p.exportInfo.numNames) + " named)"],
      ]);
      if (p.exportInfo.names.length) {
        html += "<details><summary>Names</summary><p style=\"font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;line-height:1.7;word-break:break-word\">" +
          p.exportInfo.names.map(esc).join(" · ") + (p.exportInfo.truncated ? " <span class=\"muted\">… truncated at 256</span>" : "") + "</p></details>";
      }
      html += "</section>";
    }

    // 7 — sections, with entropy doing real work.
    if (p.sections && p.sections.length) {
      html += "<section class=\"card\">";
      html += "<h3 style=\"margin-top:0\">How the file is laid out</h3>";
      html += "<div class=\"table-wrap\"><table class=\"compat-table\"><thead><tr>" +
        "<th>Section</th><th>Virtual size</th><th>On disk</th><th>Address</th><th>Permissions</th><th>Entropy</th>" +
        "</tr></thead><tbody>";
      p.sections.forEach(function (s) {
        var ent = s.entropy == null ? "—" : s.entropy.toFixed(2);
        var hot = s.entropy != null && s.entropy > 7.2;
        html += "<tr><td><code>" + esc(s.name) + "</code></td><td>" + esc(bytes(s.virtualSize)) + "</td><td>" +
          esc(bytes(s.rawSize)) + "</td><td>" + hex(s.virtualAddress) + "</td><td>" + esc(sectionFlags(s.flags)) +
          "</td><td" + (hot ? " style=\"color:var(--warn)\"" : "") + ">" + ent + "</td></tr>";
      });
      html += "</tbody></table></div>";
      html += "<p class=\"muted small\">Entropy is how random the bytes look, from 0 to 8. Ordinary compiled code sits around 6. Above about 7.2 the data is compressed or encrypted — normal in a section holding a zip or a PNG, and a strong hint of a packer when it is the section the program executes from.</p>";
      html += "</section>";
    }

    // 8 — resources.
    var res = p.resources;
    if (res && res.leaves.length) {
      html += "<section class=\"card\">";
      html += "<h3 style=\"margin-top:0\">Resources bundled inside</h3>";
      var typeRows = Object.keys(res.byType).sort().map(function (k) {
        return [k, res.byType[k].count + " × <span class=\"muted\">" + esc(bytes(res.byType[k].size)) + "</span>"];
      });
      html += rows(typeRows);
      if (res.manifest) {
        html += "<p>The side-by-side manifest asks to run as <code>" + esc(res.manifest.requestedLevel || "asInvoker") + "</code>" +
          (res.manifest.requestedLevel === "requireAdministrator" ? " — that is the UAC prompt you would see on Windows" : "") +
          (res.manifest.dpiAware ? ", and declares itself DPI-aware" : "") + ".</p>";
      }
      html += "</section>";
    }

    // 9 — the full version-info string table, for anyone who wants all of it.
    if (ver && (ver.fixed || Object.keys(fields).length)) {
      html += "<section class=\"card\">";
      html += "<h3 style=\"margin-top:0\">Version resource, in full</h3>";
      var vr = [];
      if (ver.fixed) {
        vr.push(["Binary file version", esc(ver.fixed.fileVersion)]);
        vr.push(["Binary product version", esc(ver.fixed.productVersion)]);
      }
      Object.keys(fields).sort().forEach(function (k) { vr.push([k, esc(fields[k])]); });
      html += rows(vr);
      html += "</section>";
    }

    // 10 — data directories, last because it is the most technical.
    if (p.dirs && p.dirs.length) {
      html += "<section class=\"card\">";
      html += "<h3 style=\"margin-top:0\">Data directories</h3>";
      html += "<details><summary>Show all " + p.dirs.length + "</summary><div class=\"table-wrap\"><table class=\"compat-table\"><thead><tr><th>Directory</th><th>Address</th><th>Size</th></tr></thead><tbody>";
      p.dirs.forEach(function (d) {
        html += "<tr><td>" + esc(d.name) + "</td><td>" + (d.rva ? hex(d.rva) : "<span class=\"muted\">—</span>") +
          "</td><td>" + (d.size ? esc(bytes(d.size)) : "<span class=\"muted\">—</span>") + "</td></tr>";
      });
      html += "</tbody></table></div></details></section>";
    }

    if (p.warnings.length) {
      html += "<section class=\"card\"><h3 style=\"margin-top:0\">Things that did not parse cleanly</h3><ul>" +
        p.warnings.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul>" +
        "<p class=\"muted small\">Malformed headers are common in packed, patched or truncated files, and do not by themselves mean the file is broken.</p></section>";
    }

    host.innerHTML = html;

    // The icon goes in after the HTML is live: it is the one piece that needs
    // an object URL rather than a string.
    if (res && res.icon) {
      var slot = host.querySelector("#pe-icon-slot");
      if (slot) {
        var img = new Image();
        img.alt = "Icon embedded in " + file.name;
        img.width = Math.min(res.icon.w, 128);
        img.style.cssText = "image-rendering:pixelated;border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--bg-elev)";
        img.src = URL.createObjectURL(res.icon.blob);
        img.onload = function () { URL.revokeObjectURL(img.src); };
        // A DIB the browser declines to decode must not leave a broken image.
        img.onerror = function () { slot.remove(); };
        slot.appendChild(img);
        slot.insertAdjacentHTML("beforeend",
          "<br /><span class=\"muted small\">" + res.icon.w + "×" + res.icon.h + ", " + res.icon.bits + "-bit " + res.icon.format + "</span>");
        track("inspect_icon_extract", { icon_format: res.icon.format, icon_size: res.icon.w });
      }
    }
    var cta = host.querySelector("#inspect-run-cta");
    if (cta) {
      cta.addEventListener("click", function () {
        track("inspect_verdict_click", { verdict: v.kind, arch: (p.machineInfo && p.machineInfo.arch) || p.format });
      });
    }
    return v;
  }

  // ── Wiring ──────────────────────────────────────────────────────────────

  var MAX_BYTES = 256 * 1024 * 1024;

  function sizeBucket(n) {
    if (n < 102400) return "under_100kb";
    if (n < 1048576) return "under_1mb";
    if (n < 10485760) return "under_10mb";
    if (n < 104857600) return "under_100mb";
    return "over_100mb";
  }

  function boot() {
    var zone = document.getElementById("pe-dropzone");
    var input = document.getElementById("pe-file");
    var pick = document.getElementById("pe-pick");
    var status = document.getElementById("pe-status");
    var host = document.getElementById("pe-report");
    if (!zone || !input || !host) return;

    function say(msg, cls) {
      if (status) status.innerHTML = "<span class=\"" + (cls || "muted") + "\">" + msg + "</span>";
    }

    function handle(file) {
      if (!file) return;
      host.innerHTML = "";
      if (file.size > MAX_BYTES) {
        say("That file is " + esc(bytes(file.size)) + ". This page reads the whole thing into memory, so it stops at 256 MB.", "bad");
        track("inspect_parse_error", { reason: "too_large", size_bucket: sizeBucket(file.size) });
        return;
      }
      say("Reading " + esc(file.name) + "…");
      file.arrayBuffer().then(function (buf) {
        var parsed, info;
        try {
          parsed = parse(buf);
          info = interpret(parsed);
        } catch (err) {
          // A crash here is a bug in this parser, not a problem with the file,
          // and it should say so rather than blaming the user's download.
          say("Something in this file broke the parser. That is a bug here, not necessarily a problem with the file — <a href=\"/contact/\">tell us</a> what it was and we will fix it.", "bad");
          track("inspect_parse_error", { reason: "exception", size_bucket: sizeBucket(file.size) });
          if (window.console) console.error("[pe-inspect]", err);
          return;
        }
        var v = render(parsed, info, file, host);
        say("Read " + esc(file.name) + " — " + esc(bytes(file.size)) + ". Nothing left this page.");
        track("inspect_file", {
          format: parsed.format,
          arch: (parsed.machineInfo && parsed.machineInfo.arch) || "n/a",
          subsystem: parsed.subsystem == null ? "n/a" : String(parsed.subsystem),
          is_dotnet: parsed.dotnet ? 1 : 0,
          signed: parsed.signature ? 1 : 0,
          packed: info.packer ? 1 : 0,
          verdict: v.kind,
          size_bucket: sizeBucket(file.size),
        });
        host.scrollIntoView({ behavior: "smooth", block: "start" });
        // Reading a file is the strongest signal this page can produce that
        // the visitor got what they came for.
        if (window.ExeInstall && window.ExeInstall.engaged) window.ExeInstall.engaged("inspect");
      }).catch(function () {
        say("The browser could not read that file. If it came from a network drive or a phone, try copying it locally first.", "bad");
        track("inspect_parse_error", { reason: "read_failed", size_bucket: sizeBucket(file.size) });
      });
    }

    input.addEventListener("change", function () { handle(input.files && input.files[0]); });
    if (pick) pick.addEventListener("click", function (e) { e.preventDefault(); input.click(); });
    zone.addEventListener("click", function () { input.click(); });
    zone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });
    zone.addEventListener("dragover", function (e) { e.preventDefault(); zone.classList.add("hover"); });
    zone.addEventListener("dragleave", function () { zone.classList.remove("hover"); });
    zone.addEventListener("drop", function (e) {
      e.preventDefault();
      zone.classList.remove("hover");
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) handle(dt.files[0]);
    });
  }

  // Exposed the way save-core.js exposes SaveCore: it is what makes the parser
  // testable outside a browser, and the page itself is the only caller.
  window.PEInspect = { parse: parse, interpret: interpret, verdict: verdict };

  if (typeof document === "undefined") return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
