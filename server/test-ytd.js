'use strict';

/* Autotest del motor YTD: genera un YTD sintético, lo re-parsea y verifica. */

const ytd = require('./ytd');
const dxt = require('./dxt');
const { optimizeYtd } = require('./ytdOptimizer');

function makeTestTexture(name, w, h, format, withMips) {
  const bpp = ytd.bytesPerPixel(format);
  const bw = w & ~3;
  const bh = h & ~3;
  const level0 = bpp >= 1 ? bw * bh * bpp : bw * bh * 0.5;
  const stride = bpp >= 1 ? bw * bpp : bw * 0.5;
  const total = withMips ? Math.floor(level0 * 1.33) : level0;
  const buf = Buffer.alloc(total);
  for (let i = 0; i < total; i++) buf[i] = (i * 7) & 0xff;
  return { name, nameHash: 0x12345678, width: bw, height: bh, stride, format, levels: withMips ? 3 : 1, pixelData: buf };
}

function t(desc, fn) {
  try {
    fn();
    console.log('OK   ' + desc);
  } catch (e) {
    console.log('FAIL ' + desc + ': ' + e.message);
    process.exitCode = 1;
  }
}

const tex1 = makeTestTexture('test_a.dds', 256, 128, ytd.FMT.DXT1, true);
const tex2 = makeTestTexture('test_b.dds', 64, 64, ytd.FMT.DXT5, true);
const tex3 = makeTestTexture('test_c.dds', 32, 32, ytd.FMT.A8R8G8B8, false);

const built = ytd.buildYtd([tex1, tex2, tex3], { version: 12 });

t('buildYtd genera RSC7 válido', () => {
  if (built.readUInt32LE(0) !== 0x37435352) throw new Error('magic no es RSC7');
  if (built.length < 100) throw new Error('muy corto');
});

let parsed;
t('parseYtd roundtrip', () => {
  parsed = ytd.parseYtd(built);
  if (parsed.textures.length !== 3) throw new Error('se esperaban 3 texturas, hay ' + parsed.textures.length);
  if (parsed.version !== 12) throw new Error('version ' + parsed.version);
});

t('texturas con datos correctos', () => {
  const a = parsed.textures.find((x) => x.name === 'test_a.dds');
  if (!a) throw new Error('no está test_a');
  if (a.width !== 256 || a.height !== 128) throw new Error('dims ' + a.width + 'x' + a.height);
  if (a.format !== ytd.FMT.DXT1) throw new Error('formato');
  if (a.pixelSize !== 256 * 128 * 0.5 * 1.3125) throw new Error('pixelSize ' + a.pixelSize);
  if (a.pixelData.length === 0) throw new Error('sin pixelData');
  if (a.levels !== 3) throw new Error('levels ' + a.levels);
});

t('toDds genera cabecera DDS', () => {
  const dds = ytd.toDds(parsed.textures[0]);
  if (dds.subarray(0, 4).toString() !== 'DDS ') throw new Error('magic DDS');
  if (dds.readUInt32LE(4) !== 124) throw new Error('dwSize');
});

t('mipSavings positivo con mips', () => {
  const a = parsed.textures.find((x) => x.name === 'test_a.dds');
  if (ytd.mipSavings(a) <= 0) throw new Error('debería ahorrar mips');
});

t('optimizeYtd quita mips y reduce', () => {
  const out = optimizeYtd(built, { quality: 50, stripMips: true });
  if (out.optimized.size >= out.original.size) throw new Error('no se redujo tamaño');
  const a = out.textures.find((x) => x.name === 'test_a.dds');
  if (a.widthAfter >= a.widthBefore) throw new Error('no se redujo resolución');
  if (out.file.readUInt32LE(0) !== 0x37435352) throw new Error('salida no es RSC7');
});

