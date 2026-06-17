/*! coi-serviceworker v0.1.7 — https://github.com/gzuidhof/coi-serviceworker (MIT)
 *
 * Why it's here: the wasm64-mt build needs SharedArrayBuffer (pthreads/Workers),
 * which browsers only expose to *cross-origin-isolated* pages — i.e. pages served
 * with `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy:
 * require-corp`. GitHub Pages cannot set response headers, so locally we use
 * `node server.mjs` (which DOES set them) but on Pages there's no server hook.
 *
 * This service worker fills that gap entirely client-side: on first load it
 * registers itself and reloads once; thereafter it intercepts every same-origin
 * fetch and re-emits the response with COOP/COEP (and adds CORP: same-origin to
 * subresources) so the page becomes cross-origin-isolated. Because ALL our rootfs
 * assets (including the split wine64.zip parts) are same-origin on Pages, the SW
 * can re-header them and COEP require-corp is satisfied without any cross-origin
 * fetch. Load this BEFORE the Emscripten module script in the page.
 */
/* eslint-disable */
let coepCredentialless = false;
if (typeof window === 'undefined') {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener("message", (ev) => {
        if (!ev.data) {
            return;
        } else if (ev.data.type === "deregister") {
            self.registration
                .unregister()
                .then(() => self.clients.matchAll())
                .then((clients) => clients.forEach((client) => client.navigate(client.url)));
        } else if (ev.data.type === "coepCredentialless") {
            coepCredentialless = ev.data.value;
        }
    });

    self.addEventListener("fetch", function (event) {
        const r = event.request;
        if (r.cache === "only-if-cached" && r.mode !== "same-origin") {
            return;
        }

        const request = (coepCredentialless && r.mode === "no-cors")
            ? new Request(r, { credentials: "omit" })
            : r;
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.status === 0) {
                        return response;
                    }

                    const newHeaders = new Headers(response.headers);
                    newHeaders.set("Cross-Origin-Embedder-Policy",
                        coepCredentialless ? "credentialless" : "require-corp"
                    );
                    if (!coepCredentialless) {
                        newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
                    }
                    newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: newHeaders,
                    });
                })
                .catch((e) => console.error(e))
        );
    });

} else {
    (() => {
        const reloadedBySelf = window.sessionStorage.getItem("coiReloadedBySelf");
        window.sessionStorage.removeItem("coiReloadedBySelf");
        const coepDegrading = (reloadedBySelf == "coepdegrade");

        // You can customize the behavior of this script through a global `coi` variable.
        const coi = {
            shouldRegister: () => !reloadedBySelf,
            shouldDeregister: () => false,
            coepCredentialless: () => true,
            coepDegrade: () => true,
            doReload: () => window.location.reload(),
            quiet: false,
            ...window.coi
        };

        const n = navigator;
        const controlling = n.serviceWorker && n.serviceWorker.controller;

        // Record the failure if the page is served by serviceWorker.
        if (controlling && !window.crossOriginIsolated) {
            window.sessionStorage.setItem("coiCoepHasFailed", "true");
        }
        const coepHasFailed = window.sessionStorage.getItem("coiCoepHasFailed");

        if (controlling) {
            // Reload only on the first failure.
            const reloadToDegrade = coi.coepDegrade() && !(
                coepDegrading || window.crossOriginIsolated
            );
            n.serviceWorker.controller.postMessage({
                type: "coepCredentialless",
                value: (reloadToDegrade || coepHasFailed && coi.coepDegrade())
                    ? false
                    : coi.coepCredentialless(),
            });
            if (reloadToDegrade) {
                !coi.quiet && console.log("Reloading page to degrade COEP.");
                window.sessionStorage.setItem("coiReloadedBySelf", "coepdegrade");
                coi.doReload("coepdegrade");
            }

            if (coi.shouldDeregister()) {
                n.serviceWorker.controller.postMessage({ type: "deregister" });
            }
        }

        // If we're already coi: do nothing. Perhaps it's due to this script doing its job, or COOP/COEP are
        // already set from the origin server. Also if the browser has no notion of crossOriginIsolated, just give up here.
        if (window.crossOriginIsolated !== false || !coi.shouldRegister()) return;

        if (!window.isSecureContext) {
            !coi.quiet && console.log("COOP/COEP Service Worker not registered, a secure context is required.");
            return;
        }

        // In some environments (e.g. Firefox private mode) this won't be available
        if (!n.serviceWorker) {
            !coi.quiet && console.error("COOP/COEP Service Worker not registered, perhaps due to private mode.");
            return;
        }

        n.serviceWorker.register(window.document.currentScript.src).then(
            (registration) => {
                !coi.quiet && console.log("COOP/COEP Service Worker registered", registration.scope);

                registration.addEventListener("updatefound", () => {
                    !coi.quiet && console.log("Reloading page to make use of updated COOP/COEP Service Worker.");
                    window.sessionStorage.setItem("coiReloadedBySelf", "updatefound");
                    coi.doReload();
                });

                // If the registration is active, but it's not controlling the page
                if (registration.active && !n.serviceWorker.controller) {
                    !coi.quiet && console.log("Reloading page to make use of COOP/COEP Service Worker.");
                    window.sessionStorage.setItem("coiReloadedBySelf", "notcontrolling");
                    coi.doReload();
                }
            },
            (err) => {
                !coi.quiet && console.error("COOP/COEP Service Worker failed to register:", err);
            }
        );
    })();
}
