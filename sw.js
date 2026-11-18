// SpectroLink Web · Service Worker
// 目的：首次联网加载后把运行时与线表留在本地缓存，之后即使弱网、断网、换网络，
// 再次打开也直接从本地读，不再依赖任何远端。
//
// 策略：运行时缓存（cache-first + 后台回填），而不是 install 时预取全部 23 MB ——
// 预取会在首屏之外再占用一份带宽，而用户真正用到的只有当前谱区的线表。

const VERSION = "v1";
const CACHE = `spectrolink-web-${VERSION}`;

// 这些路径永远走网络优先：站点入口与清单必须是最新的，否则升级后仍用旧 SW 缓存
const NETWORK_FIRST = ["/", "/index.html", "/data/manifest.json"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 只缓存同源，第三方一律直连

  const networkFirst = NETWORK_FIRST.some((p) => url.pathname === p) ||
    url.pathname.endsWith("/");

  if (networkFirst) {
    event.respondWith(
      fetch(req).then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return resp;
      }).catch(() => caches.match(req).then((hit) => hit || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return resp;
      });
    })
  );
});
