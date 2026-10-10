/* ============================================================
   COLECCIONES POR TEMÁTICA (la usa index.html)
   Para agregar una colección nueva: copia un bloque completo (de { a }), pégalo al final
   (antes del ] ) con una coma entre bloques, y cambia los datos.

     id          -> sin espacios ni acentos; va en el enlace (#/c/marvel)
     nombre      -> lo que se lee en el cuadro y en la página
     a, b        -> colores del cuadro (degradado)       tx -> color del nombre
     tema        -> dibujo de fondo del cuadro: "puntos" (cómic), "rayos", "estrellas" o "liso"
     fondo       -> OPCIONAL: foto de fondo del cuadro, p. ej. "/img/marvel.jpg" (sustituye al tema)
     logo        -> OPCIONAL: imagen del logo, p. ej. "/logos/marvel.png" (sustituye al nombre escrito)
     fuente, peso, esp, mayus -> estilo de las letras del nombre
     anuncio     -> el banner de arriba de la página de la colección. Llena lo que quieras:
                    titulo, texto, imagen (foto de fondo) y enlace (a dónde lleva al tocarlo).
                    Si lo dejas todo vacío ("") el banner no aparece.
     peliculas   -> los títulos de las películas de esta colección, ESCRITOS IGUAL que el
                    "titulo" que tienen en la lista de películas de index.html
   ============================================================ */
const COLECCIONES = [
  { id: "marvel", nombre: "Marvel", a: "#e62429", b: "#3a0509", tx: "#ffffff", tema: "puntos",
    fuente: "Impact,'Arial Narrow Bold','Helvetica Neue',sans-serif", peso: "900", esp: ".03em", mayus: true,
    anuncio: { titulo: "", texto: "", imagen: "", enlace: "" },
    //  Ejemplo:  anuncio: { titulo: "Estreno esta semana", texto: "Ya disponible en Black BOX", imagen: "", enlace: "" },
    peliculas: ["Spiderman:Brand New day"] },

  { id: "dc", nombre: "DC", a: "#0476f2", b: "#031a3a", tx: "#ffffff", tema: "rayos",
    fuente: "'Avenir Next','Helvetica Neue',Arial,sans-serif", peso: "900", esp: ".08em", mayus: true,
    anuncio: { titulo: "", texto: "", imagen: "", enlace: "" },
    peliculas: [] }
];
