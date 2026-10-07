/* ============================================================
   PLATAFORMAS DE STREAMING (la usan index.html y plataforma.html)
   Para agregar una, copia un bloque y cambia los datos.
     id      -> sin espacios; va en el enlace (plataforma.html?p=id)
     a, b    -> colores de la ficha y del banner (degradado)
     bg      -> color de fondo de la página de la plataforma
     tx      -> color del nombre
     fuente, peso, esp, mayus -> estilo de las letras
     logo    -> OPCIONAL: ruta de una imagen, p. ej. "/logos/netflix.png".
                Si la pones, se usa la imagen en lugar del nombre escrito.
   ============================================================ */
const PLATAFORMAS = [
  { id:"netflix", nombre:"Netflix", a:"#3a0006", b:"#000000", bg:"#080808", tx:"#E50914",
    fuente:"'Bebas Neue',Impact,'Arial Narrow',sans-serif", peso:"800", esp:".06em", mayus:true },
  { id:"disney", nombre:"Disney+", a:"#113CCF", b:"#040714", bg:"#040714", tx:"#ffffff",
    fuente:"'Avenir Next',Avenir,'Trebuchet MS',sans-serif", peso:"500", esp:".01em" },
  { id:"prime", nombre:"prime video", a:"#00698c", b:"#0F171E", bg:"#0F171E", tx:"#ffffff",
    fuente:"'Amazon Ember',-apple-system,'Helvetica Neue',Arial,sans-serif", peso:"700", esp:"-.01em" },
  { id:"hbomax", nombre:"HBO max", a:"#5822B4", b:"#002BE7", bg:"#0a0620", tx:"#ffffff",
    fuente:"-apple-system,'Helvetica Neue',Arial,sans-serif", peso:"800", esp:".02em" },
  { id:"paramount", nombre:"Paramount+", a:"#0064FF", b:"#001a4d", bg:"#00091f", tx:"#ffffff",
    fuente:"Georgia,'Times New Roman',serif", peso:"700", esp:".01em" },
  { id:"appletv", nombre:"Apple TV", a:"#2d2d30", b:"#000000", bg:"#000000", tx:"#ffffff",
    fuente:"-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',sans-serif", peso:"600", esp:"-.02em" },
  { id:"crunchyroll", nombre:"crunchyroll", a:"#F47521", b:"#7a2e00", bg:"#14110f", tx:"#ffffff",
    fuente:"-apple-system,'Helvetica Neue',Arial,sans-serif", peso:"800", esp:"-.02em" },
  { id:"vix", nombre:"ViX", a:"#FF6A13", b:"#9c1d00", bg:"#140a05", tx:"#ffffff",
    fuente:"-apple-system,'Helvetica Neue',Arial,sans-serif", peso:"900", esp:".04em" }
];

/* Nombre (o logo) de la plataforma como elemento listo para poner en pantalla */
function marca(p) {
  const el = document.createElement('span');
  el.className = 'wm';
  if (p.logo) {
    const i = new Image(); i.alt = p.nombre; i.src = p.logo;
    i.onerror = () => { i.remove(); texto(); };
    el.appendChild(i);
  } else texto();
  function texto() {
    el.textContent = p.nombre;
    el.style.fontFamily = p.fuente; el.style.fontWeight = p.peso;
    el.style.letterSpacing = p.esp || 'normal';
    el.style.textTransform = p.mayus ? 'uppercase' : 'none';
  }
  return el;
}
