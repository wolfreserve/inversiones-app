// Guarda la app en el teléfono para que abra sin internet.
// Red primero: así cada actualización mensual de data.json llega en cuanto hay conexión.
const VERSION = "inversiones-v8";
const ARCHIVOS = ["./", "./index.html", "./app.css", "./app.js", "./engine.js", "./data.json", "./manifest.webmanifest",
  "./iconos/icono-192.png", "./iconos/icono-512.png", "./iconos/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const clave = url.pathname.endsWith("data.json") ? "./data.json" : e.request;
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(clave, copia)); return r; })
      .catch(() => caches.match(clave).then((r) => r || caches.match("./index.html")))
  );
});
