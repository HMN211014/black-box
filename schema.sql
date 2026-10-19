-- Black BOX · tablas de usuarios en D1
-- Pégalo completo en: Cloudflare > D1 > tu base > Console > Execute.
-- (Es seguro ejecutarlo más de una vez: no borra nada.)

CREATE TABLE IF NOT EXISTS usuarios (
  correo  TEXT PRIMARY KEY,
  salt    TEXT NOT NULL,
  hash    TEXT NOT NULL,
  creado  INTEGER NOT NULL,
  vence   INTEGER NOT NULL DEFAULT 0,     -- hasta cuándo tiene plan por días (milisegundos)
  plan    TEXT,                           -- basico | plus | pedidos
  vales   INTEGER NOT NULL DEFAULT 0,     -- películas por canjear (plan "Películas por pedido")
  canje   INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS sesiones (
  token   TEXT PRIMARY KEY,
  correo  TEXT NOT NULL,
  creado  INTEGER NOT NULL,
  expira  INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sesiones_correo ON sesiones (correo);

CREATE TABLE IF NOT EXISTS codigos (
  codigo      TEXT PRIMARY KEY,
  plan        TEXT NOT NULL,
  dias        INTEGER,
  peliculas   INTEGER,
  creado      INTEGER NOT NULL,
  usado_por   TEXT,
  usado_fecha INTEGER
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS lista (
  correo  TEXT NOT NULL,
  titulo  TEXT NOT NULL,
  tmdb    INTEGER,
  fecha   INTEGER NOT NULL,
  PRIMARY KEY (correo, titulo)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS pedidos (
  id      TEXT PRIMARY KEY,
  correo  TEXT NOT NULL,
  tmdb    INTEGER,
  tipo    TEXT,
  titulo  TEXT,
  anio    TEXT,
  poster  TEXT,
  estado  TEXT NOT NULL DEFAULT 'pendiente',
  creado  INTEGER NOT NULL,
  listo   INTEGER,
  vale    INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS pedidos_correo ON pedidos (correo);

CREATE TABLE IF NOT EXISTS intentos (
  clave   TEXT PRIMARY KEY,
  n       INTEGER NOT NULL,
  expira  INTEGER NOT NULL
) WITHOUT ROWID;

-- Solo se usa si el bucket de R2 (DATOS) no está conectado
CREATE TABLE IF NOT EXISTS datos (
  correo  TEXT PRIMARY KEY,
  json    TEXT NOT NULL
) WITHOUT ROWID;

-- Películas y series publicadas desde el panel de admin (antes estaban en KV).
-- El Worker también las crea solo la primera vez, así que ejecutar esto es opcional.
-- "episodios" guarda los enlaces sueltos por capítulo como JSON: {"1x1":"https://…","1x2":"https://…"}
CREATE TABLE IF NOT EXISTS publicados (
  tmdb      INTEGER PRIMARY KEY,
  titulo    TEXT NOT NULL,
  tipo      TEXT NOT NULL DEFAULT 'pelicula',   -- pelicula | serie
  link      TEXT NOT NULL DEFAULT '',           -- enlace de la película, o plantilla {t}/{e} de la serie
  episodios TEXT NOT NULL DEFAULT '{}',
  creado    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  clave TEXT PRIMARY KEY,
  valor TEXT
) WITHOUT ROWID;

-- Colecciones del inicio creadas desde el panel de admin (también se crea sola la primera vez).
-- "datos" es el JSON de la colección tal como la arma el panel.
CREATE TABLE IF NOT EXISTS colecciones (
  id     TEXT PRIMARY KEY,
  datos  TEXT NOT NULL,
  creado INTEGER NOT NULL
);

-- Secciones temáticas del inicio o de una colección (como "Huluween"): franja con carrusel + página propia.
-- "datos" es el JSON de la sección tal como la arma el panel (también se crea sola la primera vez).
CREATE TABLE IF NOT EXISTS secciones (
  id     TEXT PRIMARY KEY,
  datos  TEXT NOT NULL,
  creado INTEGER NOT NULL
);
