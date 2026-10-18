/* Cuentas de usuario (correo + contraseña), tiempo de acceso y códigos canjeables para Black BOX.
   Ruta:  /api/usuario/registro | entrar | salir | yo | datos | canjear | pedir | pedidos | extras | admin
   Necesita:
     - un KV de Cloudflare enlazado con el nombre  USUARIOS
     - una variable de entorno  ADMIN_CLAVE  (tu clave para generar códigos; solo se usa en /admin.html) */

const enc = new TextEncoder();
const SESION_DIAS = 30;
const PRUEBA_DIAS = 0;               // días de prueba gratis al crear una cuenta (0 = sin prueba)
const DIA = 86400000;
const PLANES_OK = ['basico', 'plus', 'pedidos'];
const LETRAS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';   // sin 0/O/1/I/L para que no se confundan

const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
});
const b64 = buf => { let s = ''; new Uint8Array(buf).forEach(c => (s += String.fromCharCode(c))); return btoa(s); };
const deb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = buf => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hashClave(clave, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(clave), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256));
}
function iguales(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
async function mismaClave(a, b) {          // compara dos textos sin revelar en qué letra difieren
  const ha = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(a)));
  const hb = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(b)));
  return iguales(ha, hb);
}
const cookieSesion = (token, dias) =>
  `bb_sesion=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.round(dias * 86400)}`;

/* ---- Tiempo de acceso de cada cuenta: { vence: <fecha en ms>, plan: 'basico' | 'plus' } ---- */
async function accesoDe(kv, correo) {
  const a = (await kv.get('a:' + correo, 'json')) || {};
  const vence = a.vence || 0;
  return { vence, plan: a.plan || null, activo: vence > Date.now() };
}
async function sumarDias(kv, correo, dias, plan) {
  const antes = await accesoDe(kv, correo);
  const base = Math.max(Date.now(), antes.vence);
  const rango = { pedidos: 0, basico: 1, plus: 2 };
  const nuevo = PLANES_OK.includes(plan) ? plan : 'basico';
  const nuevoPlan = antes.activo && (rango[antes.plan] ?? 0) > rango[nuevo] ? antes.plan : nuevo;   // un plan superior que sigue activo no baja de nivel
  await kv.put('a:' + correo, JSON.stringify({ vence: base + dias * DIA, plan: nuevoPlan }));
  return accesoDe(kv, correo);
}

/* AQUÍ ESTÁ INTEGRADO EL LÍMITE DE PANTALLAS SIMULTÁNEAS */
async function crearSesion(kv, correo) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  
  // NUEVO: Obtener el plan del usuario para saber su límite de pantallas
  const acceso = await accesoDe(kv, correo);
  // Si el plan es 'plus', permite 3. Cualquier otro plan (básico, pedidos), permite 1.
  const limitePantallas = (acceso.plan === 'plus') ? 3 : 1;
  
  // 1. Obtener la lista de dispositivos (tokens) activos de esta cuenta
  let tokens = (await kv.get('t:' + correo, 'json')) || [];
  
  // 2. Agregar el nuevo dispositivo
  tokens.push(token);
  
  // 3. Borrar las sesiones más viejas si supera el límite de su plan
  while (tokens.length > limitePantallas) {
    const viejo = tokens.shift();
    await kv.delete('s:' + viejo);
  }
  
  // 4. Guardar los cambios en la base de datos
  await kv.put('t:' + correo, JSON.stringify(tokens));
  await kv.put('s:' + token, correo, { expirationTtl: SESION_DIAS * 86400 });
  
  return token;
}

function tokenDe(request) {
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)bb_sesion=([\w-]+)/);
  return m ? m[1] : null;
}
async function correoDeSesion(request, kv) {
  const t = tokenDe(request);
  return t ? await kv.get('s:' + t) : null;
}

/* ---- Códigos:  BB-XXXX-XXXX ---- */
function nuevoCodigo() {
  const r = crypto.getRandomValues(new Uint8Array(8));
  const t = Array.from(r, n => LETRAS[n % LETRAS.length]).join('');
  return 'BB-' + t.slice(0, 4) + '-' + t.slice(4);
}
function normalizarCodigo(x) {
  const raw = String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 10 || !raw.startsWith('BB')) return null;
  return 'BB-' + raw.slice(2, 6) + '-' + raw.slice(6);
}

