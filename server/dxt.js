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
