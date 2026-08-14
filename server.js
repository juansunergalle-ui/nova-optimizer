'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

/* ============================================================
   NOVA OPTIMIZER — Servidor unificado en un solo archivo
   (server.js + db + auth + optimizer + ytd + dxt + ytdOptimizer
    + rsc7 + zip + zipOptimizer)
   ============================================================ */

// Cargador de módulos embebidos: cada módulo se define como una
// función y los require() relativos resuelven contra _modules.
const _modules = {};

function _def(name, factory) {
  const module = { exports: {} };
  const localRequire = (id) => {
    if (Object.prototype.hasOwnProperty.call(_modules, id)) return _modules[id];
    return require(id);
  };
  factory(module, module.exports, localRequire, __dirname, __filename);
  _modules[name] = module.exports;
}

// ============================================================
// Módulo: ./db
// ============================================================
_def('./db', function (module, exports, require, __dirname, __filename) {
'use strict';

const mysql = require('mysql2/promise');

let pool = null;

function init() {
  const cfg = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4',
  };

  // SSL (Aiven y otros hosts lo exigen). Cuando el proveedor usa un CA propio
  // (Aiven), verificamos contra el CA del sistema; si el host no lo expone,
  // caemos a rejectUnauthorized:false para no bloquear la conexion.
  if (process.env.DB_SSL === 'true') {
    cfg.ssl = { rejectUnauthorized: false };
  }

  if (!cfg.host || !cfg.user || !cfg.password || !cfg.database) {
    console.warn('[DB] Credenciales MySQL no configuradas en .env. El historial quedara desactivado.');
    return null;
  }

  pool = mysql.createPool(cfg);
  ensureSchema().catch(() => {});
  return pool;
}

function getPool() {
  if (!pool) pool = init();
  return pool;
}

async function isReady() {
  try {
    const p = getPool();
    if (!p) return false;
    await p.query('SELECT 1');
    return true;
  } catch (err) {
    console.warn('[DB] No se pudo conectar a MySQL:', err.message);
    return false;
  }
}

async function saveOptimization(record) {
  try {
    const p = getPool();
    if (!p) return false;
    const sql =
      'INSERT INTO optimizations (user_email, original_name, file_type, original_size, optimized_size, savings_bytes, savings_pct, comments_removed, empties_removed, dups_removed, decimals_trimmed, elapsed_ms, client_ip) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)';
    await p.query(sql, [
      record.user_email || null,
      record.original_name,
      record.file_type,
      record.original_size,
      record.optimized_size,
      record.savings_bytes,
      record.savings_pct,
      record.comments_removed,
      record.empties_removed,
      record.dups_removed,
      record.decimals_trimmed,
      record.elapsed_ms,
      record.client_ip,
    ]);
    return true;
  } catch (err) {
    console.warn('[DB] No se pudo guardar en MySQL:', err.message);
    return false;
  }
}

async function getHistory(limit = 20, userEmail = null) {
  try {
    const p = getPool();
    if (!p) return [];
    let sql =
      'SELECT id, original_name, file_type, original_size, optimized_size, savings_bytes, savings_pct, created_at FROM optimizations';
    const params = [];
    if (userEmail) {
      sql += ' WHERE user_email = ?';
      params.push(userEmail);
    }
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(Math.min(Math.max(limit, 1), 100));
    const [rows] = await p.query(sql, params);
    return rows;
  } catch (err) {
    console.warn('[DB] No se pudo leer historial:', err.message);
    return [];
  }
}

// Crea la tabla si no existe y migra columnas nuevas (idempotente).
async function ensureSchema() {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(`CREATE TABLE IF NOT EXISTS optimizations (
      id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_email       VARCHAR(255) NULL,
      original_name    VARCHAR(255) NOT NULL,
      file_type        VARCHAR(32)  NOT NULL DEFAULT 'xml',
      original_size    INT UNSIGNED NOT NULL DEFAULT 0,
      optimized_size   INT UNSIGNED NOT NULL DEFAULT 0,
      savings_bytes    INT          NOT NULL DEFAULT 0,
      savings_pct      DECIMAL(6,3) NOT NULL DEFAULT 0,
      comments_removed INT UNSIGNED NOT NULL DEFAULT 0,
      empties_removed  INT UNSIGNED NOT NULL DEFAULT 0,
      dups_removed     INT UNSIGNED NOT NULL DEFAULT 0,
      decimals_trimmed INT UNSIGNED NOT NULL DEFAULT 0,
      elapsed_ms       INT UNSIGNED NOT NULL DEFAULT 0,
      client_ip        VARCHAR(45)  NULL,
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB`);
  } catch (err) {
    console.warn('[DB] ensureSchema (create):', err.message);
  }
  try {
    await p.query('ALTER TABLE optimizations ADD COLUMN user_email VARCHAR(255) NULL');
  } catch (err) {
    if (!/Duplicate column/i.test(err.message)) {
      console.warn('[DB] ensureSchema (migracion user_email):', err.message);
    }
  }
}

module.exports = { init, getPool, isReady, ensureSchema, saveOptimization, getHistory };
});

// ============================================================
// Módulo: ./auth
// ============================================================
_def('./auth', function (module, exports, require, __dirname, __filename) {
'use strict';

/* ============================================================
   Autenticación Google OAuth 2.0 (sin dependencias externas)
   Sesiones en memoria + cookie HttpOnly firmada por token.
   ============================================================ */

const crypto = require('crypto');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

// Mapa de sesiones: token -> { user, createdAt }
const sessions = new Map();

// Limpieza periódica de sesiones vencidas
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(token);
  }
}, 60 * 60 * 1000).unref();

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  });
  return out;
}

function serializeCookie(name, value, maxAgeSec, secure) {
  const parts = [name + '=' + encodeURIComponent(value), 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSec != null) parts.push('Max-Age=' + maxAgeSec);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie(name) {
  return name + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { user, createdAt: Date.now() });
  return token;
}

function getSession(req) {
  const token = parseCookies(req).nova_session;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return s.user;
}

function destroySession(req) {
  const token = parseCookies(req).nova_session;
  if (token) sessions.delete(token);
}

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function authUrl(baseUrl, state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: baseUrl + '/auth/google/callback',
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    state,
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

async function exchangeCode(baseUrl, code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri: baseUrl + '/auth/google/callback',
      grant_type: 'authorization_code',
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.id_token) {
    throw new Error(data.error_description || data.error || 'Error al intercambiar el código con Google');
  }

  // Decodificar el payload del id_token (JWT): sub, email, name, picture
  const payloadB64 = data.id_token.split('.')[1];
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

  return {
    id: payload.sub,
    email: payload.email || '',
    name: payload.name || payload.email || 'Usuario',
    picture: payload.picture || '',
    emailVerified: !!payload.email_verified,
  };
}

module.exports = {
  parseCookies,
  serializeCookie,
  clearCookie,
  createSession,
  getSession,
  destroySession,
  isConfigured,
  authUrl,
  exchangeCode,
};
});

