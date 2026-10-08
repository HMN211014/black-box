import { json, usuarioActual, noAutorizado } from './_util.js';

export async function onRequestPost(ctx) {
  const u = await usuarioActual(ctx);
  if (!u) return noAutorizado();
  const { plataforma } = await ctx.request.json().catch(() => ({}));
  const db = ctx.env.DB, ahora = Date.now();

  const p = await db.prepare('SELECT id, nombre, precio FROM plataformas WHERE id = ?1 AND activa = 1').bind(String(plataforma || '')).first();
  if (!p) return json({ error: 'Esa plataforma no existe.' }, 404);

  // 1) Cobrar: solo si le alcanzan los créditos (la resta y la comprobación ocurren en una sola instrucción)
  const cobro = await db.prepare('UPDATE usuarios SET creditos = creditos - ?1 WHERE id = ?2 AND creditos >= ?1').bind(p.precio, u.id).run();
  if (!cobro.meta.changes) return json({ error: 'No tienes créditos suficientes.' }, 402);

  // 2) Tomar UNA cuenta disponible y marcarla vendida (también en una sola instrucción: dos compradores nunca reciben la misma)
  const { results } = await db.prepare(
    `UPDATE cuentas SET estado = 'vendida', vendida_a = ?1, vendida_en = ?2
     WHERE id = (SELECT id FROM cuentas WHERE plataforma = ?3 AND estado = 'disponible' ORDER BY id LIMIT 1)
     RETURNING id, correo, clave, perfil`).bind(u.id, ahora, p.id).all();
  const c = results[0];

  if (!c) {   // se agotó justo ahora: se devuelven los créditos
    await db.prepare('UPDATE usuarios SET creditos = creditos + ?1 WHERE id = ?2').bind(p.precio, u.id).run();
    return json({ error: 'Ya no quedan cuentas de ' + p.nombre + '.' }, 409);
  }

  await db.prepare('INSERT INTO compras (usuario_id, cuenta_id, plataforma, precio, fecha) VALUES (?1, ?2, ?3, ?4, ?5)').bind(u.id, c.id, p.id, p.precio, ahora).run();
  const r = await db.prepare('SELECT creditos FROM usuarios WHERE id = ?1').bind(u.id).first();
  return json({ plataforma: p.nombre, correo: c.correo, clave: c.clave, perfil: c.perfil, creditos: r.creditos });
}
