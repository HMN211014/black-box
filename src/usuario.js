/* Cuentas de usuario (correo + contraseña), tiempo de acceso y códigos canjeables para Black BOX.
   Los datos viven en D1 (binding DB). El progreso va a R2 (binding DATOS) y, si no está conectado, a D1.
   Las películas publicadas desde el panel viven en D1 (tablas publicados y meta). El KV (binding USUARIOS) solo se lee una vez para copiarlas.
   Ruta:  /api/usuario/registro | entrar | salir | yo | datos | canjear | pedir | pedidos | extras | push | pushquitar | admin */

import { avisarUsuario, asegurarPush, avisarAdmins, asegurarPushAdmin } from './push.js';

const enc = new TextEncoder();
const SESION_DIAS = 30;
const PRUEBA_DIAS = 0;
const DIA = 86400000;
const PLANES_OK = ['basico', 'plus', 'pedidos'];
const PLANES_CON_PEDIDOS = ['plus', 'pedidos'];
const LETRAS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
});
const b64 = buf => { let s = ''; new Uint8Array(buf).forEach(c => (s += String.fromCharCode(c))); return btoa(s); };
const deb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = buf => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const limpiarCorreo = x => String(x || '').trim().toLowerCase();
const normalizarNombreR2 = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const esVideoR2 = x => /\.(mp4|mkv|m3u8|webm|m4v|mov|avi|ts|mpd)$/i.test(String(x || ''));
const R2_INDEX_KV = 'blackbox:r2-media-index:v2';        // v2: cada archivo guarda su fecha de subida
const R2_RECIENTES = 30;

async function buscarArchivosR2(env, request, consulta, actualizar) {
  if (!env.DATOS) throw new Error('El binding DATOS de R2 no está conectado a este Worker.');
  const ahora = Date.now();
  let indice = null;
  if (!actualizar && env.USUARIOS) {
    try {
      const guardado = await env.USUARIOS.get(R2_INDEX_KV);
      const dato = guardado ? JSON.parse(guardado) : null;
      if (dato && Array.isArray(dato.items) && ahora - dato.actualizado < 300000) indice = dato;
    } catch (e) {}
  }
  if (!indice) {
    const items = []; let cursor = null, paginas = 0, parcial = false;
    do {
      const pagina = await env.DATOS.list(cursor ? { cursor, limit: 1000 } : { limit: 1000 });
      for (const objeto of pagina.objects || []) {
        if (esVideoR2(objeto.key)) items.push({ key: objeto.key, size: Number(objeto.size) || 0, subido: objeto.uploaded ? new Date(objeto.uploaded).getTime() || 0 : 0 });
      }
      paginas++;
      cursor = pagina.truncated ? pagina.cursor : null;
      if (cursor && paginas >= 20) parcial = true;
    } while (cursor && paginas < 20);
    indice = { items, actualizado: ahora, parcial };
    if (env.USUARIOS) {
      try { await env.USUARIOS.put(R2_INDEX_KV, JSON.stringify(indice), { expirationTtl: 300 }); } catch (e) {}
    }
  }

  let base = String(env.R2_PUBLIC_BASE || '').trim();
  if (base && !base.endsWith('/')) base += '/';
  if (!base) {
    const assets = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url)));
    const html = await assets.text();
    const encontrado = html.match(/https:\/\/pub-[a-z0-9-]+\.r2\.dev\//i);
    if (encontrado) base = encontrado[0];
  }
  if (!base) throw new Error('No pude identificar el dominio público de R2 para construir los enlaces.');

  const q = normalizarNombreR2(consulta);
  const aItem = x => ({ nombre: x.key.split('/').pop(), key: x.key, size: x.size, subido: x.subido || 0, url: base + x.key.split('/').map(encodeURIComponent).join('/') });
  if (!q) {      // sin texto de búsqueda: los archivos más recientes, también los que están dentro de carpetas
    const items = indice.items.slice().sort((a, b) => (b.subido || 0) - (a.subido || 0)).slice(0, R2_RECIENTES).map(aItem);
    return { items, recientes: true, actualizado: indice.actualizado, parcial: !!indice.parcial };
  }
  if (q.length < 2) throw new Error('Escribe al menos dos caracteres para buscar en R2.');
  const items = indice.items.filter(x => normalizarNombreR2(x.key).includes(q))
    .sort((a, b) => normalizarNombreR2(a.key).indexOf(q) - normalizarNombreR2(b.key).indexOf(q) || a.key.length - b.key.length)
    .slice(0, 50)
    .map(aItem);
  return { items, recientes: false, actualizado: indice.actualizado, parcial: !!indice.parcial };
}

async function guardarIntroDbTitulo(db, tmdb, tipo, titulo, activo) {
  const r = await db.prepare("SELECT valor FROM meta WHERE clave = 'introdb'").first();
  let items = []; try { if (r && r.valor) { const v = JSON.parse(r.valor); if (Array.isArray(v)) items = v; } } catch (e) {}
  const k = Number(tmdb), esSerie = tipo === 'serie';
  const existente = items.find(x => Number(x.tmdb) === k && (x.tipo === 'serie') === esSerie);
  items = items.filter(x => !(Number(x.tmdb) === k && (x.tipo === 'serie') === esSerie));
  if (activo) items.push({ tmdb: k, tipo: esSerie ? 'serie' : 'pelicula', titulo: String(titulo || '').trim().slice(0, 200), ...(existente && existente.avisoSegundos != null ? { avisoSegundos: existente.avisoSegundos } : {}) });
  await db.prepare('CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT) WITHOUT ROWID').run();
  await db.prepare("INSERT INTO meta (clave, valor) VALUES ('introdb', ?1) ON CONFLICT(clave) DO UPDATE SET valor = ?1").bind(JSON.stringify(items)).run();
}

async function hashClave(clave, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(clave), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256));
}
function iguales(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
async function mismaClave(a, b) {
  const ha = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(a)));
  const hb = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(b)));
  return iguales(ha, hb);
}
const cookieSesion = (token, dias) =>
  `bb_sesion=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.round(dias * 86400)}`;

/* ---- Acceso (días de plan y vales de películas) ---- */
async function accesoDe(db, correo) {
  const a = await db.prepare('SELECT vence, plan, vales, canje FROM usuarios WHERE correo = ?1').bind(correo).first();
  const vence = a ? a.vence : 0;
  // vales = películas por canjear (plan "Películas por pedido"); canje = la cuenta usa vales en vez de días
  return { vence, plan: (a && a.plan) || null, activo: vence > Date.now(), vales: a ? a.vales | 0 : 0, canje: !!(a && a.canje) };
}
async function sumarDias(db, correo, dias, plan) {
  const antes = await accesoDe(db, correo);
  const base = Math.max(Date.now(), antes.vence);
  const rango = { pedidos: 0, basico: 1, plus: 2 };
  const nuevo = PLANES_OK.includes(plan) ? plan : 'basico';
  const nuevoPlan = antes.activo && (rango[antes.plan] ?? 0) > rango[nuevo] ? antes.plan : nuevo;
  await db.prepare('UPDATE usuarios SET vence = ?1, plan = ?2 WHERE correo = ?3').bind(base + dias * DIA, nuevoPlan, correo).run();
  return accesoDe(db, correo);
}
async function ajustarVales(db, correo, delta) {      // delta positivo = suma vales, negativo = descuenta (nunca baja de 0)
  await db.prepare('UPDATE usuarios SET vales = MAX(0, vales + ?1), canje = 1 WHERE correo = ?2').bind(delta, correo).run();
  return accesoDe(db, correo);
}

/* ---- Intentos fallidos (contraseña, códigos y clave de admin) ---- */
async function intentosDe(db, clave) {
  const r = await db.prepare('SELECT n FROM intentos WHERE clave = ?1 AND expira > ?2').bind(clave, Date.now()).first();
  return r ? r.n : 0;
}
async function sumarIntento(db, clave, segundos) {
  const ahora = Date.now();
  await db.prepare('INSERT INTO intentos (clave, n, expira) VALUES (?1, 1, ?2) ON CONFLICT(clave) DO UPDATE SET n = CASE WHEN expira > ?3 THEN n + 1 ELSE 1 END, expira = ?2')
    .bind(clave, ahora + segundos * 1000, ahora).run();
}
const borrarIntentos = (db, clave) => db.prepare('DELETE FROM intentos WHERE clave = ?1').bind(clave).run();

/* ---- Sesiones y límite de pantallas simultáneas ---- */
async function crearSesion(db, correo) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const ahora = Date.now();
  const acceso = await accesoDe(db, correo);
  const limite = acceso.plan === 'plus' ? 3 : 1;
  await db.batch([
    db.prepare('INSERT INTO sesiones (token, correo, creado, expira) VALUES (?1, ?2, ?3, ?4)').bind(token, correo, ahora, ahora + SESION_DIAS * DIA),
    // deja solo las sesiones más recientes (según el plan) y borra las vencidas de esta cuenta
    db.prepare('DELETE FROM sesiones WHERE correo = ?1 AND token NOT IN (SELECT token FROM sesiones WHERE correo = ?1 AND expira > ?2 ORDER BY creado DESC LIMIT ?3)').bind(correo, ahora, limite),
  ]);
  if (Math.random() < 0.02) {                              // limpieza ocasional de lo vencido en todo el sistema
    await db.batch([
      db.prepare('DELETE FROM sesiones WHERE expira < ?1').bind(ahora),
      db.prepare('DELETE FROM intentos WHERE expira < ?1').bind(ahora),
    ]);
  }
  return token;
}
function tokenDe(request) {
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)bb_sesion=([\w-]+)/);
  return m ? m[1] : null;
}
async function correoDeSesion(request, db) {
  const t = tokenDe(request);
  if (!t) return null;
  const r = await db.prepare('SELECT correo FROM sesiones WHERE token = ?1 AND expira > ?2').bind(t, Date.now()).first();
  return r ? r.correo : null;
}

/* ---- Códigos ---- */
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