// ============================================================
// Módulo: ./optimizer
// ============================================================
_def('./optimizer', function (module, exports, require, __dirname, __filename) {
'use strict';

/**
 * NOVA OPTIMIZER - Motor de optimizacion XML de FiveM
 *
 * Optimiza archivos XML/META de addon props y clothing de FiveM:
 *  - .ytp.xml / .ytyp.xml  (arquetipos de props)
 *  - .ymt.xml / clothing meta (ShopPedApparel)
 *  - .meta generico (vehicles.meta, handling.meta, etc.)
 *
 * Estrategias aplicadas (todas seguras y reversibles):
 *  1. Eliminacion de comentarios XML
 *  2. Compactacion de espacios y lineas en blanco entre nodos
 *  3. Eliminacion de nodos vacios (sin contenido y sin hijos)
 *  4. Eliminacion de nodos <Item> vacios (tipicos de RAGE meta)
 *  5. Recorte de decimales en valores numericos de atributos y texto
 *  6. Normalizacion de fin de linea y codificacion
 */

// ---------------------------------------------------------------
// Utilidades de conteo
// ---------------------------------------------------------------

function countOccurrences(str, sub) {
  let n = 0;
  let idx = str.indexOf(sub);
  while (idx !== -1) {
    n++;
    idx = str.indexOf(sub, idx + sub.length);
  }
  return n;
}

// ---------------------------------------------------------------
// Paso 1: eliminar comentarios XML  <!-- ... -->
// ---------------------------------------------------------------

function stripComments(xml, stats) {
  let before = countOccurrences(xml, '<!--');
  // Eliminar comentarios, permitiendo que se eliminen de forma segura
  // sin tocar el contenido dentro de las etiquetas.
  let out = xml.replace(/<!--[\s\S]*?-->/g, function (m) {
    stats.comments_removed++;
    return '';
  });
  stats.comments_found = before;
  return out;
}

// ---------------------------------------------------------------
// Paso 2: detectar y eliminar nodos vacios
// Un nodo vacio puede ser:  <tag></tag>  o  <tag />
// ---------------------------------------------------------------

function stripEmptyNodes(xml, stats) {
  let result = xml;
  let changed = true;
  let passes = 0;

  // Solo eliminamos nodos SIN atributos y SIN contenido.
  // Los elementos con atributos (p.ej. <bbMin x=".." y=".." z=".."/>) contienen
  // datos y NUNCA deben eliminarse.

  // Iteramos hasta estabilizar porque eliminar un padre puede
  // volver vacio a su abuelo.
  while (changed && passes < 20) {
    changed = false;
    passes++;

    // <tag></tag>  -> eliminar (solo si no tiene atributos)
    const emptyPair = /<([a-zA-Z_][\w:.-]*)>(\s*)<\/\1>/g;
    result = result.replace(emptyPair, function (m, name) {
      changed = true;
      stats.empties_removed++;
      return '';
    });

    // <tag />  -> eliminar (solo si no tiene atributos)
    const selfClose = /<([a-zA-Z_][\w:.-]*)\s*\/>/g;
    result = result.replace(selfClose, function (m, name) {
      changed = true;
      stats.empties_removed++;
      return '';
    });
  }

  return result;
}

// ---------------------------------------------------------------
// Paso 3: recortar decimales en valores numericos
  // Convierte 1.123456789  ->  1.123457  (precision configurable)
// Aplica a atributos (value="..") y texto numerico directo.
// ---------------------------------------------------------------

function trimDecimals(xml, decimals, stats) {
  const factor = Math.pow(10, decimals);
  const fmt = function (n) {
    let r = Math.round(n * factor) / factor;
    // devolver sin ceros a la derecha
    return String(r);
  };

  // Atributos:  name="123.456789"  (solo floats)
  let out = xml.replace(/([A-Za-z_:][\w:.-]*=")(-?\d+\.\d+)(?=")/g, function (m, pre, num) {
    stats.decimals_trimmed++;
    return pre + fmt(parseFloat(num));
  });

  // Texto numerico dentro de etiquetas:  <value>1.23456789</value>
  out = out.replace(/>(-?\d+\.\d+)</g, function (m, num) {
    stats.decimals_trimmed++;
    return '>' + fmt(parseFloat(num)) + '<';
  });

  return out;
}

// ---------------------------------------------------------------
// Paso 5: compactar espacios entre etiquetas y normalizar lineas
// ---------------------------------------------------------------

function compactWhitespace(xml) {
  // Normalizar CRLF -> LF
  let out = xml.replace(/\r\n?/g, '\n');

  // Colapsar bloques de espacio/saltos entre '>' y '<'
  out = out.replace(/>(\s+)</g, function (m, ws) {
    // Solo colapsar si no hay texto significativo: entre tags es seguro
    return '><';
  });

  // Colapsar espacios multiples dentro del texto
  out = out.replace(/[ \t]{2,}/g, ' ');

  // Quitar lineas en blanco
  out = out.replace(/\n\s*\n/g, '\n');

  return out.trim();
}

// ---------------------------------------------------------------
// Clasificacion del tipo de archivo
// ---------------------------------------------------------------

function classifyType(name, content) {
  const ext = (name || '').toLowerCase();
  if (/\.ytyp\.xml$/.test(ext) || /\.ytp\.xml$/.test(ext)) return 'YTYP';
  if (/\.ymt\.xml$/.test(ext)) return 'YMT';
  if (/\.meta$/i.test(ext)) return 'META';
  if (/ShopPedApparel|pedOutfits|pedComponents/.test(content)) return 'CLOTHING';
  if (/CMapTypes|archetype|CBaseArchetypeDef|weaponArchetype/.test(content)) return 'YTYP';
  if (/handlingData|CLaunchData/.test(content)) return 'META';
  return 'XML';
}

// ---------------------------------------------------------------
// Optimizacion principal
// ---------------------------------------------------------------

/**
 * @param {Buffer} buffer
 * @param {object} options
 *   - keepDeclaration {boolean} mantener <?xml ...?>
 *   - trimDecimals {number}     digitos decimales (0 = desactivado)
 * @returns {{out:Buffer, stats:object, type:string}}
 */
function optimize(buffer, options = {}) {
  const t0 = Date.now();
  const keepDeclaration = options.keepDeclaration !== false;
  const decimals = typeof options.trimDecimals === 'number' ? options.trimDecimals : 6;

  let stats = {
    comments_removed: 0,
    comments_found: 0,
    empties_removed: 0,
    dups_removed: 0,
    decimals_trimmed: 0,
  };

  // Decodificar: preferir UTF-8; soporta BOM
  let text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  let hadBOM = /^\uFEFF/.test(buffer.toString('utf8'));
  const type = classifyType(options.filename || '', text);

  // Guardar declaracion XML para restaurarla al final
  let declaration = '';
  const declMatch = /^\s*<\?xml[\s\S]*?\?>/i.exec(text);
  if (declMatch) {
    declaration = declMatch[0];
    text = text.slice(declMatch.index + declMatch[0].length);
  }

  // --- Optimizaciones ---
  text = stripComments(text, stats);
  text = stripEmptyNodes(text, stats);
  if (decimals > 0) {
    text = trimDecimals(text, decimals, stats);
  }
  text = compactWhitespace(text);

  // Reensamblar
  let final = '';
  if (keepDeclaration && declaration) {
    final += declaration + '\n';
  }
  final += text;
  if (!final.endsWith('\n')) final += '\n';

  const optimized = Buffer.from(final, 'utf8');

  return {
    out: optimized,
    type,
    stats,
    hadBOM,
    elapsed_ms: Date.now() - t0,
  };
}

module.exports = { optimize, classifyType };
});

