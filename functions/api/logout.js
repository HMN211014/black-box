import { json, leerCookie } from './_util.js';

export async function onRequestPost({ request, env }) {
  const t = leerCookie(request, 'bb');
  if (t) await env.DB.prepare('DELETE FROM sesiones WHERE token = ?1').bind(t).run();
  return json({ ok: true }, 200, { 'Set-Cookie': 'bb=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' });
}
