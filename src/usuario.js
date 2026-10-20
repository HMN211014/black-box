/* Cuentas de usuario (correo + contraseña), tiempo de acceso y códigos canjeables para Black BOX.
   Los datos viven en D1 (binding DB). El progreso va a R2 (binding DATOS) y, si no está conectado, a D1.
   Las películas publicadas desde el panel viven en D1 (tablas publicados y meta). El KV (binding USUARIOS) solo se lee una vez para copiarlas.
   Ruta:  /api/usuario/registro | entrar | salir | yo | datos | canjear | pedir | pedidos | extras | admin */

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
async function asignarLista(db, correo, titulo, tmdb, pedidoId) {
  if (!titulo) return { error: 'Escribe el título tal como está en el catálogo.', status: 400 };
  if (!correo || !(await db.prepare('SELECT 1 AS x FROM usuarios WHERE correo = ?1').bind(correo).first())) return { error: 'Ese correo no tiene cuenta.', status: 404 };
  const ya = await db.prepare('SELECT 1 AS x FROM lista WHERE correo = ?1 AND titulo = ?2').bind(correo, titulo).first();
  if (!ya) {
    const n = await db.prepare('SELECT COUNT(*) AS n FROM lista WHERE correo = ?1').bind(correo).first();
    if (n.n >= 500) return { error: 'La lista de esa cuenta ya es muy larga.', status: 400 };
    await db.prepare('INSERT OR IGNORE INTO lista (correo, titulo, tmdb, fecha) VALUES (?1, ?2, ?3, ?4)').bind(correo, titulo, tmdb || null, Date.now()).run();
  }
  if (pedidoId) {
    await db.prepare("UPDATE pedidos SET estado = 'listo', listo = ?1 WHERE id = ?2 AND correo = ?3").bind(Date.now(), String(pedidoId), correo).run();
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
      db.prepare("CREATE TABLE IF NOT EXISTS publicados (tmdb INTEGER PRIMARY KEY, titulo TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'pelicula', link TEXT NOT NULL DEFAULT '', episodios TEXT NOT NULL DEFAULT '{}', creado INTEGER NOT NULL)"),
      db.prepare('CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT) WITHOUT ROWID'),
      db.prepare('CREATE TABLE IF NOT EXISTS colecciones (id TEXT PRIMARY KEY, datos TEXT NOT NULL, creado INTEGER NOT NULL)'),
      db.prepare('CREATE TABLE IF NOT EXISTS secciones (id TEXT PRIMARY KEY, datos TEXT NOT NULL, creado INTEGER NOT NULL)')
    ]);
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

