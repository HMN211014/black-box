// Funciones de ayuda compartidas por la API (no es una ruta).
export const json = (o, status = 200, headers = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export const dispositivo = (ua = '') => /iPhone|iPad|iPod/i.test(ua) ? 'iPhone' : /Android/i.test(ua) ? 'Android' : 'Otro';

export const leerCookie = (req, nombre) =>
  (req.headers.get('Cookie') || '').split(/;\s*/).map(c => c.split('=')).find(c => c[0] === nombre)?.[1];

export async function usuarioActual({ request, env }) {
  const t = leerCookie(request, 'bb');
  if (!t) return null;
  return await env.DB.prepare(
    `SELECT u.id, u.nombre, u.creditos FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token = ?1 AND s.expira > ?2 AND u.activo = 1`).bind(t, Date.now()).first();
}
export const noAutorizado = () => json({ error: 'Sesión no válida. Entra de nuevo.' }, 401);
