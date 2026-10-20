const CACHE = "blackbox-v5";
const IMGS = "blackbox-img-v1";   // pósters y fotos de TMDB: se guardan para que la segunda vez salgan al instante
const MAX_IMGS = 800;
let puestas = 0;   // al subir de versión se borran las cachés anteriores (incluida la de /api/usuario/yo)

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
      Promise.all(keys.filter((k) => k !== CACHE && k !== IMGS).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});
async function imagen(req) {
  const c = await caches.open(IMGS);
  const guardada = await c.match(req.url);
  if (guardada) return guardada;
  try {
    const r = await fetch(req.url, { mode: "cors", credentials: "omit" });   // TMDB permite CORS: sirve tanto para <img> como para canvas
    if (r.ok) {
      c.put(req.url, r.clone());
      if (++puestas % 25 === 0) c.keys().then((ks) => { if (ks.length > MAX_IMGS) ks.slice(0, ks.length - MAX_IMGS).forEach((k) => c.delete(k)); });
    }
    return r;
  } catch (_) { return fetch(req); }
}
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === "GET" && url.hostname === "image.tmdb.org") { e.respondWith(imagen(e.request)); return; }
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