async function manejar({ request, env, params }) {
  const db = env.DB;
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
      const texto = JSON.stringify({ datos: limpio, act: Date.now() });
      if (texto.length > 400000) return json({ error: 'Hay demasiados datos para guardar.' }, 413);
      const previo = await leerDatos(env, correo);
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
    const tomado = c && !c.usado_por
      ? await db.prepare('UPDATE codigos SET usado_por = ?1, usado_fecha = ?2 WHERE codigo = ?3 AND usado_por IS NULL').bind(correo, Date.now(), codigo).run()
      : null;
    if (!tomado || !tomado.meta || tomado.meta.changes !== 1) {
      await sumarIntento(db, kFallos, 900);
      return json({ error: 'Código no válido o ya usado.' }, 400);
    }
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
    const vales = porVales ? (await accesoDe(db, correo)).vales : undefined;
    return json({ pedido: ped, ...(porVales ? { vales } : {}) });
  }

  /* ---- Películas publicadas desde el panel (D1) ---- */
  if (accion === 'extras' && request.method === 'GET') {
    let items = [];
    try {
      if (db) {
        await prepararCatalogo(db, kv);
        const r = await db.prepare('SELECT titulo, tmdb, link, tipo, episodios FROM publicados ORDER BY creado, tmdb').all();
        items = r.results.map(i => { const eps = epsDe(i.episodios); return { titulo: i.titulo, tmdb: i.tmdb, link: i.link, ...(i.tipo === 'serie' ? { tipo: 'serie' } : {}), ...(Object.keys(eps).length ? { episodios: eps } : {}) }; });
      }
    } catch (e) { console.error('[extras]', e && e.message); }
    let cols = [];
    try { if (db) { const r = await db.prepare('SELECT datos FROM colecciones ORDER BY creado, id').all(); cols = r.results.map(x => datosCol(x.datos)).filter(Boolean).map(colParaPagina); } } catch (e) { console.error('[extras colecciones]', e && e.message); }
    let secs = [];
    try { if (db) { const r = await db.prepare('SELECT datos FROM secciones ORDER BY creado, id').all(); secs = r.results.map(x => datosSec(x.datos)).filter(Boolean); } } catch (e) { console.error('[extras secciones]', e && e.message); }
    const js = 'window.PELICULAS_EXTRA=' + JSON.stringify(items).replace(/</g, '\\u003c') + ';window.COLECCIONES_EXTRA=' + JSON.stringify(cols).replace(/</g, '\\u003c') + ';window.SECCIONES_EXTRA=' + JSON.stringify(secs).replace(/</g, '\\u003c') + ';';
    return new Response(js, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=30' } });
  }

  /* ---- Administración ---- */
  if (accion === 'admin' && esPost) {
    if (!env.ADMIN_CLAVE) return json({ error: 'Falta configurar ADMIN_CLAVE en Cloudflare.' }, 503);
    const kIp = 'af:' + (request.headers.get('CF-Connecting-IP') || 'x');
    if ((await intentosDe(db, kIp)) >= 10) return json({ error: 'Demasiados intentos. Espera unos minutos.' }, 429);
    if (!(await mismaClave(String(cuerpo.clave || ''), String(env.ADMIN_CLAVE)))) {
      await sumarIntento(db, kIp, 900);
      return json({ error: 'Clave incorrecta.' }, 401);
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
      const r = await db.prepare('SELECT codigo, plan, dias, peliculas, creado, usado_por, usado_fecha FROM codigos ORDER BY creado DESC LIMIT 2000').all();
      return json({ codigos: r.results.map(k => ({
        codigo: k.codigo, plan: k.plan, creado: k.creado,
        ...(k.dias != null ? { dias: k.dias } : {}), ...(k.peliculas != null ? { peliculas: k.peliculas } : {}),
        usado: k.usado_por ? { por: k.usado_por, fecha: k.usado_fecha } : null,
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
      const r = await asignarLista(db, correo, String(cuerpo.titulo || '').trim().slice(0, 200), Math.floor(Number(cuerpo.tmdb)) || null, cuerpo.pedido);
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
      const ya = await db.prepare('SELECT 1 AS x FROM publicados WHERE tmdb = ?1').bind(tmdb).first();
      if (!ya && (await totalPublicados(db)) >= 1500) return json({ error: 'Ya hay demasiadas películas publicadas desde el panel.' }, 400);
      await db.prepare("INSERT INTO publicados (tmdb, titulo, tipo, link, episodios, creado) VALUES (?1, ?2, ?3, ?4, '{}', ?5) ON CONFLICT(tmdb) DO UPDATE SET titulo = ?2, tipo = ?3, link = ?4")
        .bind(tmdb, titulo, tipo, link, Date.now()).run();       // si ya existía, se conservan sus capítulos sueltos
      let lista = null;
      if (cuerpo.correo) {
        const r = await asignarLista(db, limpiarCorreo(cuerpo.correo), titulo, tmdb, cuerpo.pedido);
        if (r.error) return json({ error: 'Se publicó, pero: ' + r.error }, r.status);
        lista = r.lista;
      }
      return json({ publicadas: await totalPublicados(db), lista });
    }

    if (cuerpo.op === 'publicadas') {
      await prepararCatalogo(db, kv);
      const r = await db.prepare('SELECT titulo, tmdb, link, tipo, episodios FROM publicados ORDER BY creado DESC').all();
      return json({ items: r.results.map(i => ({ titulo: i.titulo, tmdb: i.tmdb, link: i.link, tipo: i.tipo, eps: Object.keys(epsDe(i.episodios)).length })) });
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
      const ya = await db.prepare('SELECT episodios FROM publicados WHERE tmdb = ?1').bind(tmdb).first();
      if (!ya) {
        if ((await totalPublicados(db)) >= 1500) return json({ error: 'Ya hay demasiadas películas publicadas desde el panel.' }, 400);
        await db.prepare("INSERT OR IGNORE INTO publicados (tmdb, titulo, tipo, link, episodios, creado) VALUES (?1, ?2, 'serie', '', '{}', ?3)").bind(tmdb, titulo, Date.now()).run();
      } else {
        const eps = epsDe(ya.episodios);
        if (!eps[k] && Object.keys(eps).length >= 3000) return json({ error: 'Esta serie ya tiene demasiados capítulos.' }, 400);
      }
      await db.prepare("UPDATE publicados SET titulo = ?2, tipo = 'serie', episodios = json_set(episodios, ?3, ?4) WHERE tmdb = ?1")
        .bind(tmdb, titulo, '$."' + k + '"', link).run();       // cambia solo ese capítulo, de un solo golpe
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
      const q = await db.prepare('SELECT id, correo, estado, vale FROM pedidos WHERE id = ?1').bind(String(cuerpo.pedido || '')).first();
      if (!q) return json({ error: 'Ese pedido ya no existe.' }, 404);
      const pasos = [db.prepare("UPDATE pedidos SET estado = 'rechazado', vale = 0 WHERE id = ?1").bind(q.id)];
      if (q.estado === 'pendiente' && q.vale) pasos.push(db.prepare('UPDATE usuarios SET vales = vales + 1, canje = 1 WHERE correo = ?1').bind(q.correo));   // pedido rechazado: se le devuelve la película
      await db.batch(pasos);
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
