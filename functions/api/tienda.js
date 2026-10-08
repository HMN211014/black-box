import { json, usuarioActual, noAutorizado } from './_util.js';

// Devuelve los créditos de quien entró y, por cada plataforma, cuántas cuentas quedan disponibles.
export async function onRequestGet(ctx) {
  const u = await usuarioActual(ctx);
  if (!u) return noAutorizado();
  const { results } = await ctx.env.DB.prepare(
    `SELECT p.id, p.nombre, p.precio,
            (SELECT COUNT(*) FROM cuentas c WHERE c.plataforma = p.id AND c.estado = 'disponible') AS disponibles
     FROM plataformas p WHERE p.activa = 1 ORDER BY p.orden, p.nombre`).all();
  return json({ creditos: u.creditos, plataformas: results });
}