/* ---- Lista de la cuenta ---- */
async function listaDe(db, correo) {
  const r = await db.prepare('SELECT titulo AS t, tmdb AS id FROM lista WHERE correo = ?1 ORDER BY fecha ASC').bind(correo).all();
  return r.results.map(x => ({ t: x.t, id: x.id || null }));
}
async function estadoDe(db, correo) {
  return { acceso: await accesoDe(db, correo), lista: await listaDe(db, correo) };
}
async function asignarLista(db, correo, titulo, tmdb, pedidoId, avisar) {
  if (!titulo) return { error: 'Escribe el título tal como está en el catálogo.', status: 400 };
  if (!correo || !(await db.prepare('SELECT 1 AS x FROM usuarios WHERE correo = ?1').bind(correo).first())) return { error: 'Ese correo no tiene cuenta.', status: 404 };
  const ya = await db.prepare('SELECT 1 AS x FROM lista WHERE correo = ?1 AND titulo = ?2').bind(correo, titulo).first();
  if (!ya) {
    const n = await db.prepare('SELECT COUNT(*) AS n FROM lista WHERE correo = ?1').bind(correo).first();
    if (n.n >= 500) return { error: 'La lista de esa cuenta ya es muy larga.', status: 400 };
    await db.prepare('INSERT OR IGNORE INTO lista (correo, titulo, tmdb, fecha) VALUES (?1, ?2, ?3, ?4)').bind(correo, titulo, tmdb || null, Date.now()).run();
  }
  if (pedidoId) {
    const antes = await db.prepare('SELECT estado, titulo, poster FROM pedidos WHERE id = ?1 AND correo = ?2').bind(String(pedidoId), correo).first();
    await db.prepare("UPDATE pedidos SET estado = 'listo', listo = ?1 WHERE id = ?2 AND correo = ?3").bind(Date.now(), String(pedidoId), correo).run();
    if (avisar && antes && antes.estado === 'pendiente') avisar(correo, antes.titulo || titulo, antes.poster); // push: solicitud aprobada (solo al resolverla)
  }
  return { ok: true, lista: await listaDe(db, correo) };
}

/* ---- Pedidos ---- */
const filaPedido = r => ({
  id: r.id, correo: r.correo, tmdb: r.tmdb, tipo: r.tipo, titulo: r.titulo, anio: r.anio, poster: r.poster,
  estado: r.estado, creado: r.creado, ...(r.listo ? { listo: r.listo } : {}), ...(r.vale ? { vale: true } : {}),
});
async function pedidosDe(db, correo) {
  const q = correo
    ? db.prepare('SELECT * FROM pedidos WHERE correo = ?1 ORDER BY creado DESC LIMIT 3000').bind(correo)
    : db.prepare('SELECT * FROM pedidos ORDER BY creado DESC LIMIT 3000');
  return (await q.all()).results.map(filaPedido);
}

/* ---- Progreso y capítulos vistos: R2 si está conectado (sin tope diario de escrituras); si no, D1 ---- */
const claveDatos = correo => 'd/' + encodeURIComponent(correo) + '.json';
async function leerDatos(env, correo) {
  try {
    if (env.DATOS) {
      const o = await env.DATOS.get(claveDatos(correo));
      return o ? JSON.parse(await o.text()) : null;
    }
    const r = await env.DB.prepare('SELECT json FROM datos WHERE correo = ?1').bind(correo).first();
    return r ? JSON.parse(r.json) : null;
  } catch (e) { return null; }
}
async function guardarDatos(env, correo, texto) {
  if (env.DATOS) { await env.DATOS.put(claveDatos(correo), texto, { httpMetadata: { contentType: 'application/json' } }); return; }
  await env.DB.prepare('INSERT INTO datos (correo, json) VALUES (?1, ?2) ON CONFLICT(correo) DO UPDATE SET json = ?2').bind(correo, texto).run();
}

/* ---- Catálogo publicado desde el panel: vive en D1 (tablas "publicados" y "meta").
   Antes estaba en KV (x:catalogo) y se agotaban las escrituras diarias: lo que haya en KV se copia solo, una vez, y después ya no se toca. ---- */
const tipoDe = i => i.tipo === 'serie' || i.episodios || /\{(t|e|tt|ee)\}/.test(String(i.link || '')) ? 'serie' : 'pelicula';   // solo para lo que venía de KV sin "tipo"
const epsDe = t => { try { const o = JSON.parse(t || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };
const totalPublicados = async db => (await db.prepare('SELECT COUNT(*) AS n FROM publicados').first()).n;
let catListo = null;      // promesa: tablas creadas y copia desde KV hecha (una vez por instancia del Worker)
function prepararCatalogo(db, kv) {
  if (!catListo) catListo = (async () => {
    await db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS publicados (tmdb INTEGER PRIMARY KEY, titulo TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'pelicula', link TEXT NOT NULL DEFAULT '', episodios TEXT NOT NULL DEFAULT '{}', version TEXT NOT NULL DEFAULT 'latino', proximamente INTEGER NOT NULL DEFAULT 0, creado INTEGER NOT NULL)"),
      db.prepare('CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT) WITHOUT ROWID'),
      db.prepare('CREATE TABLE IF NOT EXISTS colecciones (id TEXT PRIMARY KEY, datos TEXT NOT NULL, creado INTEGER NOT NULL)'),
      db.prepare('CREATE TABLE IF NOT EXISTS secciones (id TEXT PRIMARY KEY, datos TEXT NOT NULL, creado INTEGER NOT NULL)')
    ]);
    try { await db.prepare("ALTER TABLE publicados ADD COLUMN version TEXT NOT NULL DEFAULT 'latino'").run(); } catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; }
    try { await db.prepare('ALTER TABLE publicados ADD COLUMN proximamente INTEGER NOT NULL DEFAULT 0').run(); } catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; }
    const hecho = await db.prepare("SELECT valor FROM meta WHERE clave = 'catalogo_desde_kv'").first();
    if (hecho) return;
    let items = [], leido = true;
    if (kv) { try { const x = await kv.get('x:catalogo', 'json'); if (x && Array.isArray(x.items)) items = x.items; } catch (e) { leido = false; console.error('[catalogo] no se pudo leer KV:', e && e.message); } }
    if (!leido) { catListo = null; return; }                  // se vuelve a intentar en la próxima petición, sin marcar como hecho
    const filas = items.filter(i => i && i.titulo && Math.floor(Number(i.tmdb)) > 0).map(i => ({
      tmdb: Math.floor(Number(i.tmdb)), titulo: String(i.titulo).slice(0, 200), tipo: tipoDe(i), link: String(i.link || ''),
      episodios: JSON.stringify(i.episodios && typeof i.episodios === 'object' ? i.episodios : {}), creado: Number(i.creado) || Date.now()
    }));
    for (let n = 0; n < filas.length; n += 50)
      await db.prepare(`INSERT OR IGNORE INTO publicados (tmdb, titulo, tipo, link, episodios, creado)
        SELECT json_extract(value, '$.tmdb'), json_extract(value, '$.titulo'), json_extract(value, '$.tipo'), json_extract(value, '$.link'), json_extract(value, '$.episodios'), json_extract(value, '$.creado')
        FROM json_each(?1)`).bind(JSON.stringify(filas.slice(n, n + 50))).run();
    await db.prepare("INSERT OR IGNORE INTO meta (clave, valor) VALUES ('catalogo_desde_kv', ?1)").bind(String(filas.length)).run();
  })().catch(e => { catListo = null; throw e; });
  return catListo;
}

/* ---- Colecciones creadas desde el panel (cuadros del inicio, como las de colecciones.js). Se guardan en D1 tal como las escribe el panel
   y se expanden al formato de colecciones.js al entregarlas. Todo lo que llega se valida: el panel nunca inserta texto sin revisar en la página. ---- */
