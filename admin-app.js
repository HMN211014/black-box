// Black BOX Admin (app Android): avisos de pedidos nuevos + clave recordada en este teléfono.
// Va en la raíz del sitio y se carga desde admin.html. En el navegador normal no hace nada.
(function () {
  const cap = window.Capacitor;
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
  const P = cap.Plugins || {}, PN = P.PushNotifications;
  const $ = (id) => document.getElementById(id);
  const sinError = (f) => { try { const r = f(); return r && r.catch ? r.catch(() => {}) : r; } catch (e) {} };
  document.documentElement.classList.add('en-admin-app');

  const K_CLAVE = 'bbAdminClave', K_TOKEN = 'bbAdminPushToken', K_OK = 'bbAdminPushOk';
  const leer = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const guardar = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} };
  let noti = { sonido: 'suave', estilo: 'cristal', ...(window.NOTIFICACIONES_EXTRA || {}) }, audio = null;
  function sonidoAviso() {
    if (noti.sonido === 'silencio') return;
    try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; audio = audio || new AC(); if (audio.state === 'suspended') audio.resume(); const t = audio.currentTime, tonos = noti.sonido === 'sistema' ? [784, 988] : [659, 880];
      tonos.forEach((hz,i) => { const o=audio.createOscillator(), g=audio.createGain(); o.type='sine'; o.frequency.value=hz; g.gain.setValueAtTime(.0001,t+i*.105); g.gain.exponentialRampToValueAtTime(.06,t+i*.105+.025); g.gain.exponentialRampToValueAtTime(.0001,t+i*.105+.38); o.connect(g); g.connect(audio.destination); o.start(t+i*.105); o.stop(t+i*.105+.4); });
    } catch (e) {}
  }
  window.addEventListener('bb-notificaciones-config', e => { noti = { ...noti, ...(e.detail || {}) }; });

  // ---- la clave se queda en este teléfono (la app es solo tuya) ----
  const clave = $('clave');
  if (clave && !clave.value) clave.value = leer(K_CLAVE);

  // ---- recuadro de avisos dentro de la app ----
  function toast(titulo, texto) {
    sonidoAviso();
    const d = document.createElement('div'); d.setAttribute('role', 'status');
    const fondos = { cristal: 'background:rgba(40,40,46,.96);color:#fff;border:1px solid rgba(255,255,255,.14)', azul: 'background:linear-gradient(140deg,#123b70,#141b2d);color:#fff;border:1px solid rgba(76,170,255,.5)', claro: 'background:rgba(245,246,250,.97);color:#17171c;border:1px solid rgba(255,255,255,.9)' };
    d.style.cssText = 'position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 14px);transform:translate(-50%,-140%);z-index:2147483000;width:min(92vw,420px);padding:14px 18px;border-radius:18px;' + (fondos[noti.estilo] || fondos.cristal) + ';font:600 15px/1.35 -apple-system,Helvetica,Arial,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.5);transition:transform .45s cubic-bezier(.2,.9,.2,1)';
    const t = document.createElement('div'); t.textContent = titulo || '';
    const x = document.createElement('div'); x.textContent = texto || ''; x.style.cssText = 'font-weight:400;color:' + (noti.estilo === 'claro' ? '#545762' : '#d1d1d6') + ';margin-top:2px';
    d.append(t, x); document.body.appendChild(d);
    requestAnimationFrame(() => requestAnimationFrame(() => { d.style.transform = 'translate(-50%,0)'; }));
    setTimeout(() => { d.style.transform = 'translate(-50%,-140%)'; setTimeout(() => d.remove(), 500); }, 6000);
  }

  // ---- estado en pantalla ----
  const est = (t, ok) => { const e = $('np-est'); if (!e) return; e.textContent = t; e.style.color = ok === false ? '#ff6b6b' : ok ? '#7bd88f' : ''; };
  const caja = $('np-box'); if (caja) caja.hidden = false;
  async function api(op, extra) {
    const r = await fetch('/api/usuario/admin', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clave: clave ? clave.value : '', op, ...extra }) });
    let j = null; try { j = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, j: j || {} };
  }
  async function cargarNotificaciones() {
    if (!clave || !clave.value) return;
    const r = await api('notificaciones'); if (r.ok && r.j.item) noti = { ...noti, ...r.j.item };
  }

  // ---- registro del teléfono para recibir avisos ----
  async function enviarToken() {
    const t = leer(K_TOKEN);
    if (!t) return;
    if (!clave || !clave.value) { est('Escribe tu clave de administrador y toca «Activar avisos».'); return; }
    const r = await api('push_registrar', { token: t, plataforma: cap.getPlatform ? cap.getPlatform() : 'android' });
    if (r.ok) { guardar(K_OK, '1'); guardar(K_CLAVE, clave.value); est('Avisos activados en este teléfono.', true); }
    else { guardar(K_OK, ''); est(r.status === 401 ? 'La clave no es correcta.' : (r.j.error || 'No se pudo activar.'), false); }
  }
  async function activar() {
    if (!PN) { est('Esta versión de la app no trae notificaciones.', false); return; }
    try {
      let perm = await PN.checkPermissions();
      if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PN.requestPermissions();
      if (perm.receive !== 'granted') { est('Permiso de notificaciones denegado. Actívalo en Ajustes de Android > Apps > Black BOX Admin.', false); return; }
      await sinError(() => PN.createChannel({ id: 'pedidos_admin', name: 'Pedidos nuevos', description: 'Avisa cuando un cliente hace un pedido', importance: 4, visibility: 1, vibration: true }));
      est('Conectando…');
      await PN.register();                                          // el token llega por el evento «registration»
    } catch (e) { est('No se pudo activar: ' + (e && e.message ? e.message : e), false); }
  }
  if (PN) {
    PN.addListener('registration', (t) => { guardar(K_TOKEN, t.value); enviarToken(); });
    PN.addListener('registrationError', (e) => est('Firebase no está configurado en esta app (' + (e && e.error ? e.error : 'error') + '). Revisa google-services.json.', false));
    PN.addListener('pushNotificationReceived', (n) => {              // con la app abierta Android no muestra nada solo
      toast(n.title, n.body);
      const d = n.data || {};
      if (d.tipo === 'pedido_nuevo' && $('p-go') && clave && clave.value) $('p-go').click();   // se actualiza la lista de pedidos
    });
    PN.addListener('pushNotificationActionPerformed', (a) => {       // tocaron la notificación: directo a los pedidos
      const d = (a.notification && a.notification.data) || {};
      if (d.tipo === 'pedido_nuevo') {
        const b = document.querySelector('#nav button[data-g="pedidos"]'); if (b) b.click();
        if ($('p-go') && clave && clave.value) $('p-go').click();
      }
    });
  }
  if ($('np-act')) $('np-act').onclick = () => { activar(); };
  if ($('np-prueba')) $('np-prueba').onclick = async () => {
    if (!clave || !clave.value) { est('Escribe tu clave de administrador.', false); return; }
    est('Enviando prueba…');
    const r = await api('push_probar');
    if (r.ok) guardar(K_CLAVE, clave.value);
    est(r.ok ? 'Prueba enviada: debe llegarte en unos segundos.' : (r.status === 401 ? 'La clave no es correcta.' : (r.j.error || 'No se pudo enviar.')), r.ok);
  };
  if (clave) clave.addEventListener('change', () => { if (leer(K_TOKEN)) enviarToken(); });
  if (clave && clave.value) cargarNotificaciones().catch(() => {});

  // ---- al abrir la app: si ya estaba activada, se confirma el registro en silencio ----
  if (leer(K_OK) && clave && clave.value) { est('Avisos activados en este teléfono.', true); sinError(() => PN && PN.checkPermissions().then((p) => { if (p.receive === 'granted') PN.register(); })); }
  else est('Toca «Activar avisos» para recibir una notificación con cada pedido nuevo.');
})();