// ============================================================
// Módulo: ./ytd
// ============================================================
_def('./ytd', function (module, exports, require, __dirname, __filename) {
'use strict';

/* ============================================================
   NOVA OPTIMIZER — Motor YTD (Texture Dictionary de GTA V/FiveM)
   Parser + escritor RSC7 v12 (basado en rpf-rs / CodeWalker)
   ============================================================ */

const zlib = require('zlib');

const RSC7_MAGIC = 0x37435352; // "RSC7"
const VERSION = 12;            // GTA V (Gen8 PC)

const SYS_BASE = 0x50000000;
const GFX_BASE = 0x60000000;

// VFT del CTexDict en el juego (visto en archivos .ytd reales)
const DEFAULT_FILE_VFT = 0x40571500;

// ---- Formatos de textura ------------------------------------------------

const FMT = {
  A8R8G8B8: 21,
  X8R8G8B8: 22,
  A1R5G5B5: 25,
  A8: 28,
  A8B8G8R8: 32,
  L8: 50,
  DXT1: 0x31545844,
  DXT3: 0x33545844,
  DXT5: 0x35545844,
  ATI1: 0x31495441,
  ATI2: 0x32495441,
  BC7: 0x20374342,
};

function fmtName(v) {
  switch (v) {
    case FMT.A8R8G8B8: return 'A8R8G8B8';
    case FMT.X8R8G8B8: return 'X8R8G8B8';
    case FMT.A1R5G5B5: return 'A1R5G5B5';
    case FMT.A8: return 'A8';
    case FMT.A8B8G8R8: return 'A8B8G8R8';
    case FMT.L8: return 'L8';
    case FMT.DXT1: return 'DXT1';
    case FMT.DXT3: return 'DXT3';
    case FMT.DXT5: return 'DXT5';
    case FMT.ATI1: return 'ATI1 (BC4)';
    case FMT.ATI2: return 'ATI2 (BC5)';
    case FMT.BC7: return 'BC7';
    default: return 'Desconocido (' + (v >>> 0).toString(16) + ')';
  }
}

function isBlockCompressed(fmt) {
  return fmt === FMT.DXT1 || fmt === FMT.DXT3 || fmt === FMT.DXT5 ||
         fmt === FMT.ATI1 || fmt === FMT.ATI2 || fmt === FMT.BC7;
}

function bytesPerPixel(fmt) {
  switch (fmt) {
    case FMT.A8R8G8B8:
    case FMT.A8B8G8R8:
    case FMT.X8R8G8B8: return 4;
    case FMT.A1R5G5B5: return 2;
    case FMT.A8:
    case FMT.L8: return 1;
    case FMT.DXT1:
    case FMT.ATI1: return 0.5;
    case FMT.DXT3:
    case FMT.DXT5:
    case FMT.ATI2:
    case FMT.BC7: return 1;
    default: return 0;
  }
}

// ---- Tamaños RSC7 (igual que CodeWalker / rpf-rs) ------------------------

function resourceSizeFromFlags(flags) {
  const s0 = ((flags >> 27) & 0x1) << 0;
  const s1 = ((flags >> 26) & 0x1) << 1;
  const s2 = ((flags >> 25) & 0x1) << 2;
  const s3 = ((flags >> 24) & 0x1) << 3;
  const s4 = ((flags >> 17) & 0x7f) << 4;
  const s5 = ((flags >> 11) & 0x3f) << 5;
  const s6 = ((flags >> 7) & 0xf) << 6;
  const s7 = ((flags >> 5) & 0x3) << 7;
  const s8 = ((flags >> 4) & 0x1) << 8;
  const ss = flags & 0xf;
  const base = 0x200 << ss;
  return base * (s0 + s1 + s2 + s3 + s4 + s5 + s6 + s7 + s8);
}

// Inverso de resourceSizeFromFlags (misma codificación que CodeWalker):
// size = (0x200 << ss) * count, con count = low4 + s4v*16.
// Usamos solo los campos s0-s3 y s4 (máx 2047 bloques) -> exacto.
function flagsFromSize(size, version) {
  let ss = 0;
  let count = Math.ceil(size / 0x200);
  while (count > 2047 && ss < 15) {
    ss += 1;
    count = Math.ceil(size / (0x200 << ss));
  }
  let flags = (version & 0xf) << 28;
  flags |= ss & 0xf;
  if (count > 0) {
    const s4v = (count >> 4) & 0x7f;
    const low = count & 0xf;
    flags |= s4v << 17;
    flags |= (low & 0x1) << 27;
    flags |= ((low >> 1) & 0x1) << 26;
    flags |= ((low >> 2) & 0x1) << 25;
    flags |= ((low >> 3) & 0x1) << 24;
  }
  return flags >>> 0;
}

// Número de "páginas" de 0x200<<ss bytes que codifica un valor de flags.
// CodeWalker usa esto para SystemPagesCount/GraphicsPagesCount.
function pageCountFromFlags(flags) {
  const c =
    ((flags >> 27) & 0x1) +
    ((flags >> 26) & 0x1) +
    ((flags >> 25) & 0x1) +
    ((flags >> 24) & 0x1) +
    ((flags >> 17) & 0x7f) +
    ((flags >> 11) & 0x3f) +
    ((flags >> 7) & 0xf) +
    ((flags >> 5) & 0x3) +
    ((flags >> 4) & 0x1);
  return c;
}

// ---- Descompresión del cuerpo RSC7 ----------------------------------------

function decompressBody(body) {
  // deflate crudo (RFC1951), luego zlib, y si nada, asumir sin comprimir
  try {
    const out = zlib.inflateRawSync(body, { maxOutputLength: 512 * 1024 * 1024 });
    if (out.length) return out;
  } catch (e) { /* siguiente */ }
  try {
    const out = zlib.inflateSync(body);
    if (out.length) return out;
  } catch (e) { /* siguiente */ }
  return body;
}

// ---- ResReader virtual ----------------------------------------------------

function makeReader(system, graphics) {
  return {
    system,
    graphics,
    resolve(va, len) {
      if (va === 0) return null;
      if ((va & 0x50000000) === 0x50000000 && (va & 0x60000000) !== 0x60000000) {
        const off = va - SYS_BASE;
        if (off < 0 || off + len > system.length) return null;
        return system.subarray(off, off + len);
      }
      if ((va & 0x60000000) === 0x60000000) {
        const off = va - GFX_BASE;
        if (off < 0 || off + len > graphics.length) return null;
        return graphics.subarray(off, off + len);
      }
      return null;
    },
    stringAt(va) {
      if ((va & 0x50000000) !== 0x50000000 || (va & 0x60000000) === 0x60000000) return null;
      const off = va - SYS_BASE;
      if (off < 0 || off >= system.length) return null;
      let end = off;
      while (end < system.length && system[end] !== 0) end += 1;
      return system.subarray(off, end).toString('utf8');
    },
  };
}

function calcPixelDataSize(stride, height, levels) {
  let total = 0;
  let length = stride * height;
  for (let i = 0; i < levels; i++) {
    total += length;
    length = Math.floor(length / 4);
  }
  return total;
}

// ---- Parseo ---------------------------------------------------------------

function parseYtd(data) {
  if (!Buffer.isBuffer(data)) data = Buffer.from(data);
  if (data.length < 16) throw new Error('El archivo es demasiado corto para ser un YTD.');
  if (data.readUInt32LE(0) !== RSC7_MAGIC) {
    throw new Error('No es un YTD válido (falta la cabecera RSC7).');
  }

  const sysFlags = data.readUInt32LE(8);
  const gfxFlags = data.readUInt32LE(12);
  const sysSize = resourceSizeFromFlags(sysFlags);
  const gfxSize = resourceSizeFromFlags(gfxFlags);

  const decomp = decompressBody(data.subarray(16));
  if (decomp.length < sysSize) {
    throw new Error('Sección de sistema inválida (tamaño descomprimido menor al esperado).');
  }

  const system = decomp.subarray(0, sysSize);
  const graphics = decomp.subarray(sysSize, sysSize + Math.min(gfxSize, decomp.length - sysSize));
  const reader = makeReader(system, graphics);

  const textures = parseTextureDict(reader);
  const compressedRatio = data.length > 0 ? ((data.length - decomp.length) / data.length) * 100 : 0;

  // Cabecera del TextureDictionary (ResourceFileBase + campos reservados en 0x10)
  const fileVft = system.length >= 16 ? system.readUInt32LE(0) : 0;
  const dictHeader = system.length >= 32
    ? [system.readUInt32LE(0x10), system.readUInt32LE(0x14), system.readUInt32LE(0x18), system.readUInt32LE(0x1c)]
    : [0, 0, 1, 0];

  return {
    version: ((sysFlags >> 28) & 0xf) << 4 | ((gfxFlags >> 28) & 0xf),
    sysSize,
    gfxSize,
    fileSize: data.length,
    decompressedSize: decomp.length,
    compressedRatio,
    textures,
    raw: data,
    sysFlags,
    gfxFlags,
    fileVft,
    dictHeader,
  };
}

function parseTextureDict(reader) {
  const sys = reader.system;
  if (sys.length < 64) throw new Error('Sección de sistema demasiado pequeña para un TextureDictionary.');

  // ResourceFileBase: VFT(4) + FileUnknown(4) + FilePagesInfoPointer(8)
  const fileVft = sys.readUInt32LE(0);
  const fileUnknown = sys.readUInt32LE(4);
  const filePagesInfoPtr = Number(sys.readBigUInt64LE(8));

  // Las listas ResourceSimpleList64 usan count/capacity como u16.
  const hashPtr = Number(sys.readBigUInt64LE(0x20));
  const hashCount = sys.readUInt16LE(0x28);
  const texPtr = Number(sys.readBigUInt64LE(0x30));
  const texCount = sys.readUInt16LE(0x38);

  if (texCount === 0) return [];

  const ptrData = reader.resolve(texPtr, texCount * 8);
  if (!ptrData) throw new Error('No se pudieron leer los punteros de texturas (diccionario corrupto).');

  const hashData = hashCount > 0 ? reader.resolve(hashPtr, hashCount * 4) : null;

  const textures = [];
  for (let i = 0; i < texCount; i++) {
    const texVa = Number(ptrData.readBigUInt64LE(i * 8));
    if (texVa === 0) continue;
    const nameHash = hashData ? hashData.readUInt32LE(i * 4) : 0;
    try {
      textures.push(parseTexture(texVa, nameHash, reader));
    } catch (e) {
      // textura individual corrupta: se omite pero no se tira el archivo
    }
  }
  return textures;
}

function parseTexture(texVa, nameHash, reader) {
  const raw = reader.resolve(texVa, 0x90);
  if (!raw) throw new Error('Struct de textura fuera de límites');

  const name = reader.stringAt(Number(raw.readBigUInt64LE(0x28))) || 'textura_' + nameHash.toString(16);
  const width = raw.readUInt16LE(0x50);
  const height = raw.readUInt16LE(0x52);
  const depth = raw.readUInt16LE(0x54);
  const stride = raw.readUInt16LE(0x56);
  const format = raw.readUInt32LE(0x58);
  const levels = raw[0x5d];
  const dataPtr = Number(raw.readBigUInt64LE(0x70));

  const pixelSize = calcPixelDataSize(stride, height, levels);
  let pixelData = Buffer.alloc(0);
  if (pixelSize > 0 && dataPtr !== 0) {
    const d = reader.resolve(dataPtr, pixelSize);
    if (d) pixelData = Buffer.from(d);
  }

  return {
    name,
    nameHash,
    width,
    height,
    depth,
    stride,
    format,
    formatName: fmtName(format),
    levels,
    pixelSize,
    pixelData,
  };
}

// ---- Writer DDS -----------------------------------------------------------

function toDds(tex) {
  const out = [];
  const fmt = tex.format;
  const isC = isBlockCompressed(fmt);
  const hasMips = tex.levels > 1;

  let flags = 0x1 | 0x2 | 0x4 | 0x1000;
  if (hasMips) flags |= 0x20000;
  flags |= isC ? 0x80000 : 0x8;

  const pitchOrLinear = tex.stride * tex.height;

  out.push(Buffer.from('DDS '));
  out.push(u32(124));                    // dwSize
  out.push(u32(flags));
  out.push(u32(tex.height));             // dwHeight
  out.push(u32(tex.width));              // dwWidth
  out.push(u32(pitchOrLinear));          // dwPitchOrLinearSize
  out.push(u32(tex.depth));
  out.push(u32(tex.levels));             // dwMipMapCount
  out.push(Buffer.alloc(44));            // dwReserved1[11]

  // DDS_PIXELFORMAT (32 bytes)
  out.push(pixelFormat(fmt));

  let caps = 0x1000;
  if (hasMips) caps |= 0x8 | 0x400000;
  out.push(u32(caps));
  out.push(Buffer.alloc(16));

  if (fmt === FMT.BC7) out.push(Buffer.from([98, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0])); // DX10

  out.push(tex.pixelData);
  return Buffer.concat(out);
}

function pixelFormat(fmt) {
  const b = [];
  b.push(u32(32)); // dwSize
  switch (fmt) {
    case FMT.DXT1:
    case FMT.DXT3:
    case FMT.DXT5:
    case FMT.ATI1:
    case FMT.ATI2:
      b.push(u32(0x4));              // DDPF_FOURCC
      b.push(u32(fmt));              // FourCC
      b.push(Buffer.alloc(20));
      break;
    case FMT.BC7:
      b.push(u32(0x4));
      b.push(Buffer.from('DX10'));
      b.push(Buffer.alloc(20));
      break;
    case FMT.A8R8G8B8:
      b.push(u32(0x1 | 0x40));
      b.push(u32(0));
      b.push(u32(32));
      b.push(u32(0x00ff0000));
      b.push(u32(0x0000ff00));
      b.push(u32(0x000000ff));
      b.push(u32(0xff000000));
      break;
    case FMT.X8R8G8B8:
      b.push(u32(0x40));
      b.push(u32(0));
      b.push(u32(32));
      b.push(u32(0x00ff0000));
      b.push(u32(0x0000ff00));
      b.push(u32(0x000000ff));
      b.push(u32(0));
      break;
    case FMT.A8B8G8R8:
      b.push(u32(0x1 | 0x40));
      b.push(u32(0));
      b.push(u32(32));
      b.push(u32(0x000000ff));
      b.push(u32(0x0000ff00));
      b.push(u32(0x00ff0000));
      b.push(u32(0xff000000));
      break;
    case FMT.A1R5G5B5:
      b.push(u32(0x1 | 0x40));
      b.push(u32(0));
      b.push(u32(16));
      b.push(u32(0x7c00));
      b.push(u32(0x03e0));
      b.push(u32(0x001f));
      b.push(u32(0x8000));
      break;
    case FMT.A8: {
      b.push(u32(0x2));
      b.push(u32(0));
      b.push(u32(8));
      b.push(Buffer.alloc(16));
      b[b.length - 1].writeUInt32LE(0xff, 12);
      break;
    }
    case FMT.L8:
      b.push(u32(0x20000));
      b.push(u32(0));
      b.push(u32(8));
      b.push(u32(0xff));
      b.push(Buffer.alloc(12));
      break;
    default:
      b.push(Buffer.alloc(28));
  }
  return Buffer.concat(b);
}

function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0);
  return b;
}

// ---- Writer YTD -----------------------------------------------------------

/**
 * Reempaqueta texturas en un archivo .ytd standalone válido (RSC7 v12).
 * Las texturas deben tener width/height/stride/formato ya actualizados
 * y pixelData con SOLO el nivel 0 (mips ya eliminados).
 */
