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
