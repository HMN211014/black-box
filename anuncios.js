// Anuncios de Google para el plan Gratis. Va en la raíz del sitio y se carga desde index.html (después de nativo.js).
//  - En la web:  AdSense (un bloque dentro del inicio).
//  - En la app:  AdMob (banner nativo abajo) con el plugin @capacitor-community/admob. Si la app todavía no lo tiene, no pasa nada:
//                se muestran los anuncios propios del panel (o ninguno).
// No decide a quién se muestran: index.html solo llama aquí si la cuenta es de plan Gratis y el panel tiene activados los anuncios de Google.
// Los identificadores salen del panel (admin > Anuncios (plan Gratis) > Anuncios de Google) y llegan en window.ANUNCIOS_EXTRA.google.
(function () {
  const cap = window.Capacitor;
  const enApp = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const PRUEBA = { banner: 'ca-app-pub-3940256099942544/6300978111', intersticial: 'ca-app-pub-3940256099942544/1033173712' };   // ids de prueba de Google
  const MARGEN_BANNER = 0;          // píxeles de separación abajo; súbelo si el banner tapa la barra de navegación de la app
  const INTERSTICIAL_CADA_MS = 5 * 60 * 1000;
  const sinError = (f) => { try { const r = f(); return r && r.catch ? r.catch(() => {}) : r; } catch (e) {} };

  // ---- AdMob (app) ----
  const P = (cap && cap.Plugins) || {};
  const admob = enApp ? (P.AdMob || (cap.registerPlugin && cap.registerPlugin('AdMob'))) : null;
  const admobOk = () => !!admob && (!cap.isPluginAvailable || cap.isPluginAvailable('AdMob'));
  let admobListo = null;            // promesa: consentimiento + inicialización, una sola vez
  function iniciarAdMob() {
    if (admobListo) return admobListo;
    admobListo = (async () => {
      try {   // consentimiento de privacidad (obligatorio en la UE/Reino Unido; en otros países Google no muestra nada)
        const info = await admob.requestConsentInfo();
        if (info && info.isConsentFormAvailable && info.status === 'REQUIRED') await admob.showConsentForm();
      } catch (e) {}
      await admob.initialize({});
      return true;
    })().catch(() => { admobListo = null; return false; });
    return admobListo;
  }
  let bannerPuesto = false, bannerOculto = false;
  async function mostrarAdMob(cont, g) {
    if (!admobOk()) return false;
    const adId = g.pruebas ? PRUEBA.banner : g.admobBanner;
    if (!adId) return false;
    cont.replaceChildren(); cont.hidden = true;         // el banner de AdMob es nativo (flota sobre la app): no ocupa lugar en la página
    if (bannerPuesto) return true;
    if (!(await iniciarAdMob())) return false;
    try {
      await admob.showBanner({ adId, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: MARGEN_BANNER, isTesting: !!g.pruebas });
      bannerPuesto = true; bannerOculto = false;
      return true;
    } catch (e) { return false; }
  }

  // ---- AdSense (web) ----
  let scriptAdSense = null;
  function cargarAdSense(cliente) {
    if (!scriptAdSense) scriptAdSense = new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.async = true; s.crossOrigin = 'anonymous';
      s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(cliente);
      s.onload = () => ok(true); s.onerror = () => { scriptAdSense = null; mal(new Error('adsense')); };
      document.head.appendChild(s);
    });
    return scriptAdSense;
  }
  async function mostrarAdSense(cont, g) {
    if (enApp || !g.adsenseCliente || !g.adsenseSlot) return false;     // AdSense no se permite dentro de apps: allí va AdMob
    if (cont.querySelector('ins.adsbygoogle')) { cont.hidden = false; return true; }
    try { await cargarAdSense(g.adsenseCliente); } catch (e) { return false; }
    const caja = document.createElement('div'); caja.className = 'an-g';
    const ins = document.createElement('ins'); ins.className = 'adsbygoogle'; ins.style.display = 'block';
    ins.setAttribute('data-ad-client', g.adsenseCliente); ins.setAttribute('data-ad-slot', g.adsenseSlot);
    ins.setAttribute('data-ad-format', 'auto'); ins.setAttribute('data-full-width-responsive', 'true');
    if (g.pruebas) ins.setAttribute('data-adtest', 'on');
    caja.appendChild(ins);
    const rot = document.createElement('span'); rot.className = 'an-tag'; rot.textContent = 'Publicidad'; caja.appendChild(rot);
    cont.replaceChildren(caja); cont.hidden = false;
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { return false; }
    return true;
  }

  // ---- Interfaz que usa index.html ----
  let ultimoInterst = 0;
  window.bbAds = {
    enApp,
    // ¿hay con qué mostrar anuncios de Google en este dispositivo?
    disponible(g) {
      if (!g || g.activo !== true) return false;
      return enApp ? (admobOk() && !!(g.pruebas || g.admobBanner)) : !!(g.adsenseCliente && g.adsenseSlot);
    },
    // Muestra el anuncio de Google dentro de cont (o el banner nativo). Devuelve true si lo puso, false si hay que usar los propios.
    async mostrar(cont, g) { return enApp ? mostrarAdMob(cont, g) : mostrarAdSense(cont, g); },
    ocultar() {
      if (bannerPuesto && admobOk()) { sinError(() => admob.removeBanner()); bannerPuesto = false; bannerOculto = false; }
      const c = document.getElementById('anun'); const ins = c && c.querySelector('ins.adsbygoogle'); if (ins) c.replaceChildren();
    },
    // Anuncio de pantalla completa (solo app). Todavía no está conectado a ninguna pantalla: sirve para, por ejemplo, mostrarlo al cerrar el reproductor.
    // Respeta un descanso mínimo entre anuncios para no cansar a quien ve. Devuelve true si se mostró.
    async intersticial(g) {
      if (!enApp || !admobOk() || !g || g.activo !== true) return false;
      const adId = g.pruebas ? PRUEBA.intersticial : g.admobIntersticial;
      if (!adId || Date.now() - ultimoInterst < INTERSTICIAL_CADA_MS) return false;
      if (!(await iniciarAdMob())) return false;
      try { await admob.prepareInterstitial({ adId, isTesting: !!g.pruebas }); await admob.showInterstitial(); ultimoInterst = Date.now(); return true; }
      catch (e) { return false; }
    },
  };

  // El banner nativo flota sobre toda la app: mientras se ve una película se esconde y al cerrar el reproductor vuelve.
  function vigilarReproductor() {
    const pl = document.getElementById('player');
    if (!pl || !enApp) return;
    const revisar = () => {
      if (!bannerPuesto || !admobOk()) return;
      if (!pl.hidden && !bannerOculto) { bannerOculto = true; sinError(() => admob.hideBanner()); }
      else if (pl.hidden && bannerOculto) { bannerOculto = false; sinError(() => admob.resumeBanner()); }
    };
    new MutationObserver(revisar).observe(pl, { attributes: true, attributeFilter: ['hidden'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigilarReproductor); else vigilarReproductor();
})();
