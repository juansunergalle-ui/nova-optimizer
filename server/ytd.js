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
