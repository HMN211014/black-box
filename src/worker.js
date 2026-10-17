/* Punto de entrada del Worker de Black BOX.
   - /api/usuario/...  -> cuentas, planes, pedidos y panel (src/usuario.js)
   - todo lo demás      -> tus archivos de siempre (index.html, plataformas.js, etc.) */
import { onRequest as usuario } from './usuario.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/api\/usuario\/([\w-]+)\/?$/);
    if (m) return usuario({ request, env, params: { accion: m[1] } });
    return env.ASSETS.fetch(request);
  },
};
