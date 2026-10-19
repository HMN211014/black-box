const CACHE = "blackbox-v4";   // al subir de versión se borran las cachés anteriores (incluida la de /api/usuario/yo)

// Estas dos rutas /api/ son datos públicos de películas: se siguen guardando para verlas sin conexión.
// Cualquier otra ruta /api/ (sesión, datos de la cuenta, pedidos) NUNCA se guarda en caché.
const API_PUBLICAS = ["/api/catalogo", "/api/usuario/extras"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/"])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") && !API_PUBLICAS.includes(url.pathname)) return;   // cuentas y sesión: directo al servidor
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) {                                   // solo se guardan respuestas buenas (no errores 500/404)
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
