-- ============================================================
--  ClickSafe — database/seed.sql
--  Optional: load sample rows for local testing.
--  Run AFTER schema.sql:
--    mysql -u root -p clicksafe_db < database/seed.sql
-- ============================================================

USE clicksafe_db;

-- A known-safe URL
INSERT IGNORE INTO checked_urls (url, url_hash, is_safe, threat_type, checked_at)
VALUES (
  'https://www.google.com',
  MD5('https://www.google.com'),
  1,
  NULL,
  NOW()
);

-- A known-safe URL
INSERT IGNORE INTO checked_urls (url, url_hash, is_safe, threat_type, checked_at)
VALUES (
  'https://www.github.com',
  MD5('https://www.github.com'),
  1,
  NULL,
  NOW()
);

-- A fake dangerous URL (for testing the warning UI)
INSERT IGNORE INTO checked_urls (url, url_hash, is_safe, threat_type, checked_at)
VALUES (
  'http://malware-test.example.com',
  MD5('http://malware-test.example.com'),
  0,
  'MALWARE',
  NOW()
);

-- A fake phishing URL (for testing the warning UI)
INSERT IGNORE INTO checked_urls (url, url_hash, is_safe, threat_type, checked_at)
VALUES (
  'http://phishing-test.example.com',
  MD5('http://phishing-test.example.com'),
  0,
  'SOCIAL_ENGINEERING',
  NOW()
);