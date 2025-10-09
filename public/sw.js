// Very small offline cache for app shell
const CACHE = "nback-cache-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest"
  // 빌드 출력물(e.g., /assets/index-xxxxx.js, /assets/index-xxxxx.css)은 빌드시 추가
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE && caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match("/index.html")))
  );
});