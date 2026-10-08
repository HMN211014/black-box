import { json, usuarioActual, noAutorizado } from './_util.js';

export async function onRequestGet(ctx) {
  const u = await usuarioActual(ctx);
  return u ? json({ nombre: u.nombre, creditos: u.creditos }) : noAutorizado();
}
