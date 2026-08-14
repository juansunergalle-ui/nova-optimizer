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
