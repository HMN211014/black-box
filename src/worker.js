import { onRequest } from './usuario.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Enrutador maestro para Usuarios, Pedidos y Admin
    if (url.pathname.startsWith('/api/usuario/')) {
      const accion = url.pathname.split('/')[3]; 
      return onRequest({ request, env, params: { accion } });
    }

    // 2. Evitar que /api/catalogo rompa la página (devuelve un script vacío seguro)
    if (url.pathname === '/api/catalogo') {
      return new Response("/* Catálogo externo no configurado */", { 
        headers: { 'Content-Type': 'application/javascript; charset=utf-8' } 
      });
    }

    // 3. Evitar que la Tienda o las compras tiren error 404 y bloqueen el inicio de sesión
    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({}), { 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // 4. Todo lo demás (el index.html, imágenes, css) se carga desde tus archivos subidos
    return env.ASSETS.fetch(request);
  }
};