function buildYtd(textures, opts) {
  const version = (opts && opts.version) || VERSION;
  const fileVft = (opts && opts.fileVft) || DEFAULT_FILE_VFT;
  const dictHeader = (opts && opts.dictHeader) || [0, 0, 1, 0];
  const texturesList = textures.filter((t) => t.pixelData && t.pixelData.length > 0);
  const n = texturesList.length;

  // --- Sección de sistema (offsets reales calculados secuencialmente)
  const texStructSize = 0x90;
  const structBase = 64; // 0x00-0x0F ResourceFileBase + 0x10-0x1F reservados

  // nombres primero (necesarios para sus offsets)
  const nameBufs = texturesList.map((t) => Buffer.from(t.name + '\0', 'utf8'));
  let off = structBase + n * texStructSize;
  const nameOffsets = [];
  for (let i = 0; i < n; i++) {
    nameOffsets.push(off);
    off += nameBufs[i].length;
  }

  off = align16(off);
  const hashOff = off;
  off += Math.max(n * 4, 16);

  off = align16(off);
  const ptrOff = off;
  off += Math.max(n * 8, 16);

  let system = Buffer.alloc(off);

  // ResourceFileBase + campos reservados del TextureDictionary
  system.writeUInt32LE(fileVft >>> 0, 0x00);
  system.writeUInt32LE(1, 0x04); // FileUnknown
  // 0x08: FilePagesInfoPointer -> se rellena al calcular pagesInfoOff
  for (let i = 0; i < 4; i++) system.writeUInt32LE((dictHeader[i] || 0) >>> 0, 0x10 + i * 4);

  // listas ResourceSimpleList64 (count/capacity u16)
  system.writeBigUInt64LE(BigInt(SYS_BASE + hashOff), 0x20);
  system.writeUInt16LE(n, 0x28);
  system.writeUInt16LE(n, 0x2a);
  system.writeBigUInt64LE(BigInt(SYS_BASE + ptrOff), 0x30);
  system.writeUInt16LE(n, 0x38);
  system.writeUInt16LE(n, 0x3a);

  // structs de textura
  for (let i = 0; i < n; i++) {
    const t = texturesList[i];
    const b = structBase + i * texStructSize;
    system.writeBigUInt64LE(BigInt(SYS_BASE + nameOffsets[i]), b + 0x28); // namePtr
    system.writeUInt16LE(t.width, b + 0x50);
    system.writeUInt16LE(t.height, b + 0x52);
    system.writeUInt16LE(t.depth || 0, b + 0x54);
    system.writeUInt16LE(t.stride, b + 0x56);
    system.writeUInt32LE(t.format >>> 0, b + 0x58);
    system[b + 0x5d] = t.levels || 1; // niveles (1 = solo nivel base, mips eliminados)
    // dataPtr se rellena al final con los offsets de gráficos
  }

  // nombres
  for (let i = 0; i < n; i++) nameBufs[i].copy(system, nameOffsets[i]);

  // hashes
  for (let i = 0; i < n; i++) {
    system.writeUInt32LE(texturesList[i].nameHash >>> 0, hashOff + i * 4);
  }

  // punteros a los structs de textura
  for (let i = 0; i < n; i++) {
    system.writeBigUInt64LE(BigInt(SYS_BASE + structBase + i * texStructSize), ptrOff + i * 8);
  }

  // --- Sección de gráficos: pixel data alineada a 16, offsets acumulados
  let gfx = 0;
  const gfxOffsets = [];
  for (let i = 0; i < n; i++) {
    gfx = align16(gfx);
    gfxOffsets.push(gfx);
    gfx += texturesList[i].pixelData.length;
  }
  const graphics = Buffer.alloc(Math.max(gfx, 1));
  for (let i = 0; i < n; i++) {
    texturesList[i].pixelData.copy(graphics, gfxOffsets[i]);
    system.writeBigUInt64LE(BigInt(GFX_BASE + gfxOffsets[i]), structBase + i * texStructSize + 0x70);
  }

  // --- ResourcePagesInfo al final de system (en el padding del alloc, como CodeWalker)
  // Los flags se derivan del CONTENIDO; el pages info cabe en el slack del alloc.
  let sysFlags, sysAlloc, spc;
  let contentLen = system.length;
  for (let i = 0; i < 10; i++) {
    sysFlags = flagsFromSize(contentLen, (version >> 4) & 0xf);
    sysAlloc = resourceSizeFromFlags(sysFlags);
    spc = pageCountFromFlags(sysFlags);
    const need = align16(contentLen) + 16 + 8 * spc;
    if (need <= sysAlloc) break;
    contentLen = need;
  }
  if (contentLen > system.length) {
    const grown = Buffer.alloc(contentLen, 0);
    system.copy(grown, 0);
    system = grown;
  }
  const pagesInfoOff = align16(system.length);
  const pagesInfoLen = 16 + 8 * spc;
  if (pagesInfoOff + pagesInfoLen > system.length) {
    const grown = Buffer.alloc(pagesInfoOff + pagesInfoLen, 0);
    system.copy(grown, 0);
    system = grown;
  }
  system.writeBigUInt64LE(BigInt(SYS_BASE + pagesInfoOff), 0x08);
  system.writeUInt32LE(0, pagesInfoOff);           // Unknown_0h
  system.writeUInt32LE(0, pagesInfoOff + 0x04);    // Unknown_4h
  system[pagesInfoOff + 0x08] = spc & 0xff;        // SystemPagesCount
  system[pagesInfoOff + 0x09] = 0;                 // GraphicsPagesCount
  system.writeUInt16LE(0, pagesInfoOff + 0x0a);    // Unknown_Ah
  system.writeUInt32LE(0, pagesInfoOff + 0x0c);    // Unknown_Ch

  // --- Flags y cabecera (preserva version original)
  const gfxFlags = flagsFromSize(graphics.length, version & 0xf);
  const gfxAlloc = resourceSizeFromFlags(gfxFlags);

  const sysPadded = Buffer.alloc(Math.max(sysAlloc, system.length));
  system.copy(sysPadded, 0);
  const gfxPadded = Buffer.alloc(Math.max(gfxAlloc, graphics.length));
  graphics.copy(gfxPadded, 0);

  const body = Buffer.concat([sysPadded, gfxPadded]);
  const compressed = zlib.deflateRawSync(body, { level: 6 });

  const header = Buffer.alloc(16);
  header.writeUInt32LE(RSC7_MAGIC, 0);
  header.writeUInt32LE(version >>> 0, 4);
  header.writeUInt32LE(sysFlags, 8);
  header.writeUInt32LE(gfxFlags, 12);

  return Buffer.concat([header, compressed]);
}

function align16(v) {
  return (v + 15) & ~15;
}

// ---- Utilidades de análisis de mips ---------------------------------------

/** Tamaño de píxel del nivel base (nivel 0). */
function level0Size(stride, height) {
  return stride * height;
}

/** Si solo nos quedamos con el nivel 0, cuánto ahorramos (bytes). */
function mipSavings(tex) {
  if (tex.levels <= 1) return 0;
  return tex.pixelSize - level0Size(tex.stride, tex.height);
}

module.exports = {
  FMT,
  fmtName,
  isBlockCompressed,
  bytesPerPixel,
  resourceSizeFromFlags,
  flagsFromSize,
  parseYtd,
  toDds,
  buildYtd,
  level0Size,
  mipSavings,
  makeReader,
  parseTextureDict,
};
});

// ============================================================
// Módulo: ./dxt
// ============================================================
_def('./dxt', function (module, exports, require, __dirname, __filename) {
'use strict';

/* ============================================================
   NOVA OPTIMIZER — Códecs DXT1/DXT3/DXT5 + resize RGBA
   (decode a RGBA, reescalar, re-encode) — JS puro
   ============================================================ */

// ---- Utilidades de color ----------------------------------------------

function rgb565ToRgb(v) {
  return [
    ((v >> 11) & 0x1f) << 3,
    ((v >> 5) & 0x3f) << 2,
    (v & 0x1f) << 3,
  ];
}

function rgbToRgb565(r, g, b) {
  return (((r >> 3) & 0x1f) << 11) | (((g >> 2) & 0x3f) << 5) | ((b >> 3) & 0x1f);
}

// ---- Decoders ----------------------------------------------------------

// Devuelve un Buffer RGBA (4 bytes/píxel) dado pixel data DXT1 y dimensiones.
function decodeDxt1(data, w, h) {
  const out = Buffer.alloc(w * h * 4);
  const bw = Math.max(1, Math.ceil(w / 4));
  const bh = Math.max(1, Math.ceil(h / 4));
  let src = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const c0 = data.readUInt16LE(src);
      const c1 = data.readUInt16LE(src + 2);
      src += 4;
      const cols = dxt1Colors(c0, c1);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const idx = ((data[src + y] >> (x * 2)) & 3);
          const px = (bx * 4 + x) * 4;
          const py = (by * 4 + y) * 4;
          if (px < w * 4 && py < h * 4) {
            const c = cols[idx];
            out.writeUInt8(c[0], py * w + px);
            out.writeUInt8(c[1], py * w + px + 1);
            out.writeUInt8(c[2], py * w + px + 2);
            out.writeUInt8(c[3], py * w + px + 3);
          }
        }
      }
      src += 4;
    }
  }
  return out;
}

function dxt1Colors(c0, c1) {
  const c = [rgb565ToRgb(c0), rgb565ToRgb(c1)];
  if (c0 > c1) {
    return [
      [...c[0], 255],
      [...c[1], 255],
      [((c[0][0] * 2 + c[1][0]) / 3) | 0, ((c[0][1] * 2 + c[1][1]) / 3) | 0, ((c[0][2] * 2 + c[1][2]) / 3) | 0, 255],
      [((c[0][0] + c[1][0] * 2) / 3) | 0, ((c[0][1] + c[1][1] * 2) / 3) | 0, ((c[0][2] + c[1][2] * 2) / 3) | 0, 255],
    ];
  }
  return [
    [...c[0], 255],
    [...c[1], 255],
    [((c[0][0] + c[1][0]) / 2) | 0, ((c[0][1] + c[1][1]) / 2) | 0, ((c[0][2] + c[1][2]) / 2) | 0, 255],
    [0, 0, 0, 0],
  ];
}

// Devuelve alpha de 4 bits por texel (DXT3) o 8 bits (DXT5, ya expandida).
function decodeDxt3Alpha(data, w, h, srcOffset) {
  const out = Buffer.alloc(w * h);
  const bw = Math.max(1, Math.ceil(w / 4));
  const bh = Math.max(1, Math.ceil(h / 4));
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const px = bx * 4 + x;
          const py = by * 4 + y;
          if (px < w && py < h) {
            const byte = data[srcOffset + (by * bw + bx) * 16 + y * 2 + (x >> 1)];
            const nib = (byte >> (x % 2 === 0 ? 0 : 4)) & 0xf;
            out[py * w + px] = (nib << 4) | nib;
          }
        }
      }
    }
  }
  return out;
}

function decodeDxt5Alpha(data, w, h, srcOffset) {
  const out = Buffer.alloc(w * h);
  const bw = Math.max(1, Math.ceil(w / 4));
  const bh = Math.max(1, Math.ceil(h / 4));
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const b = srcOffset + (by * bw + bx) * 16;
      const a0 = data[b];
      const a1 = data[b + 1];
      const bits = [
        data[b + 2],
        data[b + 3],
        data[b + 4],
        data[b + 5],
        data[b + 6],
        data[b + 7],
      ];
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const px = bx * 4 + x;
          const py = by * 4 + y;
          if (px < w && py < h) {
            const i = y * 4 + x;
            const bitPos = i * 3;
            const byte = bitPos >> 3;
            const code = ((bits[byte] >> (bitPos & 7)) | (bits[byte + 1] << (8 - (bitPos & 7)))) & 7;
            out[py * w + px] = code === 0 ? a0 : code === 1 ? a1 : a0 > a1
              ? ((((8 - code) * a0 + (code - 1) * a1) / 7) | 0)
              : code < 6 ? ((((6 - code) * a0 + (code - 1) * a1) / 5) | 0) : code === 6 ? 0 : 255;
          }
        }
      }
    }
  }
  return out;
}

