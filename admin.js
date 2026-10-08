import { json } from './_util.js';

// API del panel de administración. Solo responde si llega la clave correcta (variable ADMIN_KEY de Cloudflare).
const igual = (a, b) => a.length === b.length && [...a].reduce((x, c, i) => x | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;
const ALFA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';                 // sin letras que se confunden (O/0, I/1)
const nuevoCodigo = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => ALFA[b % 32]).join('');
const lineas = t => String(t || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 200);
const partes = l => l.split(/[,;\t]/).map(s => s.trim());
const entero = n => (n !== '' && n !== null && Number.isInteger(Number(n))) ? Number(n) : null;

export async function onRequestPost({ request, env }) {
  const db = env.DB, ahora = Date.now(), ip = request.headers.get('CF-Connecting-IP') || '?';
  if (!env.ADMIN_KEY) return json({ error: 'Falta crear la variable ADMIN_KEY en Cloudflare.' }, 503);
  const f = await db.prepare('SELECT COUNT(*) AS n FROM intentos WHERE ip = ?1 AND fecha > ?2').bind(ip, ahora - 600000).first();
  if (f.n >= 10) return json({ error: 'Demasiados intentos. Espera unos minutos.' }, 429);
  if (!igual(request.headers.get('X-Admin-Key') || '', String(env.ADMIN_KEY))) {
    await db.prepare('INSERT INTO intentos (ip, fecha) VALUES (?1, ?2)').bind(ip, ahora).run();
    return json({ error: 'Clave incorrecta.' }, 401);
  }
  const b = await request.json().catch(() => ({}));
  const ok = (o = {}) => json({ ok: true, ...o });
  const malo = m => json({ error: m }, 400);

  switch (b.accion) {
    case 'resumen': {
      const q = async s => (await db.prepare(s).all()).results;
      return json({
        usuarios: await q(`SELECT u.id, u.nombre, u.codigo, u.creditos, u.activo,
            (SELECT COUNT(*) FROM compras c WHERE c.usuario_id = u.id) AS compras,
            (SELECT fecha FROM accesos a WHERE a.usuario_id = u.id ORDER BY a.id DESC LIMIT 1) AS ultimo,
            (SELECT dispositivo FROM accesos a WHERE a.usuario_id = u.id ORDER BY a.id DESC LIMIT 1) AS dispositivo
          FROM usuarios u ORDER BY u.id DESC`),
        inventario: await q(`SELECT p.id, p.nombre, p.precio,
            COALESCE(SUM(c.estado = 'disponible'), 0) AS disponibles, COALESCE(SUM(c.estado = 'vendida'), 0) AS vendidas
          FROM plataformas p LEFT JOIN cuentas c ON c.plataforma = p.id GROUP BY p.id ORDER BY p.orden`),
        accesos: await q(`SELECT a.fecha, a.dispositivo, u.nombre FROM accesos a JOIN usuarios u ON u.id = a.usuario_id ORDER BY a.id DESC LIMIT 40`),
        ventas: await q(`SELECT c.fecha, c.precio, p.nombre AS plataforma, u.nombre FROM compras c
          JOIN usuarios u ON u.id = c.usuario_id JOIN plataformas p ON p.id = c.plataforma ORDER BY c.id DESC LIMIT 40`),
        dispositivos: await q(`SELECT dispositivo, COUNT(*) AS n FROM accesos GROUP BY dispositivo`)
      });
    }
    case 'crear_usuarios': {           // una persona por línea:  nombre,créditos   o   nombre,créditos,CÓDIGO
      const creados = [], errores = [];
      for (const l of lineas(b.texto).slice(0, 100)) {
        const [nombre, cr, cod] = partes(l), creditos = entero(cr || 0);
        if (!nombre || creditos === null || creditos < 0) { errores.push(l); continue; }
        const codigo = cod || nuevoCodigo();
        try {
          await db.prepare('INSERT INTO usuarios (codigo, nombre, creditos) VALUES (?1, ?2, ?3)').bind(codigo, nombre, creditos).run();
          creados.push({ nombre, codigo, creditos });
        } catch (e) { errores.push(l + '  (ese código ya existe)'); }
      }
      return ok({ creados, errores });
    }
    case 'creditos': {                 // sumar (o restar con número negativo) o fijar el total
      const id = entero(b.id), n = entero(b.cantidad);
      if (id === null || n === null) return malo('Datos no válidos.');
      await db.prepare(b.modo === 'fijar' ? 'UPDATE usuarios SET creditos = MAX(0, ?1) WHERE id = ?2'
                                          : 'UPDATE usuarios SET creditos = MAX(0, creditos + ?1) WHERE id = ?2').bind(n, id).run();
      return ok();
    }
    case 'activo': {                   // bloquear / desbloquear un código
      const id = entero(b.id);
      if (id === null) return malo('Datos no válidos.');
      await db.prepare('UPDATE usuarios SET activo = ?1 WHERE id = ?2').bind(b.activo ? 1 : 0, id).run();
      return ok();
    }
    case 'agregar_cuentas': {          // una cuenta por línea:  correo,contraseña,perfil
      const p = await db.prepare('SELECT id FROM plataformas WHERE id = ?1').bind(String(b.plataforma)).first();
      if (!p) return malo('Plataforma no válida.');
      const filas = lineas(b.texto).map(partes).filter(x => x[0] && x[1]);
      if (!filas.length) return malo('No encontré cuentas. Usa una por línea: correo,contraseña,perfil');
      await db.batch(filas.map(x => db.prepare('INSERT INTO cuentas (plataforma, correo, clave, perfil) VALUES (?1, ?2, ?3, ?4)').bind(p.id, x[0], x[1], x.slice(2).join(' '))));
      return ok({ agregadas: filas.length });
    }
    case 'precio': {
      const n = entero(b.precio);
      if (n === null || n < 0) return malo('Precio no válido.');
      await db.prepare('UPDATE plataformas SET precio = ?1 WHERE id = ?2').bind(n, String(b.plataforma)).run();
      return ok();
    }
    default: return malo('Acción desconocida.');
  }
}