const FUENTES_COL = { impact: "Impact,'Arial Narrow Bold','Helvetica Neue',sans-serif", avenir: "'Avenir Next','Helvetica Neue',Arial,sans-serif", helvetica: "'Helvetica Neue',Arial,sans-serif", georgia: "Georgia,'Times New Roman',serif", courier: "'Courier New',Courier,monospace" };
const TEMAS_COL = ['puntos', 'rayos', 'estrellas', 'liso'], PATRONES_COL = ['', 'aranas', 'murcielagos'], ESP_COL = ['normal', '.03em', '.08em', '.16em'];
const hexCol = (v, d) => /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v).toLowerCase() : d;
const urlCol = v => { v = String(v == null ? '' : v).trim(); return v === '' ? '' : (v.length <= 2000 && /^(https?:\/\/|\/)\S+$/.test(v)) ? v : null; };      // null = no válida
const textosCol = v => (Array.isArray(v) ? v : []).map(x => String(x == null ? '' : x).trim().slice(0, 200)).filter(Boolean).slice(0, 200);
const criteriosCol = v => textosCol(v).slice(0, 80).map(x => /^\d{1,9}$/.test(x) ? Number(x) : x);                  // "125574" → número de TMDB; lo demás, nombre
function limpiarCol(c) {
  c = c && typeof c === 'object' ? c : {};
  const id = String(c.id || '').trim().toLowerCase(), nombre = String(c.nombre || '').trim().slice(0, 60);
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) return { error: 'El id solo puede llevar letras sin acento, números y guiones (máximo 40).' };
  if (!nombre) return { error: 'Escribe el nombre de la colección.' };
  const an = c.anuncio && typeof c.anuncio === 'object' ? c.anuncio : {};
  const fondo = urlCol(c.fondo), logo = urlCol(c.logo), aImg = urlCol(an.imagen), aEnl = urlCol(an.enlace);
  if (fondo === null || logo === null || aImg === null) return { error: 'Las direcciones de imagen deben empezar con http:// o https://' };
  if (aEnl === null) return { error: 'El enlace del anuncio debe empezar con http:// o https://' };
  const o = {
    id, nombre, a: hexCol(c.a, '#0b3d91'), b: hexCol(c.b, '#020b1f'), tx: hexCol(c.tx, '#ffffff'),
    tema: TEMAS_COL.includes(c.tema) ? c.tema : 'liso',
    fuente: FUENTES_COL[c.fuente] ? c.fuente : 'helvetica',
    peso: ['400', '700', '900'].includes(String(c.peso)) ? String(c.peso) : '700',
    esp: (c.esp === 'normal' || /^\d{0,2}\.?\d{1,3}em$/.test(String(c.esp))) ? String(c.esp) : 'normal',
    mayus: !!c.mayus,
    patron: PATRONES_COL.includes(c.patron) ? c.patron : '', patronColor: hexCol(c.patronColor, '#ffffff'),
    anuncio: { titulo: String(an.titulo || '').trim().slice(0, 100), texto: String(an.texto || '').trim().slice(0, 300), imagen: aImg, enlace: aEnl, boton: String(an.boton || '').trim().slice(0, 40) }
  };
  if (fondo) { o.fondo = fondo; if (c.sinNombre) o.sinNombre = true; }
  if (logo) o.logo = logo;
  for (const k of ['tmdbEmpresas', 'tmdbPalabras', 'tmdbSagas', 'tmdbDirectores', 'tmdbReparto']) { const l = criteriosCol(c[k]); if (l.length) o[k] = l; }
  const cont = textosCol(c.tmdbEmpresasContiene).slice(0, 80); if (cont.length) o.tmdbEmpresasContiene = cont;       // solo texto: se busca dentro del nombre
  if (c.auto === false) o.auto = false;
  const exc = textosCol(c.excluir); if (exc.length) o.excluir = exc;
  /* Próximamente: películas de TMDB que todavía no están en la biblioteca. Se muestran en la colección como tarjeta sin enlace y, cuando se publican, entran solas. */
  const prox = (Array.isArray(c.proximamente) ? c.proximamente : []).slice(0, 100).map(x => {
    x = x && typeof x === 'object' ? x : {};
    const tmdb = Math.floor(Number(x.tmdb)), titulo = String(x.titulo || '').trim().slice(0, 200);
    if (!(tmdb > 0) || !titulo) return null;
    return { tmdb, titulo, tipo: x.tipo === 'serie' ? 'serie' : 'pelicula', anio: /^\d{4}$/.test(String(x.anio || '')) ? String(x.anio) : '',
      poster: /^\/[\w-]{1,60}\.(jpg|jpeg|png|webp)$/i.test(String(x.poster || '')) ? String(x.poster) : '' };      // solo la ruta de TMDB (/abc.jpg), nunca una dirección libre
  }).filter((x, i, a) => x && a.findIndex(y => y && y.tmdb === x.tmdb) === i);
  if (prox.length) o.proximamente = prox;
  const pel = textosCol(c.peliculas); if (pel.length) o.peliculas = pel;
  /* Subcategorías (por ejemplo "Trilogía original" dentro de Star Wars): cada una con sus propias reglas. Lo que entra en una también pertenece a la colección. */
  const subs = (Array.isArray(c.subcategorias) ? c.subcategorias : []).slice(0, 30).map(s => {
    s = s && typeof s === 'object' ? s : {};
    const nom = String(s.nombre || '').trim().slice(0, 60); if (!nom) return null;
    const r = { nombre: nom };
    const sp = textosCol(s.peliculas).slice(0, 80); if (sp.length) r.peliculas = sp;
    for (const k of ['tmdbSagas', 'tmdbDirectores', 'tmdbReparto', 'tmdbEmpresas']) { const l = criteriosCol(s[k]).slice(0, 40); if (l.length) r[k] = l; }
    return r;
  }).filter(Boolean);
  if (subs.length) o.subcategorias = subs;
  return { col: o };
}
const datosCol = t => { try { const o = JSON.parse(t); return o && typeof o === 'object' && o.id ? o : null; } catch (e) { return null; } };
const colParaPagina = d => ({ ...d, fuente: FUENTES_COL[d.fuente] || FUENTES_COL.helvetica, peliculas: d.peliculas || [] });

/* ---- Secciones temáticas (como "Huluween"): una franja con carrusel de pósters (en el inicio o dentro de una colección)
   y una página propia (#/s/<id>) con banner de fotos y filas de películas. Se guardan en D1 y se validan igual que las colecciones. ---- */
const ANCLAS_INICIO = ['top', 'hero', 'cols', 'gens', 'cont', 'pop', 'gfil', 'grid', 'plat'];
const ANCLAS_COL = ['top', 'hero', 'pop', 'cro', 'subs', 'grid'];
const ANCLAS_SEC = new Set([...ANCLAS_INICIO, ...ANCLAS_COL]);
const rutaTmdb = v => /^\/[\w-]{1,60}\.(jpg|jpeg|png|webp)$/i.test(String(v || '')) ? String(v) : '';
function limpiarSec(s) {
  s = s && typeof s === 'object' ? s : {};
  const id = String(s.id || '').trim().toLowerCase(), nombre = String(s.nombre || '').trim().slice(0, 60);
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) return { error: 'El enlace corto solo puede llevar letras sin acento, números y guiones (máximo 40).' };
  if (!nombre) return { error: 'Escribe el nombre de la sección.' };
  const logo = urlCol(s.logo), fondo = urlCol(s.fondo);
  const banners = (Array.isArray(s.banners) ? s.banners : []).slice(0, 8).map(urlCol);
  if (logo === null || fondo === null || banners.includes(null)) return { error: 'Las direcciones de imagen deben empezar con http:// o https://' };
  const ubicacion = /^col:[a-z0-9][a-z0-9-]{0,39}$/.test(String(s.ubicacion || '')) ? String(s.ubicacion) : 'inicio';
  const anclas = ubicacion === 'inicio' ? ANCLAS_INICIO : ANCLAS_COL;
  const filas = (Array.isArray(s.filas) ? s.filas : []).slice(0, 12).map(f => {
    f = f && typeof f === 'object' ? f : {};
    const items = (Array.isArray(f.items) ? f.items : []).slice(0, 60).map(x => {
      x = x && typeof x === 'object' ? x : {};
      const tmdb = Math.floor(Number(x.tmdb)), titulo = String(x.titulo || '').trim().slice(0, 200);
      if (!(tmdb > 0) || !titulo) return null;
      return { tmdb, titulo, tipo: x.tipo === 'serie' ? 'serie' : 'pelicula', anio: /^\d{4}$/.test(String(x.anio || '')) ? String(x.anio) : '', poster: rutaTmdb(x.poster), fondo: rutaTmdb(x.fondo), ...(x.novedad ? { novedad: true } : {}) };
    }).filter((x, i, a) => x && a.findIndex(y => y && y.tmdb === x.tmdb) === i);
    const col = String(f.coleccion || '').trim().toLowerCase();
    return { titulo: String(f.titulo || '').trim().slice(0, 100), estilo: f.estilo === 'vertical' ? 'vertical' : 'horizontal', coleccion: /^[a-z0-9][a-z0-9-]{0,39}$/.test(col) ? col : '', items };
  });
  return { sec: {
    id, nombre, logo, fondo, banners: banners.filter(Boolean),
    etiqueta: String(s.etiqueta || '').trim().slice(0, 40), texto: String(s.texto || '').trim().slice(0, 200), boton: String(s.boton || '').trim().slice(0, 30),
    a: hexCol(s.a, '#0b3d91'), b: hexCol(s.b, '#020b1f'), tx: hexCol(s.tx, '#ffffff'),
    ubicacion, despues: anclas.includes(s.despues) ? s.despues : 'hero', orden: Math.max(0, Math.min(999, Math.floor(Number(s.orden)) || 0)),
    franja: s.franja !== false, filas
  } };
}
const datosSec = t => { try { const o = JSON.parse(t); return o && typeof o === 'object' && o.id ? o : null; } catch (e) { return null; } };