function decodeDxt3(data, w, h) {
  const rgb = decodeDxt1ColorOnly(data, w, h, 8, 16);
  const alpha = decodeDxt3Alpha(data, w, h, 0);
  for (let i = 0; i < w * h; i++) rgb[i * 4 + 3] = alpha[i];
  return rgb;
}

function decodeDxt5(data, w, h) {
  const rgb = decodeDxt1ColorOnly(data, w, h, 8, 16);
  const alpha = decodeDxt5Alpha(data, w, h, 0);
  for (let i = 0; i < w * h; i++) rgb[i * 4 + 3] = alpha[i];
  return rgb;
}

// La parte de color de DXT3/DXT5 es igual que DXT1 pero siempre modo 4 colores.
// colorAt = 0 para DXT1, 8 para DXT3/5; blockStride = 8 o 16.
function decodeDxt1ColorOnly(data, w, h, colorAt, blockStride) {
  const out = Buffer.alloc(w * h * 4);
  const bw = Math.max(1, Math.ceil(w / 4));
  const bh = Math.max(1, Math.ceil(h / 4));
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const base = (by * bw + bx) * blockStride + colorAt;
      const c0 = data.readUInt16LE(base);
      const c1 = data.readUInt16LE(base + 2);
      const c = [rgb565ToRgb(c0), rgb565ToRgb(c1)];
      const cols = [
        [...c[0], 255],
        [...c[1], 255],
        [((c[0][0] * 2 + c[1][0]) / 3) | 0, ((c[0][1] * 2 + c[1][1]) / 3) | 0, ((c[0][2] * 2 + c[1][2]) / 3) | 0, 255],
        [((c[0][0] + c[1][0] * 2) / 3) | 0, ((c[0][1] + c[1][1] * 2) / 3) | 0, ((c[0][2] + c[1][2] * 2) / 3) | 0, 255],
      ];
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const idx = ((data[base + 4 + y] >> (x * 2)) & 3);
          const px = (bx * 4 + x) * 4;
          const py = by * 4 + y;
          if (px < w * 4 && py < h) {
            out.writeUInt8(cols[idx][0], py * w + px);
            out.writeUInt8(cols[idx][1], py * w + px + 1);
            out.writeUInt8(cols[idx][2], py * w + px + 2);
            out.writeUInt8(cols[idx][3], py * w + px + 3);
          }
        }
      }
    }
  }
  return out;
}

// ---- Encoders (calidad media, suficiente para el comparador) ------------

// DXT1 desde RGBA. Si la textura tiene alpha < 255 en algún píxel, usa modo
// transparente (3 colores). Devuelve { data, hasAlpha }.
function encodeDxt1(rgba, w, h) {
  const bw = Math.max(1, Math.ceil(w / 4));
  const bh = Math.max(1, Math.ceil(h / 4));
  const out = Buffer.alloc(bw * bh * 8);
  let transparent = false;

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const px = [];
      const pi = [];
      let anyTrans = false;
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const gx = bx * 4 + x;
          const gy = by * 4 + y;
          if (gx < w && gy < h) {
            const i = (gy * w + gx) * 4;
            const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
            pi.push([r, g, b, a]);
            if (a < 128) anyTrans = true;
          } else {
            pi.push([0, 0, 0, 0]);
            anyTrans = true;
          }
        }
      }
      if (anyTrans) transparent = true;

      // extremos del bounding box en RGB
      let mn = [255, 255, 255], mx = [0, 0, 0];
      for (const c of pi) {
        if (c[3] < 128) continue;
        for (let k = 0; k < 3; k++) {
          if (c[k] < mn[k]) mn[k] = c[k];
          if (c[k] > mx[k]) mx[k] = c[k];
        }
      }
      let c0, c1;
      const lum = (c) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
      if (lum(mn) > lum(mx)) { c0 = mx; c1 = mn; } else { c0 = mn; c1 = mx; }

      const e0 = rgbToRgb565(c0[0], c0[1], c0[2]);
      const e1 = rgbToRgb565(c1[0], c1[1], c1[2]);

      const base = (by * bw + bx) * 8;
      let cols;
      if (anyTrans) {
        // 3-colores: c0 <= c1 activa el modo transparente (index 3)
        const small = e0 <= e1 ? e0 : e1;
        const big = e0 <= e1 ? e1 : e0;
        out.writeUInt16LE(small, base);
        out.writeUInt16LE(big, base + 2);
        cols = [
          [c0[0], c0[1], c0[2]],
          [c1[0], c1[1], c1[2]],
          [((c0[0] + c1[0]) / 2) | 0, ((c0[1] + c1[1]) / 2) | 0, ((c0[2] + c1[2]) / 2) | 0],
          [0, 0, 0],
        ];
      } else {
        // 4-colores: c0 > c1 obligatorio (si no, el decoder entra en 3-colores)
        const small = e0 <= e1 ? e0 : e1;
        const big = e0 <= e1 ? e1 : e0;
        out.writeUInt16LE(big, base);
        out.writeUInt16LE(small, base + 2);
        cols = [
          [c0[0], c0[1], c0[2]],
          [c1[0], c1[1], c1[2]],
          [((c0[0] * 2 + c1[0]) / 3) | 0, ((c0[1] * 2 + c1[1]) / 3) | 0, ((c0[2] * 2 + c1[2]) / 3) | 0],
          [((c0[0] + c1[0] * 2) / 3) | 0, ((c0[1] + c1[1] * 2) / 3) | 0, ((c0[2] + c1[2] * 2) / 3) | 0],
        ];
      }

      let idxBits = 0n;
      for (let k = 0; k < 16; k++) {
        const c = pi[k];
        let best = 0, bd = Infinity;
        for (let ci = 0; ci < 4; ci++) {
          if (c[3] < 128) { best = 3; bd = 0; break; }
          const d = (c[0] - cols[ci][0]) ** 2 + (c[1] - cols[ci][1]) ** 2 + (c[2] - cols[ci][2]) ** 2;
          if (d < bd) { bd = d; best = ci; }
        }
        idxBits |= BigInt(best) << BigInt(k * 2);
      }
      for (let k = 0; k < 4; k++) {
        out[base + 4 + k] = Number((idxBits >> BigInt(k * 8)) & 0xffn);
      }
    }
  }
  return { data: out, hasAlpha: transparent };
}

// DXT5 desde RGBA (alpha de 8 bits). Devuelve Buffer.
function encodeDxt5(rgba, w, h) {
  const bw = Math.max(1, Math.ceil(w / 4));
  const bh = Math.max(1, Math.ceil(h / 4));
  const out = Buffer.alloc(bw * bh * 16);

  // Parte alpha: a0=255, a1=0 (rango completo), índices de 3 bits.
  const a0 = 255, a1 = 0;
  const aCols = [];
  for (let i = 0; i < 8; i++) {
    aCols.push(i === 0 ? a0 : i === 1 ? a1 : (((8 - i) * a0 + (i - 1) * a1) / 7) | 0);
  }

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const pi = [];
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const gx = bx * 4 + x;
          const gy = by * 4 + y;
          if (gx < w && gy < h) {
            const i = (gy * w + gx) * 4;
            pi.push([rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]);
          } else {
            pi.push([0, 0, 0, 0]);
          }
        }
      }

      // alpha indices de 3 bits (48 bits = 6 bytes)
      let aBits = 0n;
      for (let k = 0; k < 16; k++) {
        let best = 0, bd = Infinity;
        for (let ci = 0; ci < 8; ci++) {
          const d = Math.abs(pi[k][3] - aCols[ci]);
          if (d < bd) { bd = d; best = ci; }
        }
        aBits |= BigInt(best) << BigInt(k * 3);
      }
      const aBase = (by * bw + bx) * 16;
      out[aBase] = a0;
      out[aBase + 1] = a1;
      for (let k = 0; k < 6; k++) {
        out[aBase + 2 + k] = Number((aBits >> BigInt(k * 8)) & 0xffn);
      }

      // Parte de color: bounding box + interpolación 4 colores
      let mn = [255, 255, 255], mx = [0, 0, 0];
      for (const c of pi) {
        for (let k = 0; k < 3; k++) {
          if (c[k] < mn[k]) mn[k] = c[k];
          if (c[k] > mx[k]) mx[k] = c[k];
        }
      }
      const lum = (c) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
      let c0 = mn, c1 = mx;
      if (lum(mn) > lum(mx)) { c0 = mx; c1 = mn; }
      const e0 = rgbToRgb565(c0[0], c0[1], c0[2]);
      const e1 = rgbToRgb565(c1[0], c1[1], c1[2]);
      out.writeUInt16LE(e0, aBase + 8);
      out.writeUInt16LE(e1, aBase + 10);
      const cols = [
        [c0[0], c0[1], c0[2]],
        [c1[0], c1[1], c1[2]],
        [((c0[0] * 2 + c1[0]) / 3) | 0, ((c0[1] * 2 + c1[1]) / 3) | 0, ((c0[2] * 2 + c1[2]) / 3) | 0],
        [((c0[0] + c1[0] * 2) / 3) | 0, ((c0[1] + c1[1] * 2) / 3) | 0, ((c0[2] + c1[2] * 2) / 3) | 0],
      ];
      let idxBits = 0n;
      for (let k = 0; k < 16; k++) {
        let best = 0, bd = Infinity;
        for (let ci = 0; ci < 4; ci++) {
          const d = (pi[k][0] - cols[ci][0]) ** 2 + (pi[k][1] - cols[ci][1]) ** 2 + (pi[k][2] - cols[ci][2]) ** 2;
          if (d < bd) { bd = d; best = ci; }
        }
        idxBits |= BigInt(best) << BigInt(k * 2);
      }
      for (let k = 0; k < 4; k++) {
        out[aBase + 12 + k] = Number((idxBits >> BigInt(k * 8)) & 0xffn);
      }
    }
  }
  return out;
}

// ---- Resize (bilineal) --------------------------------------------------

function resizeRgba(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const xr = sw / dw;
  const yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sw - 1, 0) + y * yr;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    const y1 = Math.min(sh - 1, y0 + 1);
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(0, 0) + x * xr;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const x1 = Math.min(sw - 1, x0 + 1);
      const i00 = (y0 * sw + x0) * 4;
      const i01 = (y0 * sw + x1) * 4;
      const i10 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const v =
          src[i00 + c] * (1 - fx) * (1 - fy) +
          src[i01 + c] * fx * (1 - fy) +
          src[i10 + c] * (1 - fx) * fy +
          src[i11 + c] * fx * fy;
        out[o + c] = Math.round(v);
      }
    }
  }
  return out;
}

// ---- Preview rápido (promedio por bloque 4x4) ----------------------------

