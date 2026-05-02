-- ============================================================
--  ClickSafe — database/schema.sql
--  Run once to set up the database:
--    mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS clicksafe_db;"
--    mysql -u root -p clicksafe_db < database/schema.sql
-- ============================================================

-- Use the clicksafe database
USE clicksafe_db;

-- ── checked_urls ─────────────────────────────────────────────
-- Caches URL safety results for 24 hours.
-- Avoids re-hitting the Google Safe Browsing API on repeat visits.
CREATE TABLE IF NOT EXISTS checked_urls (
  id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  url         VARCHAR(2048)   NOT NULL,
  -- MD5 of the URL, used for fast indexed lookups
  -- (VARCHAR(2048) columns can't be indexed directly in MySQL)
  url_hash    CHAR(32)        NOT NULL,
  is_safe     TINYINT(1)      NOT NULL COMMENT '1 = safe, 0 = dangerous',
  threat_type VARCHAR(64)     NULL     COMMENT 'e.g. MALWARE, SOCIAL_ENGINEERING',
  checked_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE  KEY uq_url_hash  (url_hash),
  INDEX        idx_checked_at (checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Event: purge entries older than 24 hours ─────────────────
-- Runs every hour so the table stays small.
-- Requires the MySQL event scheduler to be on:
--   SET GLOBAL event_scheduler = ON;
-- (or add event_scheduler=ON to your my.cnf)
CREATE EVENT IF NOT EXISTS purge_old_url_cache
  ON SCHEDULE EVERY 1 HOUR
  DO
    DELETE FROM checked_urls
    WHERE checked_at < NOW() - INTERVAL 24 HOUR;
-- ── users ────────────────────────────────────────────────────
-- Stores registered ClickSafe accounts.
CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)      NOT NULL COMMENT 'UUID v4',
  email         VARCHAR(254)  NOT NULL,
  password_hash VARCHAR(60)   NOT NULL COMMENT 'bcrypt hash',
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── dark_pattern_dismissals ──────────────────────────────────
-- Logs every time a user dismisses a dark-pattern highlight as a
-- false positive. Aggregated across users this reveals which sites
-- and pattern types trigger the most false positives, enabling
-- per-domain detection threshold tuning over time.
-- user_id is nullable — anonymous dismissals are also recorded.
CREATE TABLE IF NOT EXISTS dark_pattern_dismissals (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id      CHAR(36)      NULL     COMMENT 'FK → users.id, NULL if not logged in',
  domain       VARCHAR(253)  NOT NULL,
  pattern_type VARCHAR(64)   NOT NULL COMMENT 'e.g. Fake Urgency, Confirm Shaming',
  pattern_text VARCHAR(160)  NULL     COMMENT 'short excerpt of the flagged text',
  page_url     VARCHAR(2048) NULL,
  dismissed_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_dp_domain       (domain),
  INDEX idx_dp_pattern_type (pattern_type),
  INDEX idx_dp_dismissed_at (dismissed_at),
  CONSTRAINT fk_dp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── score_history ────────────────────────────────────────────
-- Persists per-page privacy scores server-side.
-- Replaces the 30-day rolling chrome.storage.local window with
-- a permanent, cross-device history tied to the user's account.
CREATE TABLE IF NOT EXISTS score_history (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id       CHAR(36)      NOT NULL COMMENT 'FK → users.id',
  url           VARCHAR(2048) NOT NULL,
  domain        VARCHAR(253)  NOT NULL,
  score         TINYINT       NOT NULL COMMENT '0-100',
  is_https      TINYINT(1)    NOT NULL DEFAULT 1,
  cookie_count  SMALLINT      NOT NULL DEFAULT 0,
  script_count  SMALLINT      NOT NULL DEFAULT 0,
  company_count SMALLINT      NOT NULL DEFAULT 0,
  companies     JSON          NULL     COMMENT 'top-5 [{name, tier}]',
  visited_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_sh_user_visited (user_id, visited_at),
  CONSTRAINT fk_sh_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── tracker_encounters ────────────────────────────────────────
-- Logs every tracker hit server-side: domain, tracker hostname,
-- user (if logged in), and timestamp. Aggregated across users
-- this builds a live picture of the most aggressive trackers on
-- the web, and feeds a per-user tracker history on the dashboard.
-- user_id is nullable so anonymous encounters are recorded too.
CREATE TABLE IF NOT EXISTS tracker_encounters (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id         CHAR(36)      NULL     COMMENT 'FK → users.id, NULL if not logged in',
  page_domain     VARCHAR(253)  NOT NULL COMMENT 'site being visited',
  tracker_domain  VARCHAR(253)  NOT NULL COMMENT 'tracker hostname e.g. doubleclick.net',
  page_url        VARCHAR(2048) NULL,
  encountered_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_te_tracker_domain   (tracker_domain),
  INDEX idx_te_page_domain      (page_domain),
  INDEX idx_te_user_encountered (user_id, encountered_at),
  INDEX idx_te_encountered_at   (encountered_at),
  CONSTRAINT fk_te_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── user_whitelists ──────────────────────────────────────────
-- Stores per-user trusted domains synced from the extension.
-- user_id references the UUID from the auth system (authController).
CREATE TABLE IF NOT EXISTS user_whitelists (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id    CHAR(36)      NOT NULL COMMENT 'FK → users.id',
  domain     VARCHAR(253)  NOT NULL COMMENT 'e.g. example.com',
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE  KEY uq_user_domain (user_id, domain),
  INDEX        idx_user_id   (user_id),
  CONSTRAINT fk_whitelist_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
