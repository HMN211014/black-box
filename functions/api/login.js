import { json, dispositivo } from './_util.js';

export async function onRequestPost({ request, env }) {
  const { codigo } = await request.json().catch(() => ({}));
  const db = env.DB, ahora = Date.now();
  const ip = request.headers.get('CF-Connecting-IP') || '?';

  // Freno: máximo 10 códigos equivocados cada 10 minutos desde la misma conexión
  const f = await db.prepare('SELECT COUNT(*) AS n FROM intentos WHERE ip = ?1 AND fecha > ?2').bind(ip, ahora - 600000).first();
  if (f.n >= 10) return json({ error: 'Demasiados intentos. Espera unos minutos.' }, 429);

  const u = codigo ? await db.prepare('SELECT id, nombre, creditos FROM usuarios WHERE codigo = ?1 AND activo = 1').bind(String(codigo).trim()).first() : null;
  if (!u) {
    await db.prepare('INSERT INTO intentos (ip, fecha) VALUES (?1, ?2)').bind(ip, ahora).run();
    return json({ error: 'Código incorrecto.' }, 401);
  }

  const token = crypto.randomUUID() + crypto.randomUUID();
  await db.batch([
    db.prepare('INSERT INTO sesiones (token, usuario_id, expira) VALUES (?1, ?2, ?3)').bind(token, u.id, ahora + 30 * 86400000),
    db.prepare('INSERT INTO accesos (usuario_id, fecha, dispositivo) VALUES (?1, ?2, ?3)').bind(u.id, ahora, dispositivo(request.headers.get('User-Agent') || '')),
    db.prepare('DELETE FROM sesiones WHERE expira < ?1').bind(ahora),
    db.prepare('DELETE FROM intentos WHERE fecha < ?1').bind(ahora - 86400000)
  ]);
  return json({ nombre: u.nombre, creditos: u.creditos }, 200,
    { 'Set-Cookie': `bb=${token}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax` });
}
