'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const db = require('./server/db');
const auth = require('./server/auth');
const { optimize, classifyType } = require('./server/optimizer');
const { optimizeYtd } = require('./server/ytdOptimizer');
const { parseYtd, fmtName, toDds } = require('./server/ytd');
const { analyzeRsc7 } = require('./server/rsc7');
const { optimizeZip } = require('./server/zipOptimizer');

const PORT = Number(process.env.PORT || 3000);
const MAX_MB = Number(process.env.MAX_FILE_MB || 25);
const BASE_URL = (process.env.OAUTH_BASE_URL || 'http://localhost:' + PORT).replace(/\/$/, '');
const COOKIE_SECURE = BASE_URL.startsWith('https://');

const app = express();

// -------------------------------------------------------------
// Middlewares
// -------------------------------------------------------------
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

// GET /api/history - historial de optimizaciones (MySQL)
app.get('/api/history', async (req, res) => {
  const limit = Number(req.query.limit || 20);
  const rows = await db.getHistory(limit);
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

    // Guardar en MySQL (no bloquea la respuesta si falla)
    const record = {
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

    // Guardar en MySQL (no bloquea la respuesta si falla)
    const record = {
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
