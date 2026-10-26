/* Notificaciones push (Firebase Cloud Messaging, API HTTP v1) para el Worker.
   Necesita el secreto  FCM_SERVICE_ACCOUNT  (el JSON de la cuenta de servicio de Firebase, completo).
   Los teléfonos se guardan en la tabla  dispositivos  de D1 (se crea sola la primera vez). */

const enc = new TextEncoder();
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlTexto = t => b64url(enc.encode(t));

let tablaLista = false;
export async function asegurarPush(db) {
  if (tablaLista) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS dispositivos (token TEXT PRIMARY KEY, correo TEXT NOT NULL, plataforma TEXT, creado INTEGER NOT NULL) WITHOUT ROWID').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS dispositivos_correo ON dispositivos (correo)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS dispositivos_preferencias (token TEXT PRIMARY KEY, sonido TEXT NOT NULL DEFAULT \'suave\') WITHOUT ROWID').run();
  tablaLista = true;
}

const pemADer = pem => Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));

let cache = { token: '', exp: 0 };
export async function tokenGoogle(sa) {
  const ahora = Math.floor(Date.now() / 1000);
  if (cache.token && cache.exp - 60 > ahora) return cache.token;
  const cab = b64urlTexto(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const cuerpo = b64urlTexto(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600
  }));
  const clave = await crypto.subtle.importKey('pkcs8', pemADer(String(sa.private_key).replace(/\\n/g, '\n')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', clave, enc.encode(cab + '.' + cuerpo));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + cab + '.' + cuerpo + '.' + b64url(firma)
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error('No se pudo autenticar con Firebase: ' + (j.error_description || j.error || r.status));
  cache = { token: j.access_token, exp: ahora + (j.expires_in || 3600) };
  return cache.token;
}

/* Envía una notificación a todos los teléfonos de una cuenta. Nunca lanza error hacia afuera. */
export async function avisarUsuario(env, correo, { titulo, texto, datos = {} }) {
  try {
    if (!env.FCM_SERVICE_ACCOUNT || !env.DB) return { enviados: 0, fallidos: 0, error: 'sin_configuracion' };
    let sa; try { sa = JSON.parse(env.FCM_SERVICE_ACCOUNT); } catch (e) { console.error('[push] FCM_SERVICE_ACCOUNT no es un JSON válido'); return { enviados: 0, fallidos: 0, error: 'sin_configuracion' }; }
    await asegurarPush(env.DB);
    const filas = (await env.DB.prepare("SELECT d.token, COALESCE(p.sonido, 'suave') AS sonido FROM dispositivos d LEFT JOIN dispositivos_preferencias p ON p.token = d.token WHERE d.correo = ?1").bind(correo).all()).results;
    if (!filas.length) return { enviados: 0, fallidos: 0, error: 'sin_dispositivos' };
    const acceso = await tokenGoogle(sa);
    const url = 'https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send';
    const data = Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, String(v)]));   // FCM solo acepta textos
    const imagen = /^https:\/\/image\.tmdb\.org\/t\/p\/w\d+\/[\w.-]{1,80}$/.test(String(datos.poster || '')) ? datos.poster : '';
    let enviados = 0, fallidos = 0;
    for (const { token, sonido } of filas) {
      const canal = ['suave', 'sistema', 'silencio'].includes(sonido) ? 'pedidos_' + sonido : 'pedidos_suave';
      const r = await fetch(url, {
        method: 'POST', headers: { Authorization: 'Bearer ' + acceso, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token, notification: { title: titulo, body: texto, ...(imagen ? { image: imagen } : {}) }, data,
          android: { priority: 'HIGH', notification: { channel_id: canal, ...(imagen ? { image: imagen } : {}) } } } })
      });
      if (r.ok) enviados++; else fallidos++;
      if (!r.ok) {
        const t = await r.text();
        console.error('[push] FCM', r.status, t.slice(0, 300));
        if (/UNREGISTERED|NOT_FOUND|not a valid FCM registration token/i.test(t)) await env.DB.prepare('DELETE FROM dispositivos WHERE token = ?1').bind(token).run();   // el teléfono ya no existe
      }
    }
    return { enviados, fallidos };
  } catch (e) { console.error('[push]', String((e && e.message) || e)); return { enviados: 0, fallidos: 1, error: 'fallo_envio' }; }
}

/* ---------- Avisos al administrador (app Black BOX Admin): pedidos nuevos ---------- */
let tablaAdminLista = false;
export async function asegurarPushAdmin(db) {
  if (tablaAdminLista) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS dispositivos_admin (token TEXT PRIMARY KEY, plataforma TEXT, creado INTEGER NOT NULL) WITHOUT ROWID').run();
  tablaAdminLista = true;
}
/* Envía una notificación a todos los teléfonos con la app de administración. Devuelve cuántos se intentaron. Nunca lanza error hacia afuera. */
export async function avisarAdmins(env, { titulo, texto, datos = {} }) {
  try {
    if (!env.FCM_SERVICE_ACCOUNT || !env.DB) return 0;
    let sa; try { sa = JSON.parse(env.FCM_SERVICE_ACCOUNT); } catch (e) { console.error('[push admin] FCM_SERVICE_ACCOUNT no es un JSON válido'); return 0; }
    await asegurarPushAdmin(env.DB);
    const filas = (await env.DB.prepare('SELECT token FROM dispositivos_admin').all()).results;
    if (!filas.length) return 0;
    const acceso = await tokenGoogle(sa);
    const url = 'https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send';
    const data = Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, String(v)]));
    for (const { token } of filas) {
      const r = await fetch(url, {
        method: 'POST', headers: { Authorization: 'Bearer ' + acceso, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token, notification: { title: titulo, body: texto }, data,
          android: { priority: 'HIGH', notification: { channel_id: 'pedidos_admin' } } } })
      });
      if (!r.ok) {
        const t = await r.text();
        console.error('[push admin] FCM', r.status, t.slice(0, 300));
        if (/UNREGISTERED|NOT_FOUND|not a valid FCM registration token/i.test(t)) await env.DB.prepare('DELETE FROM dispositivos_admin WHERE token = ?1').bind(token).run();
      }
    }
    return filas.length;
  } catch (e) { console.error('[push admin]', String((e && e.message) || e)); return 0; }
}