/* ---- Lista de películas permitidas por cuenta (para el plan "Películas por pedido") ---- */
async function listaDe(kv, correo) {
  const l = await kv.get('l:' + correo, 'json');
  return (l && l.items ? l.items : []).map(x => ({ t: x.t, id: x.id || null }));
}
async function estadoDe(kv, correo) {
  return { acceso: await accesoDe(kv, correo), lista: await listaDe(kv, correo) };
}
const PLANES_CON_PEDIDOS = ['plus', 'pedidos'];
async function pedidosDe(kv, correo) {        // pedidos de una cuenta (o de todas si no se da correo)
  const out = []; let cursor;
  do {
    const r = await kv.list({ prefix: 'q:', limit: 1000, cursor });
    for (const k of r.keys) if (k.metadata && (!correo || k.metadata.correo === correo)) out.push({ id: k.name.slice(2), ...k.metadata });
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor && out.length < 3000);
  return out;
}
async function guardarPedido(kv, ped) {
  await kv.put('q:' + ped.id, JSON.stringify(ped), { metadata: ped });
}

/* Agrega una película a la lista de una cuenta y, si viene de un pedido, lo marca como listo */
async function asignarLista(kv, correo, titulo, tmdb, pedidoId) {
  if (!titulo) return { error: 'Escribe el título tal como está en el catálogo.', status: 400 };
  if (!correo || !(await kv.get('u:' + correo))) return { error: 'Ese correo no tiene cuenta.', status: 404 };
  const l = (await kv.get('l:' + correo, 'json')) || { items: [] };
  if (!l.items.some(x => x.t === titulo)) l.items.push({ t: titulo, id: tmdb || null, f: Date.now() });
  if (l.items.length > 500) return { error: 'La lista de esa cuenta ya es muy larga.', status: 400 };
  await kv.put('l:' + correo, JSON.stringify(l));
  if (pedidoId) {
    const q = await kv.get('q:' + String(pedidoId), 'json');
    if (q && q.correo === correo) { q.estado = 'listo'; q.listo = Date.now(); await guardarPedido(kv, q); }
  }
  return { ok: true, lista: await listaDe(kv, correo) };
}