/**
 * Convierte pixel data DXT1/3/5 a un RGBA de (w/4)x(h/4) colapsando cada
 * bloque 4x4 a su color/alpha medio. ~16x más rápido que decode+resize,
 * suficiente para el comparador visual.
 * Returns Buffer RGBA o null si format no es DXT.
 */
function blockAvgRgba(data, w, h, format) {
  const bw = w >> 2;
  const bh = h >> 2;
  if (bw < 1 || bh < 1) return null;
  const out = Buffer.alloc(bw * bh * 4);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const bi = by * bw + bx;
      let r, g, b, a;
      if (format === 0x31545844) {
        const o = bi * 8;
        const e0 = rgb565ToRgb(data.readUInt16LE(o));
        const e1 = rgb565ToRgb(data.readUInt16LE(o + 2));
        r = (e0[0] + e1[0]) >> 1;
        g = (e0[1] + e1[1]) >> 1;
        b = (e0[2] + e1[2]) >> 1;
        a = 255;
      } else if (format === 0x33545844) {
        const o = bi * 16;
        let asum = 0;
        for (let j = 0; j < 16; j++) {
          const nb = data[o + (j >> 1)];
          asum += j & 1 ? nb >> 4 : nb & 0xf;
        }
        a = (asum * 17) >> 4;
        const e0 = rgb565ToRgb(data.readUInt16LE(o + 8));
        const e1 = rgb565ToRgb(data.readUInt16LE(o + 10));
        r = (e0[0] + e1[0]) >> 1;
        g = (e0[1] + e1[1]) >> 1;
        b = (e0[2] + e1[2]) >> 1;
      } else if (format === 0x35545844) {
        const o = bi * 16;
        a = (data[o] + data[o + 1]) >> 1;
        const e0 = rgb565ToRgb(data.readUInt16LE(o + 8));
        const e1 = rgb565ToRgb(data.readUInt16LE(o + 10));
        r = (e0[0] + e1[0]) >> 1;
        g = (e0[1] + e1[1]) >> 1;
        b = (e0[2] + e1[2]) >> 1;
      } else {
        return null;
      }
      const d = bi * 4;
      out[d] = r;
      out[d + 1] = g;
      out[d + 2] = b;
      out[d + 3] = a;
    }
  }
  return out;
}

module.exports = {
  decodeDxt1,
  decodeDxt3,
  decodeDxt5,
  encodeDxt1,
  encodeDxt5,
  resizeRgba,
  blockAvgRgba,
};
});

// ============================================================
// Módulo: ./ytdOptimizer
// ============================================================
_def('./ytdOptimizer', function (module, exports, require, __dirname, __filename) {
'use strict';

/* ============================================================
   NOVA OPTIMIZER — Optimización de .ytd (texturas GTA V/FiveM)
   Antes/después: quitar mips (lossless) + reescalado (lossy)
   + previews RGBA (decoded + downscaled) para el comparador web
   ============================================================ */

const ytd = require('./ytd');
const dxt = require('./dxt');

const REENCODABLE = new Set([
  ytd.FMT.DXT1,
  ytd.FMT.DXT3,
  ytd.FMT.DXT5,
  ytd.FMT.A8R8G8B8,
  ytd.FMT.A8B8G8R8,
  ytd.FMT.X8R8G8B8,
]);

// Formatos con preview visual disponible (decodificables)
const PREVIEWABLE = new Set([
  ytd.FMT.DXT1,
  ytd.FMT.DXT3,
  ytd.FMT.DXT5,
  ytd.FMT.A8R8G8B8,
  ytd.FMT.A8B8G8R8,
  ytd.FMT.X8R8G8B8,
  ytd.FMT.A8,
  ytd.FMT.L8,
]);

/** Convierte una textura (pixelData del nivel 0) a RGBA. null si no es decodificable. */
function textureToRgba(tex) {
  const fmt = tex.format;
  if (fmt === ytd.FMT.DXT1) return dxt.decodeDxt1(tex.pixelData, tex.width, tex.height);
  if (fmt === ytd.FMT.DXT3) return dxt.decodeDxt3(tex.pixelData, tex.width, tex.height);
  if (fmt === ytd.FMT.DXT5) return dxt.decodeDxt5(tex.pixelData, tex.width, tex.height);

  const bpp = ytd.bytesPerPixel(fmt);
  if (!bpp) return null;
  const rgba = Buffer.alloc(tex.width * tex.height * 4);
  const data = tex.pixelData;
  for (let i = 0; i < tex.width * tex.height; i++) {
    const s = i * bpp;
    const d = i * 4;
    if (fmt === ytd.FMT.A8B8G8R8) {
      rgba[d] = data[s + 3];
      rgba[d + 1] = data[s + 2];
      rgba[d + 2] = data[s + 1];
      rgba[d + 3] = data[s];
    } else if (fmt === ytd.FMT.A8) {
      rgba[d] = data[s]; rgba[d + 1] = data[s]; rgba[d + 2] = data[s]; rgba[d + 3] = data[s];
    } else if (fmt === ytd.FMT.L8) {
      rgba[d] = data[s]; rgba[d + 1] = data[s]; rgba[d + 2] = data[s]; rgba[d + 3] = 255;
    } else {
      rgba[d + 2] = data[s];
      rgba[d + 1] = data[s + 1];
      rgba[d] = data[s + 2];
      rgba[d + 3] = bpp === 4 ? data[s + 3] : 255;
    }
  }
  return rgba;
}

/** Preview RGBA downscaled a maxDim px (base64 del buffer). null si no hay preview. */
function makePreview(tex, maxDim) {
  if (!PREVIEWABLE.has(tex.format) || !tex.pixelData || tex.pixelData.length === 0) return null;
  let rgba;
  let w = tex.width;
  let h = tex.height;

  if (tex.format === ytd.FMT.DXT1 || tex.format === ytd.FMT.DXT3 || tex.format === ytd.FMT.DXT5) {
    // Preview por promedio de bloque (w/4)x(h/4): ~16x más rápido
    const avg = dxt.blockAvgRgba(tex.pixelData, tex.width, tex.height, tex.format);
    if (avg) {
      w = tex.width >> 2;
      h = tex.height >> 2;
      if (w >= 1 && h >= 1) rgba = avg;
    }
    if (!rgba) rgba = textureToRgba(tex); // fallback (dimensiones pequeñas)
  } else {
    rgba = textureToRgba(tex);
  }

  const m = Math.max(w, h);
  if (m > maxDim) {
    const f = maxDim / m;
    const dw = Math.max(1, Math.round(w * f));
    const dh = Math.max(1, Math.round(h * f));
    if (dw !== w || dh !== h) {
      rgba = dxt.resizeRgba(rgba, w, h, dw, dh);
      w = dw;
      h = dh;
    }
  }
  return { w, h, rgba: rgba.toString('base64') };
}

function optimizeYtd(fileBuffer, opts) {
  const quality = opts && opts.quality !== undefined ? opts.quality : 100; // 1-100
  const stripMips = opts && opts.stripMips !== undefined ? opts.stripMips : true;
  const previewMax = opts && opts.previewMax ? opts.previewMax : 256;

  const parsed = ytd.parseYtd(fileBuffer);

  const originalBytes = parsed.decompressedSize || parsed.fileSize;
  const beforeTextures = parsed.textures.map((t) => ({
    name: t.name,
    formatName: t.formatName,
    width: t.width,
    height: t.height,
    pixelSize: t.pixelSize,
    fileSize: t.pixelSize,
  }));

  const results = [];
  const newTextures = [];

  for (const t of parsed.textures) {
    let pixelData = t.pixelData;
    let width = t.width;
    let height = t.height;
    let stride = t.stride;
    let levels = t.levels;
    let format = t.format;
    let method = 'sin cambios';

    // 1) Reescalado (lossy) si quality < 100 y el formato es re-encodable
    if (quality < 100 && REENCODABLE.has(t.format) && t.pixelSize > 0) {
      const rgba = textureToRgba(t);

      const factor = quality / 100;
      let nw = Math.max(4, Math.round(t.width * factor));
      let nh = Math.max(4, Math.round(t.height * factor));
      if (t.format === ytd.FMT.DXT1 || t.format === ytd.FMT.DXT3 || t.format === ytd.FMT.DXT5) {
        nw = nw & ~3;
        nh = nh & ~3;
      }
      if (nw !== t.width || nh !== t.height) {
        const resized = dxt.resizeRgba(rgba, t.width, t.height, nw, nh);
        width = nw;
        height = nh;

        if (t.format === ytd.FMT.DXT1) {
          const enc = dxt.encodeDxt1(resized, width, height);
          pixelData = enc.data;
          stride = width * 0.5;
        } else if (t.format === ytd.FMT.DXT3 || t.format === ytd.FMT.DXT5) {
          // DXT3 y DXT5 -> re-encode como DXT5 (preserva alpha 8 bits);
          // hay que cambiar el formato, si no el juego leería DXT3 (alpha 4 bits)
          pixelData = dxt.encodeDxt5(resized, width, height);
          stride = width;
          format = ytd.FMT.DXT5;
        } else {
          // RGBA
          const bpp = ytd.bytesPerPixel(t.format);
          pixelData = Buffer.alloc(width * height * bpp);
          for (let i = 0; i < width * height; i++) {
            const src = i * 4;
            const dst = i * bpp;
            if (t.format === ytd.FMT.A8B8G8R8) {
              pixelData[dst] = resized[src + 3];
              pixelData[dst + 1] = resized[src + 2];
              pixelData[dst + 2] = resized[src + 1];
              pixelData[dst + 3] = resized[src];
            } else {
              pixelData[dst + 2] = resized[src];
              pixelData[dst + 1] = resized[src + 1];
              pixelData[dst] = resized[src + 2];
              if (bpp === 4) pixelData[dst + 3] = resized[src + 3];
            }
          }
          stride = width * bpp;
        }
        levels = 1;
        method = 'reducida ' + t.width + 'x' + t.height + ' -> ' + width + 'x' + height;
      }
    }

    // 2) Quitar mips (lossless en nivel 0)
    if (stripMips && levels > 1) {
      const lvl0 = ytd.level0Size(stride, t.height);
      if (lvl0 > 0 && lvl0 <= pixelData.length) {
        pixelData = pixelData.subarray(0, lvl0);
        levels = 1;
        method = method === 'sin cambios' ? 'mips eliminados' : method + ' + mips';
      }
    }

    const newSize = pixelData.length;
    results.push({
      name: t.name,
      formatName: ytd.fmtName(format),
      widthBefore: t.width,
      heightBefore: t.height,
      widthAfter: width,
      heightAfter: height,
      bytesBefore: t.pixelSize,
      bytesAfter: newSize,
      saved: t.pixelSize - newSize,
      pct: t.pixelSize > 0 ? ((1 - newSize / t.pixelSize) * 100).toFixed(1) : 0,
      method,
    });

    newTextures.push({
      name: t.name,
      nameHash: t.nameHash,
      width,
      height,
      depth: t.depth,
      stride,
      format,
      levels,
      pixelData,
    });
  }

  const newYtd = ytd.buildYtd(newTextures, {
    version: parsed.version,
    fileVft: parsed.fileVft,
    dictHeader: parsed.dictHeader,
  });

  const beforeTotal = parsed.fileSize;
  const afterTotal = newYtd.length;
  const savedTotal = beforeTotal - afterTotal;

  return {
    original: {
      fileName: opts && opts.fileName,
      size: beforeTotal,
      decompressedSize: originalBytes,
    },
    optimized: {
      size: afterTotal,
    },
    saved: savedTotal,
    pct: beforeTotal > 0 ? ((savedTotal / beforeTotal) * 100).toFixed(1) : 0,
    textures: results,
    beforeTextures,
    newTextures,
    previews: parsed.textures.map((t, i) => ({
      name: t.name,
      before: makePreview(t, previewMax),
      after: makePreview(newTextures[i], previewMax),
    })),
    file: newYtd,
  };
}

module.exports = { optimizeYtd, REENCODABLE, PREVIEWABLE, textureToRgba };
});

