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
      'INSERT INTO optimizations (original_name, file_type, original_size, optimized_size, savings_bytes, savings_pct, comments_removed, empties_removed, dups_removed, decimals_trimmed, elapsed_ms, client_ip) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)';
    await p.query(sql, [
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

async function getHistory(limit = 20) {
  try {
    const p = getPool();
    if (!p) return [];
    const [rows] = await p.query(
      'SELECT id, original_name, file_type, original_size, optimized_size, savings_bytes, savings_pct, created_at FROM optimizations ORDER BY id DESC LIMIT ?',
      [Math.min(Math.max(limit, 1), 100)]
    );
    return rows;
  } catch (err) {
    console.warn('[DB] No se pudo leer historial:', err.message);
    return [];
  }
}

module.exports = { init, getPool, isReady, saveOptimization, getHistory };
