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
