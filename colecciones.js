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
     peliculas   -> los títulos de las películas de esta colección, ESCRITOS IGUAL que en el catálogo.
                    (También puedes poner el id de la colección en la columna "Colección" de la tabla de películas.)
   ============================================================ */
const COLECCIONES = [
  { id: "marvel", nombre: "Marvel", a: "#e62429", b: "#3a0509", tx: "#ffffff", tema: "puntos",
    fuente: "Impact,'Arial Narrow Bold','Helvetica Neue',sans-serif", peso: "900", esp: ".03em", mayus: true,
    anuncio: { titulo: "", texto: "", imagen: "", enlace: "" },
    //  Ejemplo:  anuncio: { titulo: "Estreno esta semana", texto: "Ya disponible en Black BOX", imagen: "", enlace: "" },
    patron: "aranas", patronColor: "#ff4d52",
    tmdbEmpresas: ["Marvel Studios", "Marvel Entertainment"],
    peliculas: [] },

  { id: "dc", nombre: "DC", a: "#0476f2", b: "#031a3a", tx: "#ffffff", tema: "rayos",
    fuente: "'Avenir Next','Helvetica Neue',Arial,sans-serif", peso: "900", esp: ".08em", mayus: true,
    anuncio: { titulo: "", texto: "", imagen: "", enlace: "" },
    patron: "murcielagos", patronColor: "#7db4ff",
    tmdbEmpresas: ["DC Entertainment", "DC Films", "DC Studios", "DC Comics"],
    peliculas: [] }

  // ----- EJEMPLO listo para usar: quita las dos barras // de cada línea (y pon una coma después del bloque anterior) -----
  // ,{ id: "warner", nombre: "Warner Bros.", a: "#0b3d91", b: "#020b1f", tx: "#ffffff", tema: "estrellas",
  //    fuente: "Georgia,'Times New Roman',serif", peso: "700", esp: ".04em", mayus: true,
  //    anuncio: { titulo: "", texto: "", imagen: "", enlace: "" },
  //    tmdbEmpresasContiene: ["warner"],
  //    peliculas: [] }
];
