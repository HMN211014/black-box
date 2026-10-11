/* ============================================================
   COLECCIONES POR TEMÁTICA (la usa index.html)
   Para agregar una colección nueva: copia un bloque completo (de { a }), pégalo al final
   (antes del ] ) con una coma entre bloques, y cambia los datos.

     id          -> sin espacios ni acentos; va en el enlace (#/c/marvel)
     nombre      -> lo que se lee en el cuadro y en la página
     a, b        -> colores del cuadro (degradado)       tx -> color del nombre
     patron      -> dibujo de fondo de la PÁGINA de la colección: "aranas", "murcielagos" o "" (ninguno)
     patronColor -> color de ese dibujo (se ve muy suave)
     tema        -> dibujo de fondo del cuadro: "puntos" (cómic), "rayos", "estrellas" o "liso"
     fondo       -> OPCIONAL: foto de fondo del cuadro, p. ej. "/img/marvel.jpg" (sustituye al tema)
     logo        -> OPCIONAL: imagen del logo, p. ej. "/logos/marvel.png" (sustituye al nombre escrito)
     sinNombre   -> OPCIONAL: pon  sinNombre: true  si la imagen de "fondo" ya trae el nombre escrito; así no se repite encima.
     fuente, peso, esp, mayus -> estilo de las letras del nombre
     anuncio     -> el banner de arriba de la página de la colección. Llena lo que quieras:
                    titulo, texto, imagen (foto de fondo) y enlace (a dónde lleva al tocarlo).
                    Si lo dejas todo vacío ("") el banner no aparece.
     tmdbEmpresas-> (automático) productoras de TMDB: toda película cuya ficha de TMDB tenga una de estas
                    productoras entra sola en la colección. Escribe el nombre tal como sale en TMDB
                    (o su número de empresa). Puedes combinarlo con "peliculas".
     tmdbEmpresasContiene -> igual, pero basta con que el nombre de la productora CONTENGA la palabra.
                    Útil para estudios con muchas ramas: ["warner"] atrapa Warner Bros. Pictures,
                    Warner Bros. Animation, etc. Revisa que no entren productoras que no quieres.
     tmdbPalabras -> (automático) palabras clave de TMDB (están en inglés): entra toda película que tenga una palabra
                    clave que CONTENGA este texto. Ejemplo: ["marvel cinematic universe"]. Sirve para atrapar películas
                    cuya ficha no trae la productora que esperas.
     tmdbSagas   -> (automático) saga de TMDB (por ejemplo "Spider-Man Collection"): el nombre, parte del nombre o su número.
                    Si TMDB tiene el nombre traducido al español, escríbelo así o usa el número de la saga.
     tmdbDirectores, tmdbReparto -> (automático) director o actores principales (nombre o parte del nombre).
                    Úsalos en colecciones por persona (por ejemplo una colección "Nolan"), no en las de universos.
     auto        -> OPCIONAL: pon  auto: false  para que esta colección NO sume sola películas parecidas.
                    Sin esto, además de lo de arriba, entran solas las películas que comparten con las de la colección
                    su saga y sus palabras clave. En la consola del navegador, colExplica("marvel") muestra por qué entra cada una.
     excluir     -> OPCIONAL: títulos que NO quieres en esta colección:  excluir: ["Título exacto"]
     peliculas   -> los títulos de las películas de esta colección, ESCRITOS IGUAL que en el catálogo.
                    (También puedes poner el id de la colección en la columna "Colección" de la tabla de películas.)
   ============================================================ */
const COLECCIONES = [
  { id: "marvel", nombre: "Marvel", fondo: "https://static.vecteezy.com/system/resources/previews/020/336/409/non_2x/marvel-logo-marvel-icon-free-free-vector.jpg", sinNombre: true, a: "#e62429", b: "#3a0509", tx: "#ffffff", tema: "puntos",
    fuente: "Impact,'Arial Narrow Bold','Helvetica Neue',sans-serif", peso: "900", esp: ".03em", mayus: true,
    anuncio: { titulo: "", texto: "", imagen: "", enlace: "" },
    //  Ejemplo:  anuncio: { titulo: "Estreno esta semana", texto: "Ya disponible en Black BOX", imagen: "", enlace: "" },
    patron: "aranas", patronColor: "#ff4d52",
    tmdbEmpresas: ["Marvel Studios", "Marvel Entertainment"],
    tmdbPalabras: ["marvel cinematic universe"],
    //  Opcionales (quita las // para usarlos):
    //  tmdbPalabras: ["marvel cinematic universe", "marvel comic"],   // "marvel comic" también mete X-Men, Spider-Man de Sony, etc.
    //  excluir: ["Título exacto"],                                    // quitar una película en particular
    //  auto: false,                                                   // sin agrupación automática en esta colección
    peliculas: [] },

  { id: "dc", nombre: "DC", fondo: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSqnMNWGGu7XvBCDBbEC3PuBkWgHBNvx7YdOsuhXRtp7S0mdTyCNABQ_ik&s=10", sinNombre: true, a: "#0476f2", b: "#031a3a", tx: "#ffffff", tema: "rayos",
    fuente: "'Avenir Next','Helvetica Neue',Arial,sans-serif", peso: "900", esp: ".08em", mayus: true,
    anuncio: { titulo: "", texto: "", imagen: "", enlace: "" },
    patron: "murcielagos", patronColor: "#7db4ff",
    tmdbEmpresas: ["DC Entertainment", "DC Films", "DC Studios", "DC Comics"],
    tmdbPalabras: ["dc extended universe", "dc comics"],   // "dc comics" puede traer adaptaciones de DC/Vertigo; si entra una que no quieres, usa excluir: ["Título exacto"]
    peliculas: [] },

  // ----- Colecciones por director: entra toda película que él dirigió (según TMDB), sin tocar nada a mano.
  //       auto:false = solo sus películas, sin sumar otras parecidas. -----
  { id: "nolan", nombre: "Nolan", fondo: "https://abiquiunews.com/uploads/3/4/4/8/34481141/christophernolan20240912_orig.png" , a: "#5b6b7a", b: "#0a0e12", tx: "#ffffff", tema: "liso",
    fuente: "'Helvetica Neue',Arial,sans-serif", peso: "700", esp: ".16em", mayus: true,
    anuncio: { titulo: "", texto: "", imagen: "", enlace: "" },
    patron: "",
    tmdbDirectores: ["Christopher Nolan"], auto: false,
    peliculas: [] },

  { id: "tarantino", nombre: "Tarantino", fondo: "https://soulrideblog.com/wp-content/uploads/2019/03/qt3.jpg" , a: "#d9a406", b: "#1a1200", tx: "#ffffff", tema: "liso",
    fuente: "'Courier New',Courier,monospace", peso: "900", esp: ".06em", mayus: true,
    anuncio: { titulo: "", texto: "", imagen: "", enlace: "" },
    patron: "",
    tmdbDirectores: ["Quentin Tarantino"], auto: false,
    peliculas: [] }

  // ----- EJEMPLO listo para usar: quita las dos barras // de cada línea (y pon una coma después del bloque anterior) -----
  // ,{ id: "warner", nombre: "Warner Bros.", a: "#0b3d91", b: "#020b1f", tx: "#ffffff", tema: "estrellas",
  //    fuente: "Georgia,'Times New Roman',serif", peso: "700", esp: ".04em", mayus: true,
  //    anuncio: { titulo: "", texto: "", imagen: "", enlace: "" },
  //    tmdbEmpresasContiene: ["warner"],
  //    peliculas: [] }
];