// ============================================================
// Módulo: ./rsc7
// ============================================================
_def('./rsc7', function (module, exports, require, __dirname, __filename) {
'use strict';

/* ============================================================
   NOVA OPTIMIZER — Análisis técnico de archivos RSC7
   (.ytd / .ydd / .yft / .ydr / .ybn / .ymap)
   Cabecera + secciones + intento de extraer TextureDictionary
   ============================================================ */

const zlib = require('zlib');
const ytd = require('./ytd');

const RSC7_MAGIC = 0x37435352;

function decompressBody(body) {
  try {
    const out = zlib.inflateRawSync(body, { maxOutputLength: 512 * 1024 * 1024 });
    if (out.length) return out;
  } catch (e) { /* siguiente */ }
  try {
    const out = zlib.inflateSync(body);
    if (out.length) return out;
  } catch (e) { /* siguiente */ }
  return body;
}

/**
 * Analiza cualquier archivo RSC7. Devuelve:
 *  - cabecera (magic, version, flags, tamaños por sección)
 *  - compressedRatio
 *  - textures: solo si el archivo contiene un TextureDictionary (YTD)
 */
function analyzeRsc7(data) {
  if (!Buffer.isBuffer(data)) data = Buffer.from(data);
  if (data.length < 16 || data.readUInt32LE(0) !== RSC7_MAGIC) {
    throw new Error('No es un archivo RSC7 válido (faltan 16 bytes de cabecera o el magic).');
  }

  const sysFlags = data.readUInt32LE(8);
  const gfxFlags = data.readUInt32LE(12);
  const version = (((sysFlags >> 28) & 0xf) << 4) | ((gfxFlags >> 28) & 0xf);

  const sysSize = ytd.resourceSizeFromFlags(sysFlags);
  const gfxSize = ytd.resourceSizeFromFlags(gfxFlags);

  const decomp = decompressBody(data.subarray(16));
  const isCompressed = decomp.length !== data.length - 16;
  const ratio = isCompressed ? (1 - data.length / decomp.length) * 100 : 0;

  const info = {
    magic: 'RSC7',
    version,
    isCompressed,
    compressedRatio: +ratio.toFixed(1),
    sysFlags: sysFlags >>> 0,
    gfxFlags: gfxFlags >>> 0,
    sysSize,
    gfxSize,
    fileSize: data.length,
    decompressedSize: decomp.length,
    textures: [],
  };

  // Intento de leer TextureDictionary (solo si la sección system es lo bastante grande)
  if (sysSize >= 64) {
    try {
      const system = decomp.subarray(0, sysSize);
      const graphics = decomp.subarray(sysSize, sysSize + Math.min(gfxSize, decomp.length - sysSize));
      const reader = ytd.makeReader(system, graphics);
      info.textures = ytd.parseTextureDict(reader);
    } catch (e) {
      info.textures = [];
    }
  }
  info.hasTextureDict = info.textures.length > 0;

  return info;
}

module.exports = { analyzeRsc7 };
});

// ============================================================
// Módulo: ./zip
// ============================================================
_def('./zip', function (module, exports, require, __dirname, __filename) {
'use strict';

/* ============================================================
   NOVA OPTIMIZER — ZIP reader/writer minimalista (sin deps)
   Lee la estructura clásica: EOCD + Central Directory + entradas
   deflate (método 8) o stored (método 0). Escritura con deflate.
   ============================================================ */

const zlib = require('zlib');

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function readZip(buf) {
  if (buf.length < 22) throw new Error('ZIP demasiado corto.');
  let eocd = buf.length - 22;
  while (eocd > 0 && buf.readUInt32LE(eocd) !== EOCD_SIG) eocd -= 1;
  if (buf.readUInt32LE(eocd) !== EOCD_SIG) throw new Error('ZIP inválido: no se encontró el final del directorio central.');

  const cdCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const entries = [];
  let off = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(off) !== CD_SIG) throw new Error('ZIP corrupto en la entrada ' + i + '.');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const uncompSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compSize, uncompSize, localOffset, crc32: buf.readUInt32LE(off + 16) });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntry(buf, entry) {
  const lh = entry.localOffset;
  if (buf.readUInt32LE(lh) !== LOCAL_SIG) throw new Error('ZIP corrupto: cabecera local de ' + entry.name);
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const data = buf.subarray(lh + 30 + nameLen + extraLen, lh + 30 + nameLen + extraLen + entry.compSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: entry.uncompSize });
  throw new Error('Método de compresión no soportado (' + entry.method + ') en ' + entry.name);
}

/**
 * Crea un ZIP con las entradas dadas.
 * entries: [{ name, data (Buffer), method? ('deflate'|'store') }]
 * Se conserva el nombre tal cual (rutas incluidas).
 */
function writeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    let comp = e.data;
    let method = 0;
    const store = e.store === true || (e.data.length <= 200);
    if (!store) {
      const deflated = zlib.deflateRawSync(e.data, { level: 6 });
      if (deflated.length < e.data.length) {
        comp = deflated;
        method = 8;
      }
    }
    const crc = zlib.crc32(e.data) >>> 0;

    // Cabecera local
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);       // version needed
    local.writeUInt16LE(0x0800, 6);   // flags (UTF-8)
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);       // mod time
    local.writeUInt16LE(0, 12);       // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);       // extra len
    chunks.push(local, nameBuf, comp);

    // Entrada del directorio central
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(CD_SIG, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);   // extra
    cd.writeUInt16LE(0, 32);   // comment
    cd.writeUInt16LE(0, 34);   // disk
    cd.writeUInt16LE(0, 36);   // internal attrs
    cd.writeUInt32LE(0, 38);   // external attrs
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }

  const cdStart = offset;
  const cdBuf = Buffer.concat(central);
  const cdEnd = cdStart + cdBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);

  chunks.push(cdBuf, eocd);
  return Buffer.concat(chunks);
}

module.exports = { readZip, extractEntry, writeZip };
});

// ============================================================
// Módulo: ./zipOptimizer
// ============================================================
_def('./zipOptimizer', function (module, exports, require, __dirname, __filename) {
'use strict';

/* ============================================================
   NOVA OPTIMIZER — Optimización de packs .zip de FiveM
   Optimiza cada .ytd del interior, pasa el resto intacto.
   ============================================================ */

const path = require('path');
const zip = require('./zip');
const { optimizeYtd } = require('./ytdOptimizer');

function optimizeZip(fileBuffer, opts) {
  const quality = opts && opts.quality !== undefined ? opts.quality : 100;
  const stripMips = opts && opts.stripMips !== undefined ? opts.stripMips : true;

  const entries = zip.readZip(fileBuffer);
  const perFile = [];

  const outEntries = entries.map((entry) => {
    if (entry.name.endsWith('/') || entry.name.endsWith('\\')) {
      return { name: entry.name, data: Buffer.alloc(0), store: true };
    }

    const data = zip.extractEntry(fileBuffer, entry);
    const ext = path.extname(entry.name).toLowerCase();

    if (ext === '.ytd') {
      try {
        const before = data.length;
        const r = optimizeYtd(data, { quality, stripMips });
        perFile.push({
          name: entry.name,
          sizeBefore: before,
          sizeAfter: r.optimized.size,
          pct: r.pct,
        });
        return { name: entry.name, data: r.file };
      } catch (e) {
        return { name: entry.name, data };
      }
    }
    return { name: entry.name, data };
  });

  const newZip = zip.writeZip(outEntries);
  const saved = fileBuffer.length - newZip.length;

  return {
    original: { size: fileBuffer.length },
    optimized: { size: newZip.length },
    saved,
    pct: fileBuffer.length > 0 ? ((saved / fileBuffer.length) * 100).toFixed(1) : 0,
    entries: perFile,
    file: newZip,
  };
}

module.exports = { optimizeZip };
});

// ============================================================
// Aplicación principal
// ============================================================
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const db = _modules['./db'];
const auth = _modules['./auth'];
const { optimize, classifyType } = _modules['./optimizer'];
const { optimizeYtd } = _modules['./ytdOptimizer'];
const { parseYtd, fmtName, toDds } = _modules['./ytd'];
const { analyzeRsc7 } = _modules['./rsc7'];
const { optimizeZip } = _modules['./zipOptimizer'];

const PORT = Number(process.env.PORT || 3000);
const MAX_MB = Number(process.env.MAX_FILE_MB || 25);
const BASE_URL = (process.env.OAUTH_BASE_URL || 'http://localhost:' + PORT).replace(/\/$/, '');
const COOKIE_SECURE = BASE_URL.startsWith('https://');

const app = express();

// -------------------------------------------------------------
// Middlewares
// -------------------------------------------------------------
app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

// -------------------------------------------------------------
// Autenticación Google OAuth
// -------------------------------------------------------------

// GET /auth/google - redirige al consentimiento de Google
app.get('/auth/google', (req, res) => {
  if (!auth.isConfigured()) {
    return res.status(500).send('Google OAuth no configurado. Agrega GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en .env');
  }
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', auth.serializeCookie('nova_oauth_state', state, 600, COOKIE_SECURE));
  res.redirect(auth.authUrl(BASE_URL, state));
});