export async function onRequest({ request, env, params }) {
  const kv = env.USUARIOS;

  /* Películas publicadas desde el panel */
  if (params.accion === 'extras' && request.method === 'GET') {
    let items = [];
    try { const x = kv && await kv.get('x:catalogo', 'json'); if (x && x.items) items = x.items.map(i => ({ titulo: i.titulo, tmdb: i.tmdb, link: i.link })); } catch (e) {}
    const js = 'window.PELICULAS_EXTRA=' + JSON.stringify(items).replace(/</g, '\\u003c') + ';';
    return new Response(js, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=30' } });
  }

  if (!kv) return json({ error: 'El servicio de cuentas no está configurado todavía.' }, 503);

  const accion = params.accion;
  const esPost = request.method === 'POST';

  const origen = request.headers.get('Origin');
  if (esPost && origen) {
    let ok = false; try { ok = new URL(origen).host === new URL(request.url).host; } catch (e) {}
    if (!ok) return json({ error: 'Solicitud no permitida.' }, 403);
  }

  let cuerpo = {};
  if (esPost) { try { cuerpo = await request.json(); } catch (e) { return json({ error: 'Solicitud no válida.' }, 400); } }

  /* ---- Crear cuenta ---- */
  if (accion === 'registro' && esPost) {
    const correo = String(cuerpo.correo || '').trim().toLowerCase();
    const clave = String(cuerpo.clave || '');
    if (correo.length > 254 || !/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(correo)) return json({ error: 'Escribe un correo válido.' }, 400);
    if (clave.length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400);
    if (clave.length > 200) return json({ error: 'La contraseña es demasiado larga.' }, 400);
    if (await kv.get('u:' + correo)) return json({ error: 'Ese correo ya tiene una cuenta. Inicia sesión.' }, 409);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashClave(clave, salt);
    await kv.put('u:' + correo, JSON.stringify({ salt: b64(salt), hash: b64(hash), creado: Date.now() }));
    if (PRUEBA_DIAS > 0) await sumarDias(kv, correo, PRUEBA_DIAS, 'basico');
    const token = await crearSesion(kv, correo);
    return json({ correo, ...(await estadoDe(kv, correo)) }, 200, { 'Set-Cookie': cookieSesion(token, SESION_DIAS) });
  }

  /* ---- Iniciar sesión ---- */
  if (accion === 'entrar' && esPost) {
    const correo = String(cuerpo.correo || '').trim().toLowerCase();
    const clave = String(cuerpo.clave || '');
    if (!correo || !clave || clave.length > 200) return json({ error: 'Correo o contraseña incorrectos.' }, 401);

    const kFallos = 'f:' + correo;
    const fallos = parseInt((await kv.get(kFallos)) || '0', 10);
    if (fallos >= 8) return json({ error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }, 429);

    const u = await kv.get('u:' + correo, 'json');
    let ok = false;
    if (u) ok = iguales(await hashClave(clave, deb64(u.salt)), deb64(u.hash));
    else await hashClave(clave, new Uint8Array(16));           // mismo tiempo de respuesta exista o no la cuenta
    if (!ok) {
      await kv.put(kFallos, String(fallos + 1), { expirationTtl: 900 });
      return json({ error: 'Correo o contraseña incorrectos.' }, 401);
    }
    if (fallos) await kv.delete(kFallos);
    const token = await crearSesion(kv, correo);
    return json({ correo, ...(await estadoDe(kv, correo)) }, 200, { 'Set-Cookie': cookieSesion(token, SESION_DIAS) });
  }

  /* ---- Cerrar sesión ---- */
  if (accion === 'salir' && esPost) {
    const t = tokenDe(request);
    if (t) {
      const correo = await kv.get('s:' + t);
      await kv.delete('s:' + t);
      if (correo) { // Quitarlo también de la lista de dispositivos
        let tokens = (await kv.get('t:' + correo, 'json')) || [];
        tokens = tokens.filter(tok => tok !== t);
        if (tokens.length) await kv.put('t:' + correo, JSON.stringify(tokens));
        else await kv.delete('t:' + correo);
      }
    }
    return json({ ok: true }, 200, { 'Set-Cookie': cookieSesion('', 0) });
  }

  /* ---- Estado ---- */
  if (accion === 'yo' && request.method === 'GET') {
    const correo = await correoDeSesion(request, kv);
    if (!correo) return json({ servicio: true, correo: '' });
    return json({ servicio: true, correo, ...(await estadoDe(kv, correo)) });
  }

  /* ---- Datos de la cuenta ---- */
  if (accion === 'datos') {
    const correo = await correoDeSesion(request, kv);
    if (!correo) return json({ error: 'Sin sesión.' }, 401);

    if (request.method === 'GET') {
      const d = await kv.get('d:' + correo, 'json');
      return json({ datos: d ? d.datos : { prog: {}, vis: {} } });
    }
    if (esPost) {
      const d = cuerpo.datos;
      if (!d || typeof d !== 'object' || Array.isArray(d)) return json({ error: 'Datos no válidos.' }, 400);
      const limpio = {
        prog: d.prog && typeof d.prog === 'object' && !Array.isArray(d.prog) ? d.prog : {},
        vis: d.vis && typeof d.vis === 'object' && !Array.isArray(d.vis) ? d.vis : {},
      };
      const texto = JSON.stringify({ datos: limpio, act: Date.now() });
      if (texto.length > 400000) return json({ error: 'Hay demasiados datos para guardar.' }, 413);
      await kv.put('d:' + correo, texto);
      return json({ ok: true });
    }
  }

  /* ---- Canjear un código ---- */
  if (accion === 'canjear' && esPost) {
    const correo = await correoDeSesion(request, kv);
    if (!correo) return json({ error: 'Inicia sesión para canjear un código.' }, 401);

    const kFallos = 'rf:' + correo;
    const fallos = parseInt((await kv.get(kFallos)) || '0', 10);
    if (fallos >= 8) return json({ error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }, 429);

    const codigo = normalizarCodigo(cuerpo.codigo);
    const c = codigo ? await kv.get('c:' + codigo, 'json') : null;
    if (!c || c.usado) {
      await kv.put(kFallos, String(fallos + 1), { expirationTtl: 900 });
      return json({ error: 'Código no válido o ya usado.' }, 400);
    }
    c.usado = { por: correo, fecha: Date.now() };
    await kv.put('c:' + codigo, JSON.stringify(c), { metadata: { dias: c.dias, plan: c.plan, creado: c.creado, usado: c.usado } });
    const acceso = await sumarDias(kv, correo, c.dias, c.plan);
    if (fallos) await kv.delete(kFallos);
    return json({ acceso, lista: await listaDe(kv, correo), canjeado: { dias: c.dias, plan: c.plan } });
  }

  /* ---- Pedidos del cliente ---- */
  if (accion === 'pedidos' && request.method === 'GET') {
    const correo = await correoDeSesion(request, kv);
    if (!correo) return json({ error: 'Sin sesión.' }, 401);
    const mios = (await pedidosDe(kv, correo)).sort((a, b) => (b.creado || 0) - (a.creado || 0)).slice(0, 100);
    return json({ pedidos: mios, lista: await listaDe(kv, correo) });
  }
  if (accion === 'pedir' && esPost) {
    const correo = await correoDeSesion(request, kv);
    if (!correo) return json({ error: 'Inicia sesión para hacer un pedido.' }, 401);
    const acc = await accesoDe(kv, correo);
    if (!acc.activo || !PLANES_CON_PEDIDOS.includes(acc.plan)) return json({ error: 'Tu plan no incluye pedidos.' }, 403);

    const tmdb = Math.floor(Number(cuerpo.tmdb));
    const tipo = cuerpo.tipo === 'tv' ? 'tv' : 'movie';
    const titulo = String(cuerpo.titulo || '').trim().slice(0, 100);
    const anio = /^\d{4}$/.test(String(cuerpo.anio || '')) ? String(cuerpo.anio) : '';
    const poster = /^\/[\w.-]{1,60}$/.test(String(cuerpo.poster || '')) ? String(cuerpo.poster) : '';
    if (!(tmdb > 0) || !titulo) return json({ error: 'Pedido no válido.' }, 400);

    const mios = await pedidosDe(kv, correo);
    if (mios.some(x => x.tmdb === tmdb && x.tipo === tipo && x.estado !== 'rechazado')) return json({ error: 'Ya hiciste este pedido.' }, 409);
    if (mios.filter(x => x.estado === 'pendiente').length >= 10) return json({ error: 'Tienes 10 pedidos pendientes. Espera a que se cumplan algunos.' }, 429);

    const id = Date.now().toString(36) + b64url(crypto.getRandomValues(new Uint8Array(4)));
    const ped = { id, correo, tmdb, tipo, titulo, anio, poster, estado: 'pendiente', creado: Date.now() };
    await guardarPedido(kv, ped);
    return json({ pedido: ped });
  }

  /* ---- Administración ---- */
  if (accion === 'admin' && esPost) {
    if (!env.ADMIN_CLAVE) return json({ error: 'Falta configurar ADMIN_CLAVE en Cloudflare.' }, 503);
    const ip = request.headers.get('CF-Connecting-IP') || 'x';
    const kIp = 'af:' + ip;
    const intentos = parseInt((await kv.get(kIp)) || '0', 10);
    if (intentos >= 10) return json({ error: 'Demasiados intentos. Espera unos minutos.' }, 429);
    if (!(await mismaClave(String(cuerpo.clave || ''), String(env.ADMIN_CLAVE)))) {
      await kv.put(kIp, String(intentos + 1), { expirationTtl: 900 });
      return json({ error: 'Clave incorrecta.' }, 401);
    }

    const plan = PLANES_OK.includes(cuerpo.plan) ? cuerpo.plan : 'basico';
    const dias = Math.floor(Number(cuerpo.dias));

    if (cuerpo.op === 'generar') {
      const cantidad = Math.floor(Number(cuerpo.cantidad));
      if (!(dias >= 1 && dias <= 3650)) return json({ error: 'Los días deben ser entre 1 y 3650.' }, 400);
      if (!(cantidad >= 1 && cantidad <= 50)) return json({ error: 'La cantidad debe ser entre 1 y 50.' }, 400);
      const codigos = [], creado = Date.now();
      while (codigos.length < cantidad) {
        const cod = nuevoCodigo();
        if (codigos.includes(cod) || (await kv.get('c:' + cod))) continue;
        await kv.put('c:' + cod, JSON.stringify({ dias, plan, creado, usado: null }), { metadata: { dias, plan, creado, usado: null } });
        codigos.push(cod);
      }
      return json({ codigos, dias, plan });
    }

    if (cuerpo.op === 'listar') {
      const lista = [];
      let cursor;
      do {
        const r = await kv.list({ prefix: 'c:', limit: 1000, cursor });
        for (const k of r.keys) if (k.metadata) lista.push({ codigo: k.name.slice(2), ...k.metadata });
        cursor = r.list_complete ? null : r.cursor;
      } while (cursor && lista.length < 2000);
      lista.sort((a, b) => (b.creado || 0) - (a.creado || 0));
      return json({ codigos: lista });
    }

    if (cuerpo.op === 'conceder') {
      const correo = String(cuerpo.correo || '').trim().toLowerCase();
      if (!(dias >= 1 && dias <= 3650)) return json({ error: 'Los días deben ser entre 1 y 3650.' }, 400);
      if (!correo || !(await kv.get('u:' + correo))) return json({ error: 'Ese correo no tiene cuenta.' }, 404);
      return json({ correo, acceso: await sumarDias(kv, correo, dias, plan) });
    }

    if (cuerpo.op === 'pedidos') {
      const todos = await pedidosDe(kv, '');
      const orden = { pendiente: 0, listo: 1, rechazado: 2 };
      todos.sort((a, b) => (orden[a.estado] - orden[b.estado]) || (b.creado - a.creado));
      return json({ pedidos: todos.slice(0, 300) });
    }

    if (cuerpo.op === 'cuenta') {
      const correo = String(cuerpo.correo || '').trim().toLowerCase();
      if (!correo || !(await kv.get('u:' + correo))) return json({ error: 'Ese correo no tiene cuenta.' }, 404);
      return json({ correo, ...(await estadoDe(kv, correo)) });
    }

    if (cuerpo.op === 'asignar') {
      const r = await asignarLista(kv, String(cuerpo.correo || '').trim().toLowerCase(), String(cuerpo.titulo || '').trim().slice(0, 200), Math.floor(Number(cuerpo.tmdb)) || null, cuerpo.pedido);
      if (r.error) return json({ error: r.error }, r.status);
      return json({ correo: String(cuerpo.correo || '').trim().toLowerCase(), lista: r.lista });
    }

    if (cuerpo.op === 'publicar') {
      const titulo = String(cuerpo.titulo || '').trim().slice(0, 200);
      const tmdb = Math.floor(Number(cuerpo.tmdb)) || 0;
      const link = String(cuerpo.link || '').trim();
      if (!titulo || !tmdb) return json({ error: 'Faltan el título o el código de TMDB.' }, 400);
      if (!/^https?:\/\/\S{4,2000}$/.test(link)) return json({ error: 'El enlace debe empezar con http:// o https://' }, 400);
      const x = (await kv.get('x:catalogo', 'json')) || { items: [] };
      const ya = x.items.find(i => i.tmdb === tmdb);
      if (ya) { ya.titulo = titulo; ya.link = link; } else x.items.push({ titulo, tmdb, link, creado: Date.now() });
      if (x.items.length > 1500) return json({ error: 'Ya hay demasiadas películas publicadas desde el panel.' }, 400);
      await kv.put('x:catalogo', JSON.stringify(x));
      let lista = null;
      if (cuerpo.correo) {
        const correo = String(cuerpo.correo).trim().toLowerCase();
        const r = await asignarLista(kv, correo, titulo, tmdb, cuerpo.pedido);
        if (r.error) return json({ error: 'Se publicó, pero: ' + r.error }, r.status);
        lista = r.lista;
      }
      return json({ publicadas: x.items.length, lista });
    }

    if (cuerpo.op === 'publicadas') {
      const x = (await kv.get('x:catalogo', 'json')) || { items: [] };
      return json({ items: x.items.slice().sort((a, b) => (b.creado || 0) - (a.creado || 0)).map(i => ({ titulo: i.titulo, tmdb: i.tmdb, link: i.link })) });
    }

    if (cuerpo.op === 'despublicar') {
      const tmdb = Math.floor(Number(cuerpo.tmdb)) || 0;
      const x = (await kv.get('x:catalogo', 'json')) || { items: [] };
      x.items = x.items.filter(i => i.tmdb !== tmdb);
      await kv.put('x:catalogo', JSON.stringify(x));
      return json({ publicadas: x.items.length });
    }

    if (cuerpo.op === 'quitar') {
      const correo = String(cuerpo.correo || '').trim().toLowerCase();
      const titulo = String(cuerpo.titulo || '');
      const l = await kv.get('l:' + correo, 'json');
      if (l) { l.items = l.items.filter(x => x.t !== titulo); await kv.put('l:' + correo, JSON.stringify(l)); }
      return json({ correo, lista: await listaDe(kv, correo) });
    }

    if (cuerpo.op === 'rechazar') {
      const q = await kv.get('q:' + String(cuerpo.pedido || ''), 'json');
      if (!q) return json({ error: 'Ese pedido ya no existe.' }, 404);
      q.estado = 'rechazado'; await guardarPedido(kv, q);
      return json({ ok: true });
    }

    return json({ error: 'Operación no válida.' }, 400);
  }

  return json({ error: 'No encontrado.' }, 404);
}
