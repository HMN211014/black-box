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

      // Cualquier otra ruta /api/ no existe en este servidor: se avisa claramente en lugar de responder "{}" con éxito
      if (url.pathname.startsWith('/api/')) {
        return new Response(JSON.stringify({ error: 'Esta función no está disponible en el servidor.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
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
