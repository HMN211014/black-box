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
  // Vibración propia de la app (plugin Haptico): intensidad, formas de onda y efectos del motor háptico, sin depender de Chrome.
  // Si la app es antigua y no lo tiene, el sitio usa los métodos de siempre.
  const hap = P.Haptico || (cap.registerPlugin && cap.registerPlugin('Haptico'));
  if (hap && hap.info) {
    sinError(() => hap.info().then((r) => {
      if (!r || !r.ok) return;
      window.bbHapOk = true; window.bbHapInfo = r;
      window.bbHaptico = {
        patron: (t, a) => sinError(() => hap.patron({ t, a })),
        efecto: (tipo) => sinError(() => hap.efecto({ tipo })),
        compuesto: (p) => hap.compuesto({ p }).catch(() => ({ ok: false })),     // piezas del sistema (Android 11+)
        sistema: (tipo) => hap.sistema({ tipo }).catch(() => ({ ok: false })),   // respuestas hápticas del propio Android
        cancelar: () => sinError(() => hap.cancelar())
      };
      document.documentElement.classList.add('hap-ok');
    }));
  }

  // Transmitir a TV por DLNA (Samsung, LG, Sony…) con el plugin Transmitir: la TV recibe el enlace y reproduce sola; el teléfono es el control
  const tr = P.Transmitir || (cap.registerPlugin && cap.registerPlugin('Transmitir'));
  const trOk = !!tr && (!cap.isPluginAvailable || cap.isPluginAvailable('Transmitir'));
  if (trOk) {
    const d2 = (d) => ({ av: d.av, avTipo: d.avTipo, rc: d.rc, rcTipo: d.rcTipo });
    const sinTv = (e) => ({ ok: false, error: 'No se pudo hablar con la TV.' });
    window.bbTv = {
      buscar: (alEncontrar, ms) => {
        let h = null;
        sinError(() => tr.addListener('dispositivo', alEncontrar).then((x) => { h = x; }));
        const fin = (r) => { try { if (h && h.remove) h.remove(); } catch (e) {} return r; };
        return tr.buscar({ ms: ms || 4500 }).then((r) => fin((r && r.lista) || []), () => fin(null));   // null = la app no tiene el plugin
      },
      enviar: (d, o) => tr.enviar(Object.assign(d2(d), o)).catch(sinTv),
      control: (d, accion) => tr.control(Object.assign(d2(d), { accion })).catch(sinTv),
      saltar: (d, segundos) => tr.saltar(Object.assign(d2(d), { segundos })).catch(sinTv),
      estado: (d) => tr.estado(d2(d)).catch(sinTv),
      volumen: (d, valor) => tr.volumen(Object.assign(d2(d), { valor })).catch(sinTv),
      silenciar: (d, activo) => tr.silenciar(Object.assign(d2(d), { activo })).catch(sinTv)
    };
    document.documentElement.classList.add('dlna-ok');
  }

  // Brillo real de la pantalla para el deslizador del reproductor (si la app es antigua y no lo tiene, el sitio usa un oscurecido del video)
  window.bbBrillo = (v) => inmersivo ? inmersivo.brillo({ valor: v }) : Promise.reject();
  window.bbBrilloActual = () => inmersivo ? inmersivo.brilloActual().then((r) => r.valor) : Promise.reject();

  // Imagen en imagen (PiP): botón del reproductor + paso automático al salir de la app con el video en marcha
  window.bbPip = () => inmersivo ? inmersivo.entrarPip() : Promise.reject();
  const pipPermitido = () => { try { return (JSON.parse(localStorage.getItem('bbopc')) || {}).pip !== false; } catch (e) { return true; } };
  const pipAuto = (activo, v) => { if (!inmersivo || !inmersivo.pipAuto) return; if (activo && !pipPermitido()) activo = false; sinError(() => inmersivo.pipAuto({ activo, ancho: (v && v.videoWidth) || 16, alto: (v && v.videoHeight) || 9 })); };
  if (inmersivo && inmersivo.addListener) {
    sinError(() => inmersivo.addListener('pip', (e) => {
      document.documentElement.classList.toggle('en-pip', !!e.activo);
      const v = document.getElementById('pv');
      if (e.cerrado && v) { try { v.pause(); } catch (x) {} }           // cerraron la ventanita: se pausa
    }));
    document.documentElement.classList.add('pip-ok');
  }
  function vigilarPlayer() {
    const pl = document.getElementById('player');
    if (!pl) return;
    let abierto = null;
    const revisar = () => { const ab = !pl.hidden; if (ab !== abierto) { abierto = ab; modoPlayer(ab); if (!ab) pipAuto(false); } };
    new MutationObserver(revisar).observe(pl, { attributes: true, attributeFilter: ['hidden'] });
    revisar();
    // al empezar a reproducir (el video no propaga el evento, por eso en captura) se vuelven a ocultar las barras
    document.addEventListener('playing', (e) => { if (e.target && e.target.id === 'pv' && abierto) modoPlayer(true); }, true);
    document.addEventListener('playing', (e) => { if (e.target && e.target.id === 'pv' && abierto) pipAuto(true, e.target); }, true);
    document.addEventListener('pause', (e) => { if (e.target && e.target.id === 'pv') pipAuto(false); }, true);
    document.addEventListener('ended', (e) => { if (e.target && e.target.id === 'pv') pipAuto(false); }, true);
    // al volver de otra app, las barras pueden reaparecer: se vuelven a ocultar
    document.addEventListener('visibilitychange', () => { if (!document.hidden && abierto) modoPlayer(true); });
    let rt; const reocultar = () => { clearTimeout(rt); rt = setTimeout(() => { if (abierto) modoPlayer(true); }, 350); };
    window.addEventListener('resize', reocultar); window.addEventListener('focus', reocultar);
    document.addEventListener('pointerup', (e) => { if (abierto && e.target && e.target.closest && e.target.closest('#player')) reocultar(); }, true);
  }
  document.addEventListener('bb-opciones', () => { const v = document.getElementById('pv'), pl = document.getElementById('player'); if (v && pl && !pl.hidden) pipAuto(!v.paused, v); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigilarPlayer); else vigilarPlayer();

  // ---- Compartir:  window.blackboxCompartir("Título", "https://...") ----
  window.blackboxCompartir = (titulo, url) =>
    P.Share ? P.Share.share({ title: titulo, text: titulo, url }) : (navigator.share && navigator.share({ title: titulo, url }));

  // ---- Aviso sin conexión (clase en <html>) ----
  if (P.Network) P.Network.addListener('networkStatusChange', (s) => document.documentElement.classList.toggle('sin-conexion', !s.connected));

  // ---- Botón "atrás" de Android: cierra el reproductor/ficha con el historial, o sale de la app ----
  if (P.App) P.App.addListener('backButton', ({ canGoBack }) => {
    if (!document.dispatchEvent(new CustomEvent('bb-atras', { cancelable: true }))) return;   // la página de Configuración (u otra) se queda con el botón atrás
    canGoBack ? history.back() : P.App.exitApp();
  });

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
    if (!PN) return { ok: false, receive: 'unavailable' };
    try {
      let perm = await PN.checkPermissions();
      if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PN.requestPermissions();   // Android 13+: pregunta una vez
      if (perm.receive !== 'granted') return { ok: false, receive: perm.receive };
      await sinError(() => PN.createChannel({ id: 'pedidos', name: 'Pedidos', description: 'Avisa cuando tu pedido está listo', importance: 4, visibility: 1, vibration: true }));
      await PN.register();
      return { ok: true, receive: 'granted' };
    } catch (e) { console.warn('push', e); return { ok: false, receive: 'error' }; }
  }
  async function estadoPush() {
    if (!PN) return { receive: 'unavailable', registrado: false };
    try { const p = await PN.checkPermissions(); return { receive: p.receive, registrado: !!guardado() }; }
    catch (e) { return { receive: 'error', registrado: !!guardado() }; }
  }
  window.bbPushEstado = estadoPush;
  window.bbPushActivar = async () => {
    const correo = window.bbCorreo;
    if (!correo) return { ok: false, receive: 'no-session' };
    return registrarPush();
  };
  function actualizarPushUI() { if (typeof window.bbCuentaPushActualizar === 'function') estadoPush().then(window.bbCuentaPushActualizar); }
  if (PN) {
    PN.addListener('registration', (t) => { try { localStorage.setItem('bb_push_token', t.value); } catch (e) {} post('push', { token: t.value, plataforma: cap.getPlatform ? cap.getPlatform() : 'android' }); actualizarPushUI(); });
    PN.addListener('registrationError', (e) => console.warn('push error', JSON.stringify(e)));
    PN.addListener('pushNotificationReceived', (n) => {              // con la app abierta Android no muestra nada solo: lo mostramos aquí
      aviso(n.title, n.body);
      if (window.bbPedidoListo) window.bbPedidoListo();
    });
    PN.addListener('pushNotificationActionPerformed', (a) => {       // tocaron la notificación
      const d = (a.notification && a.notification.data) || {};
      if (d.tipo === 'pedido_listo') { if (location.hash !== '#/pedidos') location.hash = '#/pedidos'; if (window.bbPedidoListo) window.bbPedidoListo(); }
    });
    let sesion = '';
    const cambio = (correo) => {
      if (correo && correo !== sesion) { sesion = correo; registrarPush().then(actualizarPushUI); }
      else if (!correo && sesion) { sesion = ''; const t = guardado(); if (t) post('pushquitar', { token: t }); sinError(() => PN.unregister()); try { localStorage.removeItem('bb_push_token'); } catch (e) {} actualizarPushUI(); }
    };
    document.addEventListener('bb-sesion', (e) => cambio(e.detail && e.detail.correo));
    if (window.bbCorreo) cambio(window.bbCorreo);                    // la sesión ya estaba abierta antes de que cargara este archivo
  }
})();
