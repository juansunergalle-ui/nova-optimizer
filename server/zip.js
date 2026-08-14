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
