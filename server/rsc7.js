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
