import { onRequest } from '../usuario.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Si la petición web es para la API (como el panel de admin o el inicio de sesión)
    if (url.pathname.startsWith('/api/usuario/')) {
      // Extrae la acción solicitada (ej. 'admin', 'entrar', 'yo', 'pedidos')
      const accion = url.pathname.split('/')[3]; 
      
      // Envía la petición a tu archivo usuario.js
      return onRequest({ request, env, params: { accion } });
    }

    // Para todo el resto de tu página web (archivos HTML como admin.html, CSS, imágenes)
    return env.ASSETS.fetch(request);
  }
};
