import { onRequest } from './usuario.js';

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith('/api/usuario/')) {
        const accion = url.pathname.split('/')[3]; 
        return await onRequest({ request, env, params: { accion } });
      }
      if (url.pathname.startsWith('/api/admin')) {
        return await onRequest({ request, env, params: { accion: 'admin' } });
      }

      if (url.pathname === '/api/catalogo') {
        return new Response("/* Catálogo externo no configurado */", { 
          headers: { 'Content-Type': 'application/javascript; charset=utf-8' } 
        });
      }

      if (url.pathname.startsWith('/api/')) {
        return new Response(JSON.stringify({}), { 
          headers: { 'Content-Type': 'application/json' } 
        });
      }

      return env.ASSETS.fetch(request);
      
    } catch (error) {
      return new Response(JSON.stringify({ error: "Error del servidor: " + error.message }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
  }
};