async function manejar({ request, env, params, waitUntil }) {
  const db = env.DB;
  const posterDePedido = poster => /^\/[\w.-]{1,60}$/.test(String(poster || '')) ? 'https://image.tmdb.org/t/p/w500' + poster : '';
  const avisarAprobado = (correo, titulo, poster) => {
    const imagen = posterDePedido(poster);
    const p = avisarUsuario(env, correo, { titulo: 'Pedido aprobado', texto: 'Tu solicitud de «' + titulo + '» fue aprobada y ya está disponible en tu cuenta.', datos: { tipo: 'pedido_aprobado', titulo, ...(imagen ? { poster: imagen } : {}) } });
    if (waitUntil) waitUntil(p);
  };
  const kv = env.USUARIOS;          // KV viejo: solo se LEE una vez para copiar a D1 las películas que ya estaban publicadas

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
    const correo = limpiarCorreo(cuerpo.correo);
    const clave = String(cuerpo.clave || '');
    if (correo.length > 254 || !/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(correo)) return json({ error: 'Escribe un correo válido.' }, 400);
    if (clave.length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400);
    if (clave.length > 200) return json({ error: 'La contraseña es demasiado larga.' }, 400);
    if (await db.prepare('SELECT 1 AS x FROM usuarios WHERE correo = ?1').bind(correo).first()) return json({ error: 'Ese correo ya tiene una cuenta. Inicia sesión.' }, 409);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashClave(clave, salt);
    try {
      await db.prepare('INSERT INTO usuarios (correo, salt, hash, creado) VALUES (?1, ?2, ?3, ?4)').bind(correo, b64(salt), b64(hash), Date.now()).run();
    } catch (e) {
      if (/unique|constraint/i.test(String(e && e.message))) return json({ error: 'Ese correo ya tiene una cuenta. Inicia sesión.' }, 409);
      throw e;
    }
    if (PRUEBA_DIAS > 0) await sumarDias(db, correo, PRUEBA_DIAS, 'basico');
    const token = await crearSesion(db, correo);
    return json({ correo, ...(await estadoDe(db, correo)) }, 200, { 'Set-Cookie': cookieSesion(token, SESION_DIAS) });
  }

  /* ---- Iniciar sesión ---- */
  if (accion === 'entrar' && esPost) {
    const correo = limpiarCorreo(cuerpo.correo);
    const clave = String(cuerpo.clave || '');
    if (!correo || !clave || clave.length > 200) return json({ error: 'Correo o contraseña incorrectos.' }, 401);

    const kFallos = 'f:' + correo;
    const fallos = await intentosDe(db, kFallos);
    if (fallos >= 8) return json({ error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }, 429);

    const u = await db.prepare('SELECT salt, hash FROM usuarios WHERE correo = ?1').bind(correo).first();
    let ok = false;
    if (u) ok = iguales(await hashClave(clave, deb64(u.salt)), deb64(u.hash));
    else await hashClave(clave, new Uint8Array(16));
    if (!ok) {
      await sumarIntento(db, kFallos, 900);
      return json({ error: 'Correo o contraseña incorrectos.' }, 401);
    }
    if (fallos) await borrarIntentos(db, kFallos);
    const token = await crearSesion(db, correo);
    return json({ correo, ...(await estadoDe(db, correo)) }, 200, { 'Set-Cookie': cookieSesion(token, SESION_DIAS) });
  }

  /* ---- Notificaciones push: guardar / quitar el teléfono de esta cuenta ---- */
  if (accion === 'push' && esPost) {
    const correo = await correoDeSesion(request, db);
    if (!correo) return json({ error: 'Inicia sesión primero.' }, 401);
    const token = String(cuerpo.token || '').trim();
    if (token.length < 20 || token.length > 4096) return json({ error: 'Token no válido.' }, 400);
    await asegurarPush(db);
    const sonido = ['suave', 'sistema', 'silencio'].includes(String(cuerpo.sonido || '')) ? String(cuerpo.sonido) : 'suave';
    await db.prepare('INSERT INTO dispositivos (token, correo, plataforma, creado) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(token) DO UPDATE SET correo = ?2, plataforma = ?3, creado = ?4')
      .bind(token, correo, String(cuerpo.plataforma || '').slice(0, 20), Date.now()).run();
    await db.prepare('INSERT INTO dispositivos_preferencias (token, sonido) VALUES (?1, ?2) ON CONFLICT(token) DO UPDATE SET sonido = ?2').bind(token, sonido).run();
    await db.prepare('DELETE FROM dispositivos WHERE correo = ?1 AND token NOT IN (SELECT token FROM dispositivos WHERE correo = ?1 ORDER BY creado DESC LIMIT 10)').bind(correo).run();   // máximo 10 teléfonos por cuenta
    return json({ ok: true });
  }
  if (accion === 'pushquitar' && esPost) {
    await asegurarPush(db);
    await db.prepare('DELETE FROM dispositivos WHERE token = ?1').bind(String(cuerpo.token || '')).run();
    await db.prepare('DELETE FROM dispositivos_preferencias WHERE token = ?1').bind(String(cuerpo.token || '')).run();
    return json({ ok: true });
  }
  if (accion === 'pushprueba' && esPost) {
    const correo = await correoDeSesion(request, db);
    if (!correo) return json({ error: 'Inicia sesión en Black BOX para enviar una prueba.' }, 401);
    if (!env.FCM_SERVICE_ACCOUNT) return json({ error: 'El servicio de notificaciones todavía no está configurado.' }, 503);
    await asegurarPush(db);
    const dispositivos = await db.prepare('SELECT COUNT(*) AS total FROM dispositivos WHERE correo = ?1').bind(correo).first();
    if (!dispositivos || !dispositivos.total) return json({ error: 'No hay dispositivos de Black BOX registrados en esta cuenta. Activa las notificaciones primero.' }, 409);
    const clavePrueba = 'push-test:' + correo;
    if (await intentosDe(db, clavePrueba)) return json({ error: 'Espera un minuto antes de volver a enviar otra prueba.' }, 429);
    await sumarIntento(db, clavePrueba, 60);
    const resultado = await avisarUsuario(env, correo, { titulo: 'Notificación de prueba', texto: 'Las notificaciones de Black BOX funcionan en este dispositivo.', datos: { tipo: 'prueba' } });
    if (resultado.error === 'sin_configuracion') return json({ error: 'No se pudo conectar con el servicio de notificaciones.' }, 503);
    if (!resultado.enviados) return json({ error: 'No se pudo enviar la notificación de prueba.' }, 502);
    return json({ ok: true, enviados: resultado.enviados, fallidos: resultado.fallidos });
  }

  /* ---- Cerrar sesión ---- */
  if (accion === 'salir' && esPost) {
    const t = tokenDe(request);
    if (t) await db.prepare('DELETE FROM sesiones WHERE token = ?1').bind(t).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookieSesion('', 0) });
  }

  /* ---- Estado ---- */
  if (accion === 'yo' && request.method === 'GET') {
    const correo = await correoDeSesion(request, db);
    if (!correo) return json({ servicio: true, correo: '' });
    return json({ servicio: true, correo, ...(await estadoDe(db, correo)) });
  }

  /* ---- Datos de la cuenta (progreso y capítulos vistos) ---- */
  if (accion === 'datos') {
    const correo = await correoDeSesion(request, db);
    if (!correo) return json({ error: 'Sin sesión.' }, 401);

    if (request.method === 'GET') {
      const d = await leerDatos(env, correo);
      return json({ datos: d ? d.datos : { prog: {}, vis: {} } });
    }
    if (esPost) {
      const d = cuerpo.datos;
      if (!d || typeof d !== 'object' || Array.isArray(d)) return json({ error: 'Datos no válidos.' }, 400);
      const limpio = {
        prog: d.prog && typeof d.prog === 'object' && !Array.isArray(d.prog) ? d.prog : {},
        vis: d.vis && typeof d.vis === 'object' && !Array.isArray(d.vis) ? d.vis : {},
      };
      const previo = await leerDatos(env, correo);
      /* Perfiles (los manda la app): lista con nombre/avatar, perfiles borrados y el progreso de cada uno. La web no los manda: se conservan. */
      const obj = x => x && typeof x === 'object' && !Array.isArray(x);
      if (obj(d.perf) && Array.isArray(d.perf.lista) && obj(d.pp)) {
        const txt = (v, n) => String(v == null ? '' : v).slice(0, n);
        const lista = d.perf.lista.slice(0, 8).filter(x => obj(x) && x.id).map(x => ({ id: txt(x.id, 16), nombre: txt(x.nombre, 24) || 'Perfil', av: txt(x.av, 8), c: Number(x.c) | 0, f: Number(x.f) || 0 }));
        const pp = {}; lista.forEach(x => { const v = d.pp[x.id]; pp[x.id] = obj(v) ? { prog: obj(v.prog) ? v.prog : {}, vis: obj(v.vis) ? v.vis : {} } : { prog: {}, vis: {} }; });
        limpio.perf = { lista, activo: txt(d.perf.activo, 16), del: (Array.isArray(d.perf.del) ? d.perf.del : []).slice(0, 40).map(x => txt(x, 16)) };
        limpio.pp = pp;
      } else if (previo && previo.datos && previo.datos.perf) { limpio.perf = previo.datos.perf; limpio.pp = previo.datos.pp; }
      const texto = JSON.stringify({ datos: limpio, act: Date.now() });
      if (texto.length > 400000) return json({ error: 'Hay demasiados datos para guardar.' }, 413);
      if (previo && JSON.stringify(previo.datos) === JSON.stringify(limpio)) return json({ ok: true, sinCambios: true });   // si no cambió nada, no se guarda
      await guardarDatos(env, correo, texto);
      return json({ ok: true });
    }
  }

  /* ---- Canjear un código ---- */
  if (accion === 'canjear' && esPost) {
    const correo = await correoDeSesion(request, db);
    if (!correo) return json({ error: 'Inicia sesión para canjear un código.' }, 401);

    const kFallos = 'rf:' + correo;
    const fallos = await intentosDe(db, kFallos);
    if (fallos >= 8) return json({ error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }, 429);

    const codigo = normalizarCodigo(cuerpo.codigo);
    const c = codigo ? await db.prepare('SELECT plan, dias, peliculas, usado_por FROM codigos WHERE codigo = ?1').bind(codigo).first() : null;
    // el UPDATE solo funciona si el código sigue sin usar: dos canjes a la vez no pueden gastarlo dos veces
    const canjeFecha = Date.now();
    const tomado = c && !c.usado_por
      ? await db.prepare('UPDATE codigos SET usado_por = ?1, usado_fecha = ?2 WHERE codigo = ?3 AND usado_por IS NULL').bind(correo, canjeFecha, codigo).run()
      : null;
    if (!tomado || !tomado.meta || tomado.meta.changes !== 1) {
      await sumarIntento(db, kFallos, 900);
      return json({ error: 'Código no válido o ya usado.' }, 400);
    }
    const cf = request.cf || {};
    const paisBruto = String(cf.country || request.headers.get('CF-IPCountry') || '').trim().toUpperCase();
    const pais = /^[A-Z]{2}$/.test(paisBruto) ? paisBruto : null;
    const ciudad = String(cf.city || '').trim().slice(0, 80) || null;
    try {
      await db.prepare('CREATE TABLE IF NOT EXISTS codigos_canje_info (codigo TEXT PRIMARY KEY, pais TEXT, ciudad TEXT, canjeado INTEGER NOT NULL) WITHOUT ROWID').run();
      await db.prepare('INSERT INTO codigos_canje_info (codigo, pais, ciudad, canjeado) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(codigo) DO UPDATE SET pais = ?2, ciudad = ?3, canjeado = ?4')
        .bind(codigo, pais, ciudad, canjeFecha).run();
    } catch (e) { console.error('[canje] No se pudo guardar la ubicación aproximada.', e && e.message); }
    const esVale = c.plan === 'pedidos' && Number(c.peliculas) > 0;      // los códigos de plan "pedidos" por días siguen funcionando
    const acceso = esVale ? await ajustarVales(db, correo, Math.floor(c.peliculas)) : await sumarDias(db, correo, c.dias, c.plan);
    if (fallos) await borrarIntentos(db, kFallos);
    return json({ acceso, lista: await listaDe(db, correo), canjeado: { dias: c.dias ?? undefined, plan: c.plan, peliculas: c.peliculas ?? undefined } });
  }

  /* ---- Pedidos del cliente ---- */
  if (accion === 'pedidos' && request.method === 'GET') {
    const correo = await correoDeSesion(request, db);
    if (!correo) return json({ error: 'Sin sesión.' }, 401);
    const mios = (await pedidosDe(db, correo)).slice(0, 100);
    return json({ pedidos: mios, lista: await listaDe(db, correo) });
  }
  if (accion === 'pedir' && esPost) {
    const correo = await correoDeSesion(request, db);
    if (!correo) return json({ error: 'Inicia sesión para hacer un pedido.' }, 401);
    const acc = await accesoDe(db, correo);
    const porVales = acc.canje && !acc.activo;                 // plan "Películas por pedido": cada película cuesta 1 vale
    if (porVales) {
      if (acc.vales < 1) return json({ error: 'Ya canjeaste todas tus películas. Canjea otro código para pedir otra.' }, 403);
    } else if (!acc.activo || !PLANES_CON_PEDIDOS.includes(acc.plan)) return json({ error: 'Tu plan no incluye pedidos.' }, 403);

    const tmdb = Math.floor(Number(cuerpo.tmdb));
    const tipo = cuerpo.tipo === 'tv' ? 'tv' : 'movie';
    const titulo = String(cuerpo.titulo || '').trim().slice(0, 100);
    const anio = /^\d{4}$/.test(String(cuerpo.anio || '')) ? String(cuerpo.anio) : '';
    const poster = /^\/[\w.-]{1,60}$/.test(String(cuerpo.poster || '')) ? String(cuerpo.poster) : '';
    if (!(tmdb > 0) || !titulo) return json({ error: 'Pedido no válido.' }, 400);
    if (porVales && tipo === 'tv') return json({ error: 'Con este plan solo puedes pedir películas.' }, 400);

    /* La película ya está en la biblioteca: se agrega directo a la lista de la cuenta (cuesta 1 vale si es por vales) */
    const biblioteca = String(cuerpo.biblioteca || '').trim().slice(0, 200);
    if (biblioteca) {
      const yaEnLista = (await listaDe(db, correo)).some(x => x.t === biblioteca || (x.id && Number(x.id) === tmdb));
      const r = await asignarLista(db, correo, biblioteca, tmdb, null);
      if (r.error) return json({ error: r.error }, r.status);
      const vales = porVales && !yaEnLista ? (await ajustarVales(db, correo, -1)).vales : acc.vales;
      return json({ lista: r.lista, ...(porVales ? { vales } : {}) });
    }

    const mios = await pedidosDe(db, correo);
    if (mios.some(x => x.tmdb === tmdb && x.tipo === tipo && x.estado !== 'rechazado')) return json({ error: 'Ya hiciste este pedido.' }, 409);
    if (mios.filter(x => x.estado === 'pendiente').length >= 10) return json({ error: 'Tienes 10 pedidos pendientes. Espera a que se cumplan algunos.' }, 429);

    const id = Date.now().toString(36) + b64url(crypto.getRandomValues(new Uint8Array(4)));
    const creado = Date.now();
    const ped = { id, correo, tmdb, tipo, titulo, anio, poster, estado: 'pendiente', creado, ...(porVales ? { vale: true } : {}) };
    const pasos = [db.prepare("INSERT INTO pedidos (id, correo, tmdb, tipo, titulo, anio, poster, estado, creado, vale) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pendiente', ?8, ?9)")
      .bind(id, correo, tmdb, tipo, titulo, anio, poster, creado, porVales ? 1 : 0)];
    if (porVales) pasos.push(db.prepare('UPDATE usuarios SET vales = MAX(0, vales - 1) WHERE correo = ?1').bind(correo));
    await db.batch(pasos);                                     // el pedido y el vale se guardan juntos o no se guarda ninguno
    {                                                          // aviso al administrador (app Black BOX Admin): «Nuevo pedido»
      let pend = 0; try { pend = (await db.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE estado = 'pendiente'").first()).n || 0; } catch (e) {}
      const pa = avisarAdmins(env, { titulo: 'Nuevo pedido', texto: '«' + titulo + '»' + (anio ? ' (' + anio + ')' : '') + ' · ' + correo + (pend > 1 ? ' · ' + pend + ' pendientes' : ''), datos: { tipo: 'pedido_nuevo', id } });
      if (waitUntil) waitUntil(pa);
    }
    const vales = porVales ? (await accesoDe(db, correo)).vales : undefined;
    return json({ pedido: ped, ...(porVales ? { vales } : {}) });
  }

  /* ---- Películas publicadas desde el panel (D1) ---- */
  if (accion === 'extras' && request.method === 'GET') {
    let items = [];
    try {
      if (db) {
        await prepararCatalogo(db, kv);
        const r = await db.prepare('SELECT titulo, tmdb, link, tipo, episodios, version, proximamente FROM publicados ORDER BY creado, tmdb').all();
        items = r.results.map(i => { const eps = epsDe(i.episodios), px = !!i.proximamente; return { titulo: i.titulo, tmdb: i.tmdb, link: px ? '' : i.link, version: i.version === 'subtitulada' ? 'subtitulada' : 'latino', ...(px ? { proximamente: true } : {}), ...(i.tipo === 'serie' ? { tipo: 'serie' } : {}), ...(!px && Object.keys(eps).length ? { episodios: eps } : {}) }; });
      }
    } catch (e) { console.error('[extras]', e && e.message); }
    let cols = [];
    try { if (db) { const r = await db.prepare('SELECT datos FROM colecciones ORDER BY creado, id').all(); cols = r.results.map(x => datosCol(x.datos)).filter(Boolean).map(colParaPagina); } } catch (e) { console.error('[extras colecciones]', e && e.message); }
    let secs = [];
    try { if (db) { const r = await db.prepare('SELECT datos FROM secciones ORDER BY creado, id').all(); secs = r.results.map(x => datosSec(x.datos)).filter(Boolean); } } catch (e) { console.error('[extras secciones]', e && e.message); }
    let acc = {};
    try { if (db) { const r = await db.prepare("SELECT valor FROM meta WHERE clave = 'acceso'").first(); if (r && r.valor) acc = JSON.parse(r.valor) || {}; } } catch (e) {}
    let efe = {};
    try { if (db) { const r = await db.prepare("SELECT valor FROM meta WHERE clave = 'efectos'").first(); if (r && r.valor) efe = JSON.parse(r.valor) || {}; } } catch (e) {}
    let inter = {};
    try { if (db) { const r = await db.prepare("SELECT valor FROM meta WHERE clave = 'interacciones'").first(); if (r && r.valor) inter = JSON.parse(r.valor) || {}; } } catch (e) {}
    let introdb = [];
    try { if (db) { const r = await db.prepare("SELECT valor FROM meta WHERE clave = 'introdb'").first(); if (r && r.valor) introdb = JSON.parse(r.valor) || []; } } catch (e) {}
    let introdbAviso = { segundos: 5 };
    try { if (db) { const r = await db.prepare("SELECT valor FROM meta WHERE clave = 'introdb_aviso'").first(); if (r && r.valor) { const v = JSON.parse(r.valor); const n = Number(v && v.segundos); if (Number.isInteger(n)) introdbAviso.segundos = Math.max(-300, Math.min(600, n)); } } } catch (e) {}
    let sug = {};
    try { if (db) { const r = await db.prepare("SELECT valor FROM meta WHERE clave = 'sugerencia'").first(); if (r && r.valor) sug = JSON.parse(r.valor) || {}; } } catch (e) {}
    const js = 'window.PELICULAS_EXTRA=' + JSON.stringify(items).replace(/</g, '\\u003c') + ';window.COLECCIONES_EXTRA=' + JSON.stringify(cols).replace(/</g, '\\u003c') + ';window.SECCIONES_EXTRA=' + JSON.stringify(secs).replace(/</g, '\\u003c') + ';window.ACCESO_EXTRA=' + JSON.stringify(acc).replace(/</g, '\\u003c') + ';window.EFECTOS_EXTRA=' + JSON.stringify(efe).replace(/</g, '\\u003c') + ';window.INTERACCIONES_EXTRA=' + JSON.stringify(inter).replace(/</g, '\\u003c') + ';window.INTRODB_EXTRA=' + JSON.stringify(introdb).replace(/</g, '\\u003c') + ';window.INTRODB_AVISO_EXTRA=' + JSON.stringify(introdbAviso) + ';window.SUGERENCIA_EXTRA=' + JSON.stringify(sug).replace(/</g, '\\u003c') + ';';
    return new Response(js, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=30' } });
  }

  /* ---- Administración ---- */
  if (accion === 'admin' && esPost) {
    if (!env.ADMIN_CLAVE) return json({ error: 'Falta configurar ADMIN_CLAVE en Cloudflare.' }, 503);
    if (!(await mismaClave(String(cuerpo.clave || ''), String(env.ADMIN_CLAVE)))) {
      return json({ error: 'Clave incorrecta.' }, 401);
    }

    if (cuerpo.op === 'verificar_clave') return json({ ok: true, claveValida: true });

    if (cuerpo.op === 'introdb') {
      let items = [];
      try { const r = await db.prepare("SELECT valor FROM meta WHERE clave = 'introdb'").first(); if (r && r.valor) items = JSON.parse(r.valor) || []; } catch (e) {}
      let avisoSegundos = 5;
      try { const r = await db.prepare("SELECT valor FROM meta WHERE clave = 'introdb_aviso'").first(); if (r && r.valor) { const v = JSON.parse(r.valor), n = Number(v && v.segundos); if (Number.isInteger(n)) avisoSegundos = Math.max(-300, Math.min(600, n)); } } catch (e) {}
      return json({ items, avisoSegundos });
    }
    if (cuerpo.op === 'guardar_introdb') {
      const src = Array.isArray(cuerpo.items) ? cuerpo.items : [];
      const items = [], vistos = new Set();
      for (const x of src.slice(0, 3000)) {
        const tmdb = Math.floor(Number(x && x.tmdb)), tipo = x && x.tipo === 'serie' ? 'serie' : 'pelicula';
        const titulo = String(x && x.titulo || '').trim().slice(0, 200), k = tipo + ':' + tmdb;
        const avisoSegundos = x && x.avisoSegundos != null && x.avisoSegundos !== '' ? Number(x.avisoSegundos) : null;
        if (tmdb > 0 && titulo && !vistos.has(k)) { vistos.add(k); items.push({ tmdb, tipo, titulo, ...(Number.isInteger(avisoSegundos) ? { avisoSegundos: Math.max(-300, Math.min(600, avisoSegundos)) } : {}) }); }
      }
      await db.prepare('CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT) WITHOUT ROWID').run();
      await db.prepare("INSERT INTO meta (clave, valor) VALUES ('introdb', ?1) ON CONFLICT(clave) DO UPDATE SET valor = ?1").bind(JSON.stringify(items)).run();
      let avisoSegundos = 5;
      if (cuerpo.avisoSegundos == null) {
        try { const r = await db.prepare("SELECT valor FROM meta WHERE clave = 'introdb_aviso'").first(); if (r && r.valor) { const v = JSON.parse(r.valor), n = Number(v && v.segundos); if (Number.isInteger(n)) avisoSegundos = Math.max(-300, Math.min(600, n)); } } catch (e) {}
      } else {
        const avisoEntrada = Number(cuerpo.avisoSegundos);
        if (!Number.isInteger(avisoEntrada) || avisoEntrada < -300 || avisoEntrada > 600) return json({ error: 'El tiempo general debe ser un entero entre -300 y 600 segundos.' }, 400);
        avisoSegundos = avisoEntrada;
      }
      await db.prepare("INSERT INTO meta (clave, valor) VALUES ('introdb_aviso', ?1) ON CONFLICT(clave) DO UPDATE SET valor = ?1").bind(JSON.stringify({ segundos: avisoSegundos })).run();
      return json({ items, avisoSegundos });
    }

    /* Teléfonos del administrador que reciben el aviso de pedidos nuevos (app Black BOX Admin) */
    if (cuerpo.op === 'push_registrar') {
      const t = String(cuerpo.token || '').trim();
      if (t.length < 20 || t.length > 4096) return json({ error: 'Token no válido.' }, 400);
      await asegurarPushAdmin(db);
      await db.prepare('INSERT INTO dispositivos_admin (token, plataforma, creado) VALUES (?1, ?2, ?3) ON CONFLICT(token) DO UPDATE SET plataforma = ?2').bind(t, String(cuerpo.plataforma || 'android').slice(0, 20), Date.now()).run();
      return json({ ok: true });
    }
    if (cuerpo.op === 'push_quitar') {
      await asegurarPushAdmin(db);
      await db.prepare('DELETE FROM dispositivos_admin WHERE token = ?1').bind(String(cuerpo.token || '')).run();
      return json({ ok: true });
    }
    if (cuerpo.op === 'push_probar') {
      if (!env.FCM_SERVICE_ACCOUNT) return json({ error: 'Falta el secreto FCM_SERVICE_ACCOUNT en Cloudflare (ver LEEME-PUSH.md).' }, 503);
      await asegurarPushAdmin(db);
      const n = await avisarAdmins(env, { titulo: 'Prueba de Black BOX Admin', texto: 'Si ves esto, los avisos de pedidos nuevos funcionan.', datos: { tipo: 'prueba' } });
      return json(n ? { ok: true, enviados: n } : { error: 'Todavía no hay ningún teléfono registrado. Abre la app, escribe la clave y toca «Activar avisos».' }, n ? 200 : 404);
    }
    if (cuerpo.op === 'push_usuario_probar') {
      if (!env.FCM_SERVICE_ACCOUNT) return json({ error: 'Falta configurar FCM_SERVICE_ACCOUNT en Cloudflare.' }, 503);
      const correo = String(cuerpo.correo || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return json({ error: 'Escribe un correo válido para la cuenta de Black BOX.' }, 400);
      await asegurarPush(db);
      const dispositivos = await db.prepare('SELECT COUNT(*) AS total FROM dispositivos WHERE correo = ?1').bind(correo).first();
      if (!dispositivos || !dispositivos.total) return json({ error: 'Esa cuenta no tiene ningún dispositivo Black BOX registrado. Inicia sesión en la app y activa las notificaciones.' }, 404);
      const clavePrueba = 'push-admin-prueba:' + correo;
      if (await intentosDe(db, clavePrueba)) return json({ error: 'Espera un minuto antes de volver a enviar otra prueba a esta cuenta.' }, 429);
      await sumarIntento(db, clavePrueba, 60);
      const resultado = await avisarUsuario(env, correo, { titulo: 'Notificación de prueba', texto: 'Esta prueba fue enviada desde el panel de administración de Black BOX.', datos: { tipo: 'prueba' } });
      if (resultado.error === 'sin_configuracion') return json({ error: 'No se pudo conectar con el servicio de notificaciones.' }, 503);
      if (!resultado.enviados) return json({ error: 'FCM no pudo entregar la prueba. Revisa Workers Logs para el error [push].' }, 502);
      return json({ ok: true, enviados: resultado.enviados, fallidos: resultado.fallidos });
    }

    const plan = PLANES_OK.includes(cuerpo.plan) ? cuerpo.plan : 'basico';
    const dias = Math.floor(Number(cuerpo.dias));
    const peliculas = Math.floor(Number(cuerpo.peliculas));

    if (cuerpo.op === 'generar') {
      const cantidad = Math.floor(Number(cuerpo.cantidad));
      const vale = plan === 'pedidos';                       // plan "Películas por pedido": el código vale por N películas, no por días
      if (vale && !(peliculas >= 1 && peliculas <= 20)) return json({ error: 'Las películas por código deben ser entre 1 y 20.' }, 400);
      if (!vale && !(dias >= 1 && dias <= 3650)) return json({ error: 'Los días deben ser entre 1 y 3650.' }, 400);
      if (!(cantidad >= 1 && cantidad <= 50)) return json({ error: 'La cantidad debe ser entre 1 y 50.' }, 400);
      const creado = Date.now();
      let codigos = [];
      for (let intento = 0; intento < 3 && !codigos.length; intento++) {
        const nuevos = new Set();
        while (nuevos.size < cantidad) nuevos.add(nuevoCodigo());
        try {
          await db.batch([...nuevos].map(cod => db.prepare('INSERT INTO codigos (codigo, plan, dias, peliculas, creado) VALUES (?1, ?2, ?3, ?4, ?5)')
            .bind(cod, plan, vale ? null : dias, vale ? peliculas : null, creado)));
          codigos = [...nuevos];
        } catch (e) { if (!/unique|constraint/i.test(String(e && e.message))) throw e; }   // choque de códigos (casi imposible): se reintenta
      }
      if (!codigos.length) return json({ error: 'No se pudieron generar los códigos. Inténtalo de nuevo.' }, 500);
      return json(vale ? { codigos, plan, peliculas } : { codigos, dias, plan });
    }

    if (cuerpo.op === 'listar') {
      await db.prepare('CREATE TABLE IF NOT EXISTS codigos_canje_info (codigo TEXT PRIMARY KEY, pais TEXT, ciudad TEXT, canjeado INTEGER NOT NULL) WITHOUT ROWID').run();
      const r = await db.prepare('SELECT c.codigo, c.plan, c.dias, c.peliculas, c.creado, c.usado_por, c.usado_fecha, u.pais AS pais_canje, u.ciudad AS ciudad_canje FROM codigos c LEFT JOIN codigos_canje_info u ON u.codigo = c.codigo ORDER BY c.creado DESC LIMIT 2000').all();
      return json({ codigos: r.results.map(k => ({
        codigo: k.codigo, plan: k.plan, creado: k.creado,
        ...(k.dias != null ? { dias: k.dias } : {}), ...(k.peliculas != null ? { peliculas: k.peliculas } : {}),
        usado: k.usado_por ? { por: k.usado_por, fecha: k.usado_fecha, ubicacion: { pais: k.pais_canje || '', ciudad: k.ciudad_canje || '' } } : null,
      })) });
    }

    if (cuerpo.op === 'conceder') {
      const correo = limpiarCorreo(cuerpo.correo);
      const vale = plan === 'pedidos' && cuerpo.peliculas !== undefined && cuerpo.peliculas !== '';
      if (vale && !(peliculas >= 1 && peliculas <= 50)) return json({ error: 'Las películas deben ser entre 1 y 50.' }, 400);
      if (!vale && !(dias >= 1 && dias <= 3650)) return json({ error: 'Los días deben ser entre 1 y 3650.' }, 400);
      if (!correo || !(await db.prepare('SELECT 1 AS x FROM usuarios WHERE correo = ?1').bind(correo).first())) return json({ error: 'Ese correo no tiene cuenta.' }, 404);
      return json({ correo, acceso: vale ? await ajustarVales(db, correo, peliculas) : await sumarDias(db, correo, dias, plan) });
    }

    if (cuerpo.op === 'pedidos') {
      const r = await db.prepare("SELECT * FROM pedidos ORDER BY CASE estado WHEN 'pendiente' THEN 0 WHEN 'listo' THEN 1 ELSE 2 END, creado DESC LIMIT 300").all();
      return json({ pedidos: r.results.map(filaPedido) });
    }

    if (cuerpo.op === 'cuenta') {
      const correo = limpiarCorreo(cuerpo.correo);
      if (!correo || !(await db.prepare('SELECT 1 AS x FROM usuarios WHERE correo = ?1').bind(correo).first())) return json({ error: 'Ese correo no tiene cuenta.' }, 404);
      return json({ correo, ...(await estadoDe(db, correo)) });
    }

    if (cuerpo.op === 'asignar') {
      const correo = limpiarCorreo(cuerpo.correo);
      const r = await asignarLista(db, correo, String(cuerpo.titulo || '').trim().slice(0, 200), Math.floor(Number(cuerpo.tmdb)) || null, cuerpo.pedido, avisarAprobado);
      if (r.error) return json({ error: r.error }, r.status);
      return json({ correo, lista: r.lista });
    }

    if (cuerpo.op === 'publicar') {
      const titulo = String(cuerpo.titulo || '').trim().slice(0, 200);
      const tmdb = Math.floor(Number(cuerpo.tmdb)) || 0;
      const link = String(cuerpo.link || '').trim();
      if (!titulo || !tmdb) return json({ error: 'Faltan el título o el código de TMDB.' }, 400);
      if (!/^https?:\/\/\S{4,2000}$/.test(link)) return json({ error: 'El enlace debe empezar con http:// o https://' }, 400);
      await prepararCatalogo(db, kv);
      const tipo = cuerpo.tipo === 'serie' ? 'serie' : 'pelicula';
      const version = cuerpo.version === 'subtitulada' ? 'subtitulada' : cuerpo.version === 'latino' ? 'latino' : null;
      const ya = await db.prepare('SELECT 1 AS x FROM publicados WHERE tmdb = ?1').bind(tmdb).first();
      if (!ya && (await totalPublicados(db)) >= 1500) return json({ error: 'Ya hay demasiadas películas publicadas desde el panel.' }, 400);
      await db.prepare("INSERT INTO publicados (tmdb, titulo, tipo, link, episodios, version, proximamente, creado) VALUES (?1, ?2, ?3, ?4, '{}', COALESCE(?5, 'latino'), 0, ?6) ON CONFLICT(tmdb) DO UPDATE SET titulo = ?2, tipo = ?3, link = ?4, version = COALESCE(?5, publicados.version), proximamente = 0")
        .bind(tmdb, titulo, tipo, link, version, Date.now()).run();       // si ya existía, se conservan sus capítulos sueltos
      if (cuerpo.introdb !== undefined) await guardarIntroDbTitulo(db, tmdb, tipo, titulo, cuerpo.introdb === true);
      let lista = null;
      if (cuerpo.correo) {
        const r = await asignarLista(db, limpiarCorreo(cuerpo.correo), titulo, tmdb, cuerpo.pedido, avisarAprobado);
        if (r.error) return json({ error: 'Se publicó, pero: ' + r.error }, r.status);
        lista = r.lista;
      }
      return json({ publicadas: await totalPublicados(db), lista });
    }

    if (cuerpo.op === 'publicadas') {
      await prepararCatalogo(db, kv);
      const r = await db.prepare('SELECT titulo, tmdb, link, tipo, episodios, version, proximamente FROM publicados ORDER BY creado DESC').all();
      return json({ items: r.results.map(i => ({ titulo: i.titulo, tmdb: i.tmdb, link: i.link, tipo: i.tipo, version: i.version === 'subtitulada' ? 'subtitulada' : 'latino', proximamente: !!i.proximamente, eps: Object.keys(epsDe(i.episodios)).length })) });
    }

    if (cuerpo.op === 'r2_buscar') {
      try { return json(await buscarArchivosR2(env, request, cuerpo.q, cuerpo.actualizar === true)); }
      catch (e) { return json({ error: e && e.message ? e.message : 'No se pudieron consultar los archivos de R2.' }, 400); }
    }

    if (cuerpo.op === 'version_titulo') {
      await prepararCatalogo(db, kv);
      const tmdb = Math.floor(Number(cuerpo.tmdb)) || 0, version = cuerpo.version;
      if (!tmdb) return json({ error: 'Falta el código de TMDB.' }, 400);
      if (version !== 'latino' && version !== 'subtitulada') return json({ error: 'Elige Español latino o Subtitulada.' }, 400);
      const existe = await db.prepare('SELECT 1 AS x FROM publicados WHERE tmdb = ?1').bind(tmdb).first();
      if (!existe) return json({ error: 'Ese título ya no está registrado en la biblioteca.' }, 404);
      await db.prepare('UPDATE publicados SET version = ?2 WHERE tmdb = ?1').bind(tmdb, version).run();
      return json({ tmdb, version });
    }

    if (cuerpo.op === 'actualizar_publicacion') {
      await prepararCatalogo(db, kv);
      const tmdb = Math.floor(Number(cuerpo.tmdb)) || 0, titulo = String(cuerpo.titulo || '').trim().slice(0, 200);
      const tipo = cuerpo.tipo === 'serie' ? 'serie' : 'pelicula', version = cuerpo.version === 'subtitulada' ? 'subtitulada' : cuerpo.version === 'latino' ? 'latino' : null;
      if (!tmdb || !titulo || !version) return json({ error: 'Faltan el título o la versión.' }, 400);
      const existe = await db.prepare('SELECT 1 AS x FROM publicados WHERE tmdb = ?1').bind(tmdb).first();
      if (!existe) return json({ error: 'Este título no está publicado desde Admin. Para agregarlo por primera vez necesitas su enlace.' }, 404);
      await db.prepare('UPDATE publicados SET titulo = ?2, tipo = ?3, version = ?4 WHERE tmdb = ?1').bind(tmdb, titulo, tipo, version).run();
      if (cuerpo.introdb !== undefined) await guardarIntroDbTitulo(db, tmdb, tipo, titulo, cuerpo.introdb === true);
      return json({ tmdb, titulo, tipo, version, actualizada: true });
    }

    if (cuerpo.op === 'estado_publicacion') {
      await prepararCatalogo(db, kv);
      const tmdb = Math.floor(Number(cuerpo.tmdb)) || 0, proximamente = cuerpo.proximamente === true ? 1 : 0;
      const existe = await db.prepare('SELECT 1 AS x FROM publicados WHERE tmdb = ?1').bind(tmdb).first();
      if (!existe) return json({ error: 'Ese título ya no está registrado en la biblioteca.' }, 404);
      await db.prepare('UPDATE publicados SET proximamente = ?2 WHERE tmdb = ?1').bind(tmdb, proximamente).run();
      return json({ tmdb, proximamente: !!proximamente });
    }

    /* Capítulos sueltos de una serie: ver los guardados y guardar/actualizar uno ("1x3" = temporada 1, capítulo 3). */
    if (cuerpo.op === 'episodios') {
      await prepararCatalogo(db, kv);
      const tmdb = Math.floor(Number(cuerpo.tmdb)) || 0;
      const it = await db.prepare('SELECT link, episodios FROM publicados WHERE tmdb = ?1').bind(tmdb).first();
      return json({ episodios: it ? epsDe(it.episodios) : {}, plantilla: (it && it.link) || '' });
    }

    if (cuerpo.op === 'publicar_ep') {
      const titulo = String(cuerpo.titulo || '').trim().slice(0, 200);
      const tmdb = Math.floor(Number(cuerpo.tmdb)) || 0;
      const t = Math.floor(Number(cuerpo.t)), e = Math.floor(Number(cuerpo.e));
      const link = String(cuerpo.link || '').trim();
      if (!titulo || !tmdb) return json({ error: 'Faltan el título o el código de TMDB.' }, 400);
      if (!(t >= 1 && t <= 100 && e >= 1 && e <= 1000)) return json({ error: 'Temporada o capítulo no válidos.' }, 400);
      if (!/^https?:\/\/\S{4,2000}$/.test(link)) return json({ error: 'El enlace debe empezar con http:// o https://' }, 400);
      await prepararCatalogo(db, kv);
      const k = t + 'x' + e;
      const version = cuerpo.version === 'subtitulada' ? 'subtitulada' : cuerpo.version === 'latino' ? 'latino' : null;
      const ya = await db.prepare('SELECT episodios FROM publicados WHERE tmdb = ?1').bind(tmdb).first();
      if (!ya) {
        if ((await totalPublicados(db)) >= 1500) return json({ error: 'Ya hay demasiadas películas publicadas desde el panel.' }, 400);
        await db.prepare("INSERT OR IGNORE INTO publicados (tmdb, titulo, tipo, link, episodios, creado) VALUES (?1, ?2, 'serie', '', '{}', ?3)").bind(tmdb, titulo, Date.now()).run();
      } else {
        const eps = epsDe(ya.episodios);
        if (!eps[k] && Object.keys(eps).length >= 3000) return json({ error: 'Esta serie ya tiene demasiados capítulos.' }, 400);
      }
      await db.prepare("UPDATE publicados SET titulo = ?2, tipo = 'serie', episodios = json_set(episodios, ?3, ?4), version = COALESCE(?5, version), proximamente = 0 WHERE tmdb = ?1")
        .bind(tmdb, titulo, '$."' + k + '"', link, version).run();       // cambia solo ese capítulo, de un solo golpe
      if (cuerpo.introdb !== undefined) await guardarIntroDbTitulo(db, tmdb, 'serie', titulo, cuerpo.introdb === true);
      const r = await db.prepare('SELECT episodios FROM publicados WHERE tmdb = ?1').bind(tmdb).first();
      return json({ episodios: epsDe(r && r.episodios) });
    }

    if (cuerpo.op === 'despublicar') {
      await prepararCatalogo(db, kv);
      const tmdb = Math.floor(Number(cuerpo.tmdb)) || 0;
      await db.prepare('DELETE FROM publicados WHERE tmdb = ?1').bind(tmdb).run();
      return json({ publicadas: await totalPublicados(db) });
    }

    /* Colecciones del inicio creadas desde el panel */
    /* Pantalla de acceso de la app: logo y textos (se guardan en la tabla meta) */
    if (cuerpo.op === 'acceso') {
      let v = {};
      try { const r = await db.prepare("SELECT valor FROM meta WHERE clave = 'acceso'").first(); if (r && r.valor) v = JSON.parse(r.valor) || {}; } catch (e) {}
      return json({ item: v });
    }
    if (cuerpo.op === 'guardar_acceso') {
      const a = cuerpo.acceso || {};
      const t = (x, n) => String(x == null ? '' : x).trim().slice(0, n);
      const logo = urlCol(a.logo);
      if (logo === null) return json({ error: 'El logo debe ser un enlace que empiece con https:// (o una ruta como /logo.png).' }, 400);
      const br = Number(a.brillo);
      const v = { titulo: t(a.titulo, 60), subtitulo: t(a.subtitulo, 240), canje: t(a.canje, 300), explorar: t(a.explorar, 30), logo, brillo: isFinite(br) && a.brillo !== '' && a.brillo != null ? Math.max(0, Math.min(100, Math.round(br))) : 60 };
      await db.prepare('CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT) WITHOUT ROWID').run();
      await db.prepare("INSERT INTO meta (clave, valor) VALUES ('acceso', ?1) ON CONFLICT(clave) DO UPDATE SET valor = ?1").bind(JSON.stringify(v)).run();
      return json({ ok: true });
    }

    /* Efectos visuales (cristal de la barra inferior y del panel de acceso): valores de los deslizadores */
    const EF_RANGOS = { rebote: [0, 100, 30], velocidad: [0, 100, 60], intensidad: [0, 100, 60], brilloFondo: [0, 100, 58], desenfoque: [0, 20, 3], agrandar: [0, 40, 12], estirar: [0, 100, 50], panel: [0, 40, 28] };
    if (cuerpo.op === 'efectos') {
      let v = {};
      try { const r = await db.prepare("SELECT valor FROM meta WHERE clave = 'efectos'").first(); if (r && r.valor) v = JSON.parse(r.valor) || {}; } catch (e) {}
      return json({ item: v });
    }
    if (cuerpo.op === 'guardar_efectos') {
      const a = cuerpo.efectos || {}, v = {};
      for (const k in EF_RANGOS) { const [mn, mx, d] = EF_RANGOS[k], n = Number(a[k]); v[k] = (a[k] === '' || a[k] == null || !isFinite(n)) ? d : Math.max(mn, Math.min(mx, Math.round(n))); }
      await db.prepare('CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT) WITHOUT ROWID').run();
      await db.prepare("INSERT INTO meta (clave, valor) VALUES ('efectos', ?1) ON CONFLICT(clave) DO UPDATE SET valor = ?1").bind(JSON.stringify(v)).run();
      return json({ ok: true });
    }

    /* Animaciones, transiciones y vibraciones asignadas a gestos e interacciones */
    const IN_ANIM = ['ninguna', 'rebote', 'hundir', 'pulso', 'sacudir', 'giro', 'brillo', 'onda'];
    const IN_VIB = ['ninguna', 'suave', 'medio', 'fuerte', 'doble', 'triple', 'largo', 'tic', 'clic', 'pesado', 'latido', 'rampa', 'subida', 'caida', 'seco', 'espiral', 'resorte', 'textura', 'confirmar', 'rechazar', 'segmento', 'interruptor', 'agarrar'];
    const IN_M = ['mantener', 'doble', 'flick', 'borde', 'arrastre'];
    const IN_TRANS = ['auto', 'fundido', 'deslizar', 'zoom', 'subir', 'ninguna'];
    const IN_AV = ['tarjeta', 'principal', 'dock', 'atras', 'cuenta', 'menu', 'control', 'episodio'];
    const IN_V = ['carrusel', 'slider', 'perfil', 'reproducir'];
    const IN_T = ['seccion', 'ficha', 'busqueda'];
    if (cuerpo.op === 'interacciones') {
      let v = {};
      try { const r = await db.prepare("SELECT valor FROM meta WHERE clave = 'interacciones'").first(); if (r && r.valor) v = JSON.parse(r.valor) || {}; } catch (e) {}
      return json({ item: v });
    }
    if (cuerpo.op === 'guardar_interacciones') {
      const a = cuerpo.interacciones || {}, ai = a.i || {}, at = a.t || {}, v = { i: {}, t: {} };
      for (const k of IN_AV) { const x = ai[k] || {}, sp = Number(x.speed); v.i[k] = { a: IN_ANIM.includes(x.a) ? x.a : 'ninguna', v: IN_VIB.includes(x.v) ? x.v : 'ninguna', speed: isFinite(sp) ? Math.max(50, Math.min(200, Math.round(sp))) : 100 }; }
      for (const k of IN_V) { const x = ai[k] || {}; v.i[k] = { a: 'ninguna', v: IN_VIB.includes(x.v) ? x.v : 'ninguna' }; }
      for (const k of IN_T) {
        const x = at[k] || {}, estilo = typeof x === 'string' ? x : (x.style || x.estilo), sp = Number(x.speed);
        v.t[k] = { style: IN_TRANS.includes(estilo) ? estilo : 'auto', speed: isFinite(sp) ? Math.max(50, Math.min(200, Math.round(sp))) : 100 };
      }
      const am = a.m || {}; v.m = {};
      for (const k of IN_M) v.m[k] = IN_VIB.includes(am[k]) ? am[k] : 'ninguna';
      const pn = Number(am.paso), it = Number(am.intensidad);
      v.m.paso = isFinite(pn) ? Math.max(16, Math.min(160, Math.round(pn))) : 48;
      v.m.intensidad = isFinite(it) ? Math.max(10, Math.min(100, Math.round(it))) : 70;
      await db.prepare('CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT) WITHOUT ROWID').run();
      await db.prepare("INSERT INTO meta (clave, valor) VALUES ('interacciones', ?1) ON CONFLICT(clave) DO UPDATE SET valor = ?1").bind(JSON.stringify(v)).run();
      return json({ ok: true });
    }

    if (cuerpo.op === 'sugerencia') {
      const clave = 'sugerencia';
      let item = {};
      try { const r = await db.prepare('SELECT valor FROM meta WHERE clave = ?1').bind(clave).first(); if (r && r.valor) item = JSON.parse(r.valor) || {}; } catch (e) {}
      return json({ item });
    }
    if (cuerpo.op === 'guardar_sugerencia') {
      const a = cuerpo.sugerencia || {}, n = (v, d) => Math.max(0, Math.min(100, Math.round(Number.isFinite(+v) ? +v : d)));
      const v = { estilo: ['cristal', 'azul', 'claro'].includes(a.estilo) ? a.estilo : 'cristal', playX: n(a.playX, 4), playY: Math.max(55, Math.min(80, n(a.playY, 68))), cancelX: n(a.cancelX, 52), cancelY: Math.max(55, Math.min(80, n(a.cancelY, 68))) };
      await db.prepare('CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT) WITHOUT ROWID').run();
      await db.prepare("INSERT INTO meta (clave, valor) VALUES ('sugerencia', ?1) ON CONFLICT(clave) DO UPDATE SET valor = ?1").bind(JSON.stringify(v)).run();
      return json({ ok: true });
    }

    if (cuerpo.op === 'colecciones') {
      await prepararCatalogo(db, kv);
      const r = await db.prepare('SELECT datos FROM colecciones ORDER BY creado, id').all();
      return json({ items: r.results.map(x => datosCol(x.datos)).filter(Boolean) });
    }

    if (cuerpo.op === 'guardar_col') {
      const v = limpiarCol(cuerpo.col);
      if (v.error) return json({ error: v.error }, 400);
      await prepararCatalogo(db, kv);
      const ya = await db.prepare('SELECT 1 AS x FROM colecciones WHERE id = ?1').bind(v.col.id).first();
      if (!ya && (await db.prepare('SELECT COUNT(*) AS n FROM colecciones').first()).n >= 100) return json({ error: 'Ya hay demasiadas colecciones creadas desde el panel.' }, 400);
      await db.prepare('INSERT INTO colecciones (id, datos, creado) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET datos = ?2')
        .bind(v.col.id, JSON.stringify(v.col), Date.now()).run();      // si ya existía, se actualiza y conserva su lugar
      return json({ ok: true, id: v.col.id, nueva: !ya });
    }

    if (cuerpo.op === 'borrar_col') {
      await prepararCatalogo(db, kv);
      await db.prepare('DELETE FROM colecciones WHERE id = ?1').bind(String(cuerpo.id || '').slice(0, 60)).run();
      return json({ ok: true });
    }

    /* Secciones temáticas */
    if (cuerpo.op === 'secciones') {
      await prepararCatalogo(db, kv);
      const r = await db.prepare('SELECT datos FROM secciones ORDER BY creado, id').all();
      return json({ items: r.results.map(x => datosSec(x.datos)).filter(Boolean) });
    }

    if (cuerpo.op === 'guardar_sec') {
      const v = limpiarSec(cuerpo.sec);
      if (v.error) return json({ error: v.error }, 400);
      await prepararCatalogo(db, kv);
      const ya = await db.prepare('SELECT 1 AS x FROM secciones WHERE id = ?1').bind(v.sec.id).first();
      if (!ya && (await db.prepare('SELECT COUNT(*) AS n FROM secciones').first()).n >= 60) return json({ error: 'Ya hay demasiadas secciones creadas desde el panel.' }, 400);
      await db.prepare('INSERT INTO secciones (id, datos, creado) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET datos = ?2')
        .bind(v.sec.id, JSON.stringify(v.sec), Date.now()).run();      // si ya existía, se actualiza y conserva su lugar en la lista
      return json({ ok: true, id: v.sec.id, nueva: !ya });
    }

    if (cuerpo.op === 'ordenar_sec') {      // guarda en qué lugar de la página va cada sección: [{ id, despues, orden }]
      await prepararCatalogo(db, kv);
      const L = (Array.isArray(cuerpo.orden) ? cuerpo.orden : []).slice(0, 100)
        .filter(x => x && /^[a-z0-9][a-z0-9-]{0,39}$/.test(String(x.id || '')) && ANCLAS_SEC.has(x.despues));
      if (L.length) await db.batch(L.map(x => db.prepare("UPDATE secciones SET datos = json_set(datos, '$.despues', ?2, '$.orden', ?3) WHERE id = ?1")
        .bind(String(x.id), x.despues, Math.max(0, Math.min(999, Math.floor(Number(x.orden)) || 0)))));
      return json({ ok: true });
    }

    if (cuerpo.op === 'borrar_sec') {
      await prepararCatalogo(db, kv);
      await db.prepare('DELETE FROM secciones WHERE id = ?1').bind(String(cuerpo.id || '').slice(0, 60)).run();
      return json({ ok: true });
    }

    if (cuerpo.op === 'quitar') {
      const correo = limpiarCorreo(cuerpo.correo);
      await db.prepare('DELETE FROM lista WHERE correo = ?1 AND titulo = ?2').bind(correo, String(cuerpo.titulo || '')).run();
      return json({ correo, lista: await listaDe(db, correo) });
    }

    if (cuerpo.op === 'rechazar') {
      const q = await db.prepare('SELECT id, correo, titulo, poster, estado, vale FROM pedidos WHERE id = ?1').bind(String(cuerpo.pedido || '')).first();
      if (!q) return json({ error: 'Ese pedido ya no existe.' }, 404);
      const pasos = [db.prepare("UPDATE pedidos SET estado = 'rechazado', vale = 0 WHERE id = ?1").bind(q.id)];
      if (q.estado === 'pendiente' && q.vale) pasos.push(db.prepare('UPDATE usuarios SET vales = vales + 1, canje = 1 WHERE correo = ?1').bind(q.correo));   // pedido rechazado: se le devuelve la película
      await db.batch(pasos);
      if (q.estado === 'pendiente') {
        const texto = q.vale
          ? 'Tu solicitud de «' + q.titulo + '» fue rechazada. El vale usado se devolvió a tu cuenta.'
          : 'Tu solicitud de «' + q.titulo + '» fue rechazada.';
        const imagen = posterDePedido(q.poster);
        const p = avisarUsuario(env, q.correo, { titulo: 'Pedido rechazado', texto, datos: { tipo: 'pedido_rechazado', titulo: q.titulo, valeDevuelto: !!q.vale, ...(imagen ? { poster: imagen } : {}) } });
        if (waitUntil) waitUntil(p);
      }
      return json({ ok: true });
    }

    return json({ error: 'Operación no válida.' }, 400);
  }

  return json({ error: 'No encontrado.' }, 404);
}

export async function onRequest(ctx) {
  // /extras solo usa KV; todo lo demás necesita la base de datos D1
  if (ctx.params.accion !== 'extras' && !ctx.env.DB) {
    return json({ error: 'La base de datos de usuarios no está conectada: falta el binding DB (D1) en wrangler.jsonc.' }, 503);
  }
  try { return await manejar(ctx); }
  catch (e) {
    const m = String((e && e.message) || e);
    console.error('[usuario]', ctx.params.accion, m);
    return json({ error: /no such table/i.test(m) ? 'Faltan las tablas: pega y ejecuta schema.sql en la consola de D1.' : 'Error del servidor: ' + m }, 500);
  }
}
