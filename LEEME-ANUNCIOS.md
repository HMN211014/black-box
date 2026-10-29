# Anuncios de Google en el plan Gratis

Qué ya está hecho en el código y qué falta hacer fuera de él.

## Ya está listo (en el sitio)
- Solo las cuentas con plan **Gratis** ven anuncios. Los demás planes nunca.
- Panel de admin > **Anuncios (plan Gratis)**: interruptor general, anuncios propios y la sección **Anuncios de Google** con los IDs.
- **Web:** AdSense (un bloque en el inicio). **App:** AdMob (banner abajo). AdSense no se permite dentro de apps, por eso cada uno va en su lugar.
- Si Google no puede mostrar algo (sin IDs, sin plugin, sin conexión), salen los anuncios propios del panel; si tampoco hay, no sale nada.
- El banner de la app se esconde mientras se ve una película y vuelve al cerrar el reproductor.
- Por defecto todo está en **modo de prueba** (anuncios de prueba de Google). No lo apagues hasta que Google apruebe tu sitio y tu app: hacer clic en tus propios anuncios reales puede costarte la cuenta.
- El servidor genera solo **/ads.txt** y **/app-ads.txt** con los IDs que guardes.
- Ya existe `bbAds.intersticial()` (anuncio de pantalla completa) con descanso de 5 minutos, pero **no está conectado a ninguna pantalla**.

## Lo que falta hacer tú (no se puede desde el código del sitio)
1. **Cuentas de Google**: crea una cuenta de **AdSense** (para la web) y una de **AdMob** (para la app). Ambas piden que Google revise y apruebe tu sitio/app; puede tardar días. Los videos y el contenido deben cumplir sus políticas.
2. **AdSense (web)**: agrega tu dominio, crea un bloque de anuncios "Display" y copia el ID de editor (`ca-pub-…`) y el número del bloque al panel.
3. **AdMob (app)**: registra la app, crea una unidad "Banner" y copia su ID (`ca-app-pub-…/…`) al panel.
4. **Plugin de AdMob en la app** (solo cuando vayas a sacar una nueva versión):
   ```
   npm install @capacitor-community/admob
   npx cap sync android
   ```
   y en `android/app/src/main/AndroidManifest.xml`, dentro de `<application>`, tu **ID de aplicación** de AdMob (el que tiene `~`):
   ```xml
   <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY"/>
   ```
   Después genera y publica la nueva versión de la app. Las versiones antiguas seguirán funcionando con los anuncios propios.
5. **Privacidad**: Google exige mensaje de consentimiento en la UE/Reino Unido (la app ya lo pide a través del plugin si hace falta) y que tu política de privacidad mencione los anuncios.
6. Cuando Google apruebe todo, desactiva «Solo anuncios de prueba» en el panel y prueba en un teléfono real con una cuenta Gratis.

Ajuste fino: si el banner tapa la barra de navegación de la app, sube `MARGEN_BANNER` al inicio de `anuncios.js`.
