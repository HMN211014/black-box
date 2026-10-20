// Funciones nativas de la app. Va en la raíz de tu sitio y se carga desde index.html.
// En el navegador normal no hace nada; solo actúa dentro de la app.
(function () {
  const cap = window.Capacitor;
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
  const P = cap.Plugins || {};
  const inmersivo = P.Inmersivo || (cap.registerPlugin && cap.registerPlugin('Inmersivo'));
  const sinError = (f) => { try { const r = f(); return r && r.catch ? r.catch(() => {}) : r; } catch (e) {} };

  // ---- Reproductor: giro REAL a horizontal + barras del sistema ocultas ----
  function modoPlayer(activo) {
    if (P.ScreenOrientation) sinError(() => activo ? P.ScreenOrientation.lock({ orientation: 'landscape' }) : P.ScreenOrientation.unlock());
    if (inmersivo) sinError(() => activo ? inmersivo.activar() : inmersivo.desactivar());
    else if (P.StatusBar) sinError(() => activo ? P.StatusBar.hide() : P.StatusBar.show());   // respaldo: solo oculta la barra de arriba
  }
  function vigilarPlayer() {
    const pl = document.getElementById('player');
    if (!pl) return;
    let abierto = null;
    const revisar = () => { const ab = !pl.hidden; if (ab !== abierto) { abierto = ab; modoPlayer(ab); } };
    new MutationObserver(revisar).observe(pl, { attributes: true, attributeFilter: ['hidden'] });
    revisar();
    // al volver de otra app, las barras pueden reaparecer: se vuelven a ocultar
    document.addEventListener('visibilitychange', () => { if (!document.hidden && abierto) modoPlayer(true); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigilarPlayer); else vigilarPlayer();

  // ---- Vibración suave en botones con clase .haptic ----
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.haptic') && P.Haptics) sinError(() => P.Haptics.impact({ style: 'LIGHT' }));
  });

  // ---- Compartir:  window.blackboxCompartir("Título", "https://...") ----
  window.blackboxCompartir = (titulo, url) =>
    P.Share ? P.Share.share({ title: titulo, text: titulo, url }) : (navigator.share && navigator.share({ title: titulo, url }));

  // ---- Aviso sin conexión (clase en <html>) ----
  if (P.Network) P.Network.addListener('networkStatusChange', (s) => document.documentElement.classList.toggle('sin-conexion', !s.connected));

  // ---- Botón "atrás" de Android: cierra el reproductor/ficha con el historial, o sale de la app ----
  if (P.App) P.App.addListener('backButton', ({ canGoBack }) => (canGoBack ? history.back() : P.App.exitApp()));

  // ---- Notificaciones push: aviso cuando tu pedido está listo (requiere Firebase, ver LEEME-PUSH.md) ----
  const PN = P.PushNotifications;
  const post = (ruta, cuerpo) => fetch('/api/usuario/' + ruta, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }).catch(() => {});
  const guardado = () => { try { return localStorage.getItem('bb_push_token') || ''; } catch (e) { return ''; } };
  function aviso(titulo, texto) {                                   // recuadro dentro de la app (cuando el push llega con la app abierta)
    const d = document.createElement('div');
    d.setAttribute('role', 'status');
    d.style.cssText = 'position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 14px);transform:translate(-50%,-140%);z-index:2147483000;width:min(92vw,420px);padding:14px 18px;border-radius:18px;background:rgba(40,40,44,.96);color:#fff;font:600 15px/1.35 -apple-system,Helvetica,Arial,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.16);transition:transform .45s cubic-bezier(.34,1.3,.64,1)';
    const t = document.createElement('div'); t.textContent = titulo || ''; const x = document.createElement('div'); x.textContent = texto || ''; x.style.cssText = 'font-weight:400;color:#d1d1d6;margin-top:2px';
    d.append(t, x); document.body.appendChild(d);
    requestAnimationFrame(() => requestAnimationFrame(() => { d.style.transform = 'translate(-50%,0)'; }));
    setTimeout(() => { d.style.transform = 'translate(-50%,-140%)'; setTimeout(() => d.remove(), 500); }, 5500);
  }
  async function registrarPush() {
    if (!PN) return;
    try {
      let perm = await PN.checkPermissions();
      if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PN.requestPermissions();   // Android 13+: pregunta una vez
      if (perm.receive !== 'granted') return;
      await sinError(() => PN.createChannel({ id: 'pedidos', name: 'Pedidos', description: 'Avisa cuando tu pedido está listo', importance: 4, visibility: 1, vibration: true }));
      await PN.register();
    } catch (e) { console.warn('push', e); }
  }
  if (PN) {
    PN.addListener('registration', (t) => { try { localStorage.setItem('bb_push_token', t.value); } catch (e) {} post('push', { token: t.value, plataforma: cap.getPlatform ? cap.getPlatform() : 'android' }); });
    PN.addListener('registrationError', (e) => console.warn('push error', JSON.stringify(e)));
    PN.addListener('pushNotificationReceived', (n) => {              // con la app abierta Android no muestra nada solo: lo mostramos aquí
      aviso(n.title, n.body);
      if (P.Haptics) sinError(() => P.Haptics.notification({ type: 'SUCCESS' }));
      if (window.bbPedidoListo) window.bbPedidoListo();
    });
    PN.addListener('pushNotificationActionPerformed', (a) => {       // tocaron la notificación
      const d = (a.notification && a.notification.data) || {};
      if (d.tipo === 'pedido_listo') { if (location.hash !== '#/pedidos') location.hash = '#/pedidos'; if (window.bbPedidoListo) window.bbPedidoListo(); }
    });
    let sesion = '';
    const cambio = (correo) => {
      if (correo && correo !== sesion) { sesion = correo; registrarPush(); }
      else if (!correo && sesion) { sesion = ''; const t = guardado(); if (t) post('pushquitar', { token: t }); sinError(() => PN.unregister()); try { localStorage.removeItem('bb_push_token'); } catch (e) {} }
    };
    document.addEventListener('bb-sesion', (e) => cambio(e.detail && e.detail.correo));
    if (window.bbCorreo) cambio(window.bbCorreo);                    // la sesión ya estaba abierta antes de que cargara este archivo
  }
})();