// GET /auth/google/callback - intercambia el código y crea la sesión
app.get('/auth/google/callback', async (req, res) => {
  try {
    if (!auth.isConfigured()) {
      return res.status(500).send('Google OAuth no configurado.');
    }
    const cookies = auth.parseCookies(req);
    if (!req.query.code || req.query.state !== cookies.nova_oauth_state) {
      return res.status(403).send('Estado de autenticación inválido.');
    }

    const user = await auth.exchangeCode(BASE_URL, req.query.code);
    const token = auth.createSession(user);
    res.setHeader('Set-Cookie', auth.serializeCookie('nova_session', token, 7 * 24 * 60 * 60, COOKIE_SECURE));
    res.redirect('/');
  } catch (err) {
    console.error('[AUTH] Error en callback:', err.message);
    res.status(500).send('No se pudo iniciar sesión: ' + err.message);
  }
});

// GET /api/me - usuario actual (o null)
app.get('/api/me', (req, res) => {
  res.json({ ok: true, user: auth.getSession(req), configured: auth.isConfigured() });
});

// POST /api/logout - cierra la sesión
app.post('/api/logout', (req, res) => {
  auth.destroySession(req);
  res.setHeader('Set-Cookie', auth.clearCookie('nova_session'));
  res.json({ ok: true });
});

// -------------------------------------------------------------

// Upload en memoria (sin tocar disco)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

// -------------------------------------------------------------
// API
// -------------------------------------------------------------

// GET /api/health - estado del servidor y DB
app.get('/api/health', async (_req, res) => {
  const dbOk = await db.isReady();
  res.json({ ok: true, db: dbOk, maxMB: MAX_MB });
});

// GET /api/history - historial del usuario logueado (MySQL)
app.get('/api/history', async (req, res) => {
  const limit = Number(req.query.limit || 20);
  const user = auth.getSession(req);
  if (!user || !user.email) return res.json({ ok: true, items: [] });
  const rows = await db.getHistory(limit, user.email);
  res.json({ ok: true, items: rows });
});

// POST /api/optimize - subir y optimizar un XML/META
app.post('/api/optimize', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se recibio ningun archivo.' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const isXml = ext === '.xml' || ext === '.meta' || ext === '.ytyp' || ext === '.ymt';

    // Si no es texto, lo rechazamos amablemente
    const buf = req.file.buffer;
    const head = buf.slice(0, 64).toString('latin1');
    const looksText = /<\?xml|<[A-Za-z_:]|<Root|<\/?/.test(head) || isXml;

    if (!looksText) {
      return res.status(400).json({
        ok: false,
        error: 'El archivo no parece un XML/META valido de FiveM. Sube un .xml, .meta, .ytyp.xml o .ymt.xml',
      });
    }

    const opts = {
      keepDeclaration: req.body.keepDeclaration !== 'false',
      trimDecimals: req.body.trimDecimals === 'false' ? 0 : 6,
      filename: req.file.originalname,
    };

    const result = optimize(buf, opts);

    const original_size = buf.length;
    const optimized_size = result.out.length;
    const savings_bytes = original_size - optimized_size;
    const savings_pct = original_size > 0 ? (savings_bytes / original_size) * 100 : 0;

    // Guardar en MySQL (solo con sesión iniciada, asociado al perfil)
    const sessionUser = auth.getSession(req);
    if (sessionUser && sessionUser.email) {
      const record = {
        user_email: sessionUser.email,
        original_name: req.file.originalname,
        file_type: result.type,
        original_size,
        optimized_size,
        savings_bytes,
        savings_pct: +savings_pct.toFixed(3),
        comments_removed: result.stats.comments_removed,
        empties_removed: result.stats.empties_removed,
        dups_removed: result.stats.dups_removed,
        decimals_trimmed: result.stats.decimals_trimmed,
        elapsed_ms: result.elapsed_ms,
        client_ip: req.ip,
      };
      db.saveOptimization(record).catch(() => {});
    }

    const baseName = req.file.originalname.replace(/\.[^.]+$/, '');
    const optimizedName = baseName + '_optimized' + ext;

    res.json({
      ok: true,
      type: result.type,
      originalName: req.file.originalname,
      optimizedName,
      originalSize: original_size,
      optimizedSize: optimized_size,
      savingsBytes: savings_bytes,
      savingsPct: +savings_pct.toFixed(2),
      stats: result.stats,
      elapsedMs: result.elapsed_ms,
      // El XML optimizado como texto (para vista previa y descarga)
      optimizedContent: result.out.toString('utf8'),
      // Depuracion rapida del tipo detectado
      detected: classifyType(req.file.originalname, buf.toString('utf8')),
    });
  } catch (err) {
    console.error('[API] Error optimizando:', err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ ok: false, error: 'El archivo supera el limite de ' + MAX_MB + ' MB.' });
    }
    res.status(500).json({ ok: false, error: 'Error interno al optimizar: ' + err.message });
  }
});

// POST /api/optimize-ytd - optimizar un .ytd (texturas) con comparador
app.post('/api/optimize-ytd', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se recibio ningun archivo.' });
    }

    const quality = Math.max(1, Math.min(100, Number(req.body.quality || 100)));
    const stripMips = req.body.stripMips !== 'false';

    // Análisis solo (calidad 100 + mips false) para vista previa sin descarga
    const analyzeOnly = req.body.analyze === 'true';

    const result = analyzeOnly
      ? { textures: parseYtd(req.file.buffer).textures, preview: true }
      : optimizeYtd(req.file.buffer, { quality, stripMips, fileName: req.file.originalname });

    const baseName = req.file.originalname.replace(/\.[^.]+$/, '');
    const ext = path.extname(req.file.originalname).toLowerCase();

    if (analyzeOnly) {
      return res.json({
        ok: true,
        type: 'ytd',
        originalName: req.file.originalname,
        originalSize: req.file.buffer.length,
        textures: result.textures.map((t) => ({
          name: t.name,
          formatName: t.formatName,
          width: t.width,
          height: t.height,
          levels: t.levels,
          pixelSize: t.pixelSize,
        })),
        elapsedMs: 0,
      });
    }

    // Guardar en MySQL (solo con sesión iniciada, asociado al perfil)
    const sessionUser = auth.getSession(req);
    if (sessionUser && sessionUser.email) {
      const record = {
        user_email: sessionUser.email,
        original_name: req.file.originalname,
        file_type: 'ytd',
        original_size: result.original.size,
        optimized_size: result.optimized.size,
        savings_bytes: result.saved,
        savings_pct: +result.pct,
        comments_removed: 0,
        empties_removed: 0,
        dups_removed: 0,
        decimals_trimmed: 0,
        elapsed_ms: 0,
        client_ip: req.ip,
      };
      db.saveOptimization(record).catch(() => {});
    }

    res.json({
      ok: true,
      type: 'ytd',
      originalName: req.file.originalname,
      optimizedName: baseName + '_optimized' + ext,
      originalSize: result.original.size,
      optimizedSize: result.optimized.size,
      savingsBytes: result.saved,
      savingsPct: +result.pct,
      quality,
      stripMips,
      textures: result.textures,
      previews: result.previews,
      optimizedFile: result.file.toString('base64'),
      elapsedMs: 0,
    });
  } catch (err) {
    console.error('[API] Error optimizando YTD:', err);
    res.status(500).json({ ok: false, error: 'Error interno al optimizar YTD: ' + err.message });
  }
});

// POST /api/ytd-dds - extraer una textura de un .ytd como DDS (para vista previa)
app.post('/api/ytd-dds', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se recibio ningun archivo.' });
    }
    const texName = req.body.name;
    const parsed = parseYtd(req.file.buffer);
    const tex = parsed.textures.find((t) => t.name === texName);
    if (!tex) return res.status(404).json({ ok: false, error: 'Textura no encontrada: ' + texName });
    res.json({ ok: true, dds: toDds(tex).toString('base64'), formatName: fmtName(tex.format) });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error: ' + err.message });
  }
});

// POST /api/analyze - análisis técnico de .ydd/.yft/.ydr/.ybn/.ymap (RSC7)
app.post('/api/analyze', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se recibio ningun archivo.' });
    }
    const info = analyzeRsc7(req.file.buffer);
    res.json({
      ok: true,
      type: 'rsc7',
      originalName: req.file.originalname,
      originalSize: req.file.buffer.length,
      version: info.version,
      isCompressed: info.isCompressed,
      compressedRatio: info.compressedRatio,
      sysSize: info.sysSize,
      gfxSize: info.gfxSize,
      hasTextureDict: info.hasTextureDict,
      textures: info.textures.map((t) => ({
        name: t.name,
        formatName: t.formatName,
        width: t.width,
        height: t.height,
        levels: t.levels,
        pixelSize: t.pixelSize,
      })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error al analizar: ' + err.message });
  }
});

// POST /api/optimize-zip - optimizar las .ytd de un .zip completo
app.post('/api/optimize-zip', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se recibio ningun archivo.' });
    }
    const quality = Math.max(1, Math.min(100, Number(req.body.quality || 100)));
    const result = optimizeZip(req.file.buffer, { quality, stripMips: true });

    const baseName = req.file.originalname.replace(/\.[^.]+$/, '');
    res.json({
      ok: true,
      type: 'zip',
      originalName: req.file.originalname,
      optimizedName: baseName + '_optimized.zip',
      originalSize: result.original.size,
      optimizedSize: result.optimized.size,
      savingsBytes: result.saved,
      savingsPct: +result.pct,
      quality,
      entries: result.entries,
      optimizedFile: result.file.toString('base64'),
    });
  } catch (err) {
    console.error('[API] Error optimizando ZIP:', err);
    res.status(500).json({ ok: false, error: 'Error al optimizar ZIP: ' + err.message });
  }
});

// -------------------------------------------------------------
// Arranque
// -------------------------------------------------------------

db.init();

app.listen(PORT, () => {
  console.log('');
  console.log('  ███╗   ██╗ ██████╗ ██╗   ██╗ █████╗ ');
  console.log('  ████╗  ██║██╔═══██╗██║   ██║██╔══██╗');
  console.log('  ██╔██╗ ██║██║   ██║██║   ██║███████║');
  console.log('  ██║╚██╗██║██║   ██║╚██╗ ██╔╝██╔══██║');
  console.log('  ██║ ╚████║╚██████╔╝ ╚████╔╝ ██║  ██║');
  console.log('  ╚═╝  ╚═══╝ ╚═════╝   ╚═══╝  ╚═╝  ╚═╝');
  console.log('  NOVA OPTIMIZER');
  console.log('');
  console.log('  Servidor web      : http://localhost:' + PORT);
  db.isReady().then((ok) => {
    console.log('  Base de datos     : ' + (ok ? 'MySQL conectada' : 'MySQL NO conectada (configura .env)'));
    console.log('');
  });
});
