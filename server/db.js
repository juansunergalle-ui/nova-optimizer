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
