-- ============================================================
--  ClickSafe — database/contact_messages.sql
--  Handles messages submitted via the About page contact form.
--
--  Apply on top of the existing schema:
--    mysql -u root -p clicksafe_db < database/contact_messages.sql
-- ============================================================

USE clicksafe_db;

-- ── contact_messages ─────────────────────────────────────────
-- Stores every message submitted through the landing page
-- contact form. No FK to users — senders are anonymous visitors.
CREATE TABLE IF NOT EXISTS contact_messages (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,

  -- Sender info (from the form)
  name         VARCHAR(120)  NOT NULL,
  email        VARCHAR(254)  NOT NULL,

  -- Subject is stored as a controlled enum string
  -- (bug | feature | question | security | other)
  subject      VARCHAR(32)   NOT NULL,

  message      TEXT          NOT NULL,

  -- Workflow fields — managed by the team in the admin panel
  status       ENUM('new', 'read', 'replied', 'closed')
               NOT NULL DEFAULT 'new',

  -- Optional: which team member picked it up
  assigned_to  VARCHAR(80)   NULL COMMENT 'e.g. eva@clicksafe.dev',

  -- Timestamps
  submitted_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
               ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_cm_status       (status),
  INDEX idx_cm_email        (email),
  INDEX idx_cm_subject      (subject),
  INDEX idx_cm_submitted_at (submitted_at)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
--  QUERIES
-- ============================================================

-- ── 1. INSERT — save a new contact form submission ───────────
--  Used by: POST /api/contact  (contactController.js)
--  Params:  :name, :email, :subject, :message
-- ------------------------------------------------------------
INSERT INTO contact_messages (name, email, subject, message)
VALUES (:name, :email, :subject, :message);

-- ── 2. SELECT ALL — newest messages first (team inbox view) ──
SELECT
  id,
  name,
  email,
  subject,
  LEFT(message, 120)  AS preview,
  status,
  assigned_to,
  submitted_at
FROM contact_messages
ORDER BY submitted_at DESC;

-- ── 3. SELECT — unread / new messages only ───────────────────
SELECT
  id,
  name,
  email,
  subject,
  LEFT(message, 120)  AS preview,
  submitted_at
FROM contact_messages
WHERE status = 'new'
ORDER BY submitted_at DESC;

-- ── 4. SELECT ONE — full message by id ───────────────────────
--  Params: :id
SELECT
  id,
  name,
  email,
  subject,
  message,
  status,
  assigned_to,
  submitted_at,
  updated_at
FROM contact_messages
WHERE id = :id;

-- ── 5. UPDATE — mark a message as read ───────────────────────
--  Params: :id
UPDATE contact_messages
SET    status = 'read'
WHERE  id = :id
  AND  status = 'new';

-- ── 6. UPDATE — mark a message as replied ────────────────────
--  Params: :id
UPDATE contact_messages
SET    status = 'replied'
WHERE  id = :id;

-- ── 7. UPDATE — assign a message to a team member ────────────
--  Params: :assigned_to (email), :id
UPDATE contact_messages
SET    assigned_to = :assigned_to,
       status      = 'read'
WHERE  id = :id;

-- ── 8. UPDATE — close / archive a message ────────────────────
--  Params: :id
UPDATE contact_messages
SET    status = 'closed'
WHERE  id = :id;

-- ── 9. SELECT — search by sender email ───────────────────────
--  Params: :email
SELECT
  id,
  name,
  subject,
  LEFT(message, 120)  AS preview,
  status,
  submitted_at
FROM contact_messages
WHERE email = :email
ORDER BY submitted_at DESC;

-- ── 10. SELECT — filter by subject category ──────────────────
--  Params: :subject  ('bug' | 'feature' | 'question' | 'security' | 'other')
SELECT
  id,
  name,
  email,
  LEFT(message, 120)  AS preview,
  status,
  submitted_at
FROM contact_messages
WHERE subject = :subject
ORDER BY submitted_at DESC;

-- ── 11. SELECT — count by status (dashboard summary) ─────────
SELECT
  status,
  COUNT(*) AS total
FROM contact_messages
GROUP BY status
ORDER BY FIELD(status, 'new', 'read', 'replied', 'closed');

-- ── 12. SELECT — messages from last 30 days ──────────────────
SELECT
  id,
  name,
  email,
  subject,
  status,
  submitted_at
FROM contact_messages
WHERE submitted_at >= NOW() - INTERVAL 30 DAY
ORDER BY submitted_at DESC;

-- ── 13. DELETE — hard delete a single message ────────────────
--  Prefer UPDATE … SET status='closed' over deleting.
--  Use this only for GDPR erasure requests.
--  Params: :id
DELETE FROM contact_messages
WHERE id = :id;