t('optimizeYtd solo mips (quality 100)', () => {
  const out = optimizeYtd(built, { quality: 100, stripMips: true });
  const a = out.textures.find((x) => x.name === 'test_a.dds');
  if (a.widthAfter !== a.widthBefore) throw new Error('no debe reducir resolución');
  if (a.method !== 'mips eliminados') throw new Error('método: ' + a.method);
});

t('decodeDxt1/encodeDxt1 roundtrip', () => {
  const rgba = Buffer.alloc(64 * 64 * 4);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      rgba[i] = (x * 3) & 0xff;
      rgba[i + 1] = (y * 5) & 0xff;
      rgba[i + 2] = 128;
      rgba[i + 3] = 255;
    }
  }
  const enc = dxt.encodeDxt1(rgba, 64, 64);
  const dec = dxt.decodeDxt1(enc.data, 64, 64);
  // el encoder usa bounding box; la reconstrucción no debe desviarse mucho
  let maxErr = 0;
  for (let i = 0; i < 64 * 64; i++) {
    for (let c = 0; c < 3; c++) {
      const e = Math.abs(rgba[i * 4 + c] - dec[i * 4 + c]);
      if (e > maxErr) maxErr = e;
    }
  }
  if (maxErr > 90) throw new Error('error máximo demasiado alto: ' + maxErr);
});

t('decodeDxt5Alpha roundtrip', () => {
  const rgba = Buffer.alloc(16 * 16 * 4);
  for (let i = 0; i < 16 * 16; i++) {
    rgba[i * 4] = 200;
    rgba[i * 4 + 1] = 100;
    rgba[i * 4 + 2] = 50;
    rgba[i * 4 + 3] = (i * 17) & 0xff;
  }
  const enc = dxt.encodeDxt5(rgba, 16, 16);
  const dec = dxt.decodeDxt5(enc, 16, 16);
  let maxErr = 0;
  for (let i = 0; i < 16 * 16; i++) {
    const e = Math.abs(rgba[i * 4 + 3] - dec[i * 4 + 3]);
    if (e > maxErr) maxErr = e;
  }
  if (maxErr > 64) throw new Error('alpha error demasiado alto: ' + maxErr);
});

const fs = require('fs');
const path = require('path');

// Regresión: las listas ResourceSimpleList64 usan count/capacity u16.
t('parseYtd lee count/capacity u16 (135 texturas)', () => {
  const file = path.join(__dirname, '..', 'oycm3.ytd');
  if (!fs.existsSync(file)) throw new Error('no está oycm3.ytd (omitir)');
  const p = ytd.parseYtd(fs.readFileSync(file));
  if (p.textures.length !== 135) throw new Error('se esperaban 135 texturas, hay ' + p.textures.length);
  if (p.fileVft !== 0x40571500) throw new Error('fileVft 0x' + p.fileVft.toString(16));
});

// Regresión: re-empaquetado de un .ytd real debe re-parsear idéntico.
t('roundtrip del YTD real (rebuilt == original en nivel 0)', () => {
  const file = path.join(__dirname, '..', 'oycm3.ytd');
  if (!fs.existsSync(file)) throw new Error('no está oycm3.ytd (omitir)');
  const a = ytd.parseYtd(fs.readFileSync(file));
  const rebuilt = ytd.buildYtd(a.textures.map((t) => ({ ...t })), {
    version: a.version,
    fileVft: a.fileVft,
    dictHeader: a.dictHeader,
  });
  const b = ytd.parseYtd(rebuilt);
  if (b.textures.length !== a.textures.length) throw new Error('count difiere');
  for (let i = 0; i < a.textures.length; i++) {
    const x = a.textures[i];
    const y = b.textures[i];
    if (x.width !== y.width || x.height !== y.height || x.pixelSize !== y.pixelSize || x.name !== y.name) {
      throw new Error('textura ' + i + ' (' + x.name + ') no coincide');
    }
    if (x.pixelData.compare(y.pixelData) !== 0) throw new Error('pixelData de ' + x.name + ' difiere');
  }
});

console.log('---');
if (!process.exitCode) console.log('TODO OK');
else console.log('HAY FALLOS');
