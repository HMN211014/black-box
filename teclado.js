// Protege la zona inferior de la página cuando el teclado nativo está abierto.
// Solo se carga desde la app Android; el teclado del sistema sigue recibiendo los toques.
(function () {
  const cap = window.Capacitor;
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
  if (cap.getPlatform && cap.getPlatform() !== 'android') return;

  const keyboard = (cap.Plugins || {}).Keyboard;
  if (!keyboard || !keyboard.addListener) return;

  let abierto = false, altoTeclado = 0, shield = null;
  const raiz = document.documentElement;
  const altoVisible = () => Math.max(0, (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0);

  function crearShield() {
    if (shield || !document.body) return;
    shield = document.createElement('div');
    shield.setAttribute('aria-hidden', 'true');
    shield.setAttribute('data-bb-keyboard-shield', '');
    shield.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483646;background:transparent;pointer-events:auto;touch-action:none;user-select:none;-webkit-tap-highlight-color:transparent';
    ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'click', 'dblclick', 'contextmenu'].forEach(tipo => {
      shield.addEventListener(tipo, e => { e.preventDefault(); e.stopImmediatePropagation(); }, { passive: false });
    });
    document.body.appendChild(shield);
  }

  function actualizar(info) {
    if (info && Number(info.keyboardHeight) > 0) altoTeclado = Number(info.keyboardHeight);
    if (!abierto) return;
    crearShield();
    if (!shield) return;
    const vh = altoVisible();
    // En Android el WebView ya se redimensiona al aparecer el IME. Se bloquea
    // una franja inferior de su área visible y se conserva libre la zona superior.
    const limite = Math.max(0, Math.round(vh * 0.42));
    const alto = Math.min(altoTeclado || limite, limite);
    shield.style.height = alto + 'px';
    raiz.classList.add('bb-teclado-abierto');
  }

  function mostrar(info) { abierto = true; actualizar(info); }
  function ocultar() {
    abierto = false; altoTeclado = 0;
    raiz.classList.remove('bb-teclado-abierto');
    if (shield) { shield.remove(); shield = null; }
  }

  keyboard.addListener('keyboardWillShow', mostrar);
  keyboard.addListener('keyboardDidShow', mostrar);
  keyboard.addListener('keyboardWillHide', ocultar);
  keyboard.addListener('keyboardDidHide', ocultar);
  window.addEventListener('resize', () => { if (abierto) requestAnimationFrame(() => actualizar()); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (abierto) requestAnimationFrame(() => actualizar()); });

  // Evita pellizcar o disparar gestos con varios dedos sobre la página durante la escritura.
  document.addEventListener('touchstart', e => {
    if (abierto && e.touches && e.touches.length > 1) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, { capture: true, passive: false });
  document.addEventListener('touchmove', e => {
    if (abierto && e.touches && e.touches.length > 1) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, { capture: true, passive: false });
})();
