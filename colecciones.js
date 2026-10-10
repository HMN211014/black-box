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
  { id: "marvel", nombre: "Marvel", a: "#e62429", b: "#3a0509", tx: "#ffffff", logo: "https://static.wikia.nocookie.net/logopedia/images/c/cd/Marvel_Entertainment_Logo_%282012%29.jpg/revision/latest?cb=20190325210512",
    fuente: "Impact,'Arial Narrow Bold','Helvetica Neue',sans-serif", peso: "900", esp: ".03em", mayus: true,
    anuncio: { titulo: "Camino a Doomsday", texto: "Una guia de las peliculas que debes ver para comprender mejor Avengers Doomsday", imagen: "", enlace: "" },
    //  Ejemplo:  anuncio: { titulo: "Estreno esta semana", texto: "Ya disponible en Black BOX", imagen: "https://www.laughingplace.com/uploads/media/2026/10/httpsus.list-manage.comgh2v7iVI5CAe-c72bbcc132-c2id-6b02c62472d50de4d0289667542d94d3-(9).jpg/w1280", enlace: "" },
    peliculas: ["Spiderman:Brand New day"] },

  { id: "dc", nombre: "DC", a: "#0476f2", b: "#031a3a", tx: "#ffffff", logo: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQwySfFfOqBP-N9odmEADvpcaWTnWLFagdYWI_WZifL3_vskl_PJo-fW50&s=10",
    fuente: "'Avenir Next','Helvetica Neue',Arial,sans-serif", peso: "900", esp: ".08em", mayus: true,
    anuncio: { titulo: "", texto: "", imagen: "", enlace: "" },
    peliculas: [] }
];
