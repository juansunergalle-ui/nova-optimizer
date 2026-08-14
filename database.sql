-- =====================================================
-- NOVA OPTIMIZER - Esquema MySQL
-- Ejecutar en tu hosting (phpMyAdmin / consola MySQL)
-- =====================================================

CREATE DATABASE IF NOT EXISTS nova_optimizer
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE nova_optimizer;

-- -----------------------------------------------------
-- Historial de optimizaciones
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS optimizations (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
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
) ENGINE=InnoDB;
