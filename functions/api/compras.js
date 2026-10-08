import { json, usuarioActual, noAutorizado } from './_util.js';

// "Mis cuentas": todo lo que ha comprado quien entró con su código (se conserva para siempre).
export async function onRequestGet(ctx) {
  const u = await usuarioActual(ctx);
  if (!u) return noAutorizado();
  const { results } = await ctx.env.DB.prepare(
    `SELECT co.fecha, p.nombre AS plataforma_nombre, c.correo, c.clave, c.perfil
     FROM compras co JOIN cuentas c ON c.id = co.cuenta_id JOIN plataformas p ON p.id = co.plataforma
     WHERE co.usuario_id = ?1 ORDER BY co.id DESC LIMIT 100`).bind(u.id).all();
  return json({ compras: results });
}
