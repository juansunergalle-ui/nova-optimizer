'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const multer = require('multer');

const db = require('./server/db');
const { optimize, classifyType } = require('./server/optimizer');

const PORT = Number(process.env.PORT || 3000);
const MAX_MB = Number(process.env.MAX_FILE_MB || 25);

const app = express();

// -------------------------------------------------------------
// Middlewares
// -------------------------------------------------------------
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
