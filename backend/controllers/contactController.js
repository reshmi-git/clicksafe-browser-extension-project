// backend/controllers/contactController.js
// Handles POST /api/contact — saves a contact form message to the DB.

const db = require('../config/database');

// Allowed subject values — matches the <select> options in about.html
const VALID_SUBJECTS = new Set(['bug', 'feature', 'question', 'security', 'other']);

/**
 * POST /api/contact
 * Body: { name, email, subject, message }
 * Returns 201 on success, 400 on validation failure, 500 on DB error.
 */
async function submitContactMessage(req, res) {
  try {
    const { name, email, subject, message } = req.body;

    // ── Validation ──────────────────────────────────────────
    const errors = [];

    if (!name || typeof name !== 'string' || name.trim().length < 1) {
      errors.push('name is required');
    }
    if (!email || typeof email !== 'string') {
      errors.push('email is required');
    } else {
      const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRx.test(email.trim())) {
        errors.push('email is not valid');
      }
    }
    if (!subject || !VALID_SUBJECTS.has(subject)) {
      errors.push('subject must be one of: bug, feature, question, security, other');
    }
    if (!message || typeof message !== 'string' || message.trim().length < 10) {
      errors.push('message must be at least 10 characters');
    }

    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    // ── Sanitise ────────────────────────────────────────────
    const cleanName    = name.trim().substring(0, 120);
    const cleanEmail   = email.trim().toLowerCase().substring(0, 254);
    const cleanMessage = message.trim().substring(0, 5000); // cap at 5k chars

    // ── INSERT — Query #1 from contact_messages.sql ─────────
    const sql = `
      INSERT INTO contact_messages (name, email, subject, message)
      VALUES (?, ?, ?, ?)
    `;

    const [result] = await db.query(sql, [cleanName, cleanEmail, subject, cleanMessage]);

    return res.status(201).json({
      success: true,
      message: 'Message received. We\'ll get back to you within 48 hours.',
      id: result.insertId
    });

  } catch (err) {
    console.error('[ClickSafe] Contact form DB error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Internal server error. Please try again or email us directly.'
    });
  }
}

/**
 * GET /api/contact  (admin only — protected by auth middleware)
 * Returns all messages, newest first. Supports ?status= and ?subject= filters.
 */
async function getContactMessages(req, res) {
  try {
    const { status, subject } = req.query;

    let sql = `
      SELECT
        id, name, email, subject,
        LEFT(message, 120) AS preview,
        status, assigned_to, submitted_at
      FROM contact_messages
    `;
    const params = [];
    const conditions = [];

    if (status && ['new', 'read', 'replied', 'closed'].includes(status)) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (subject && VALID_SUBJECTS.has(subject)) {
      conditions.push('subject = ?');
      params.push(subject);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY submitted_at DESC';

    const [rows] = await db.query(sql, params);
    return res.json({ success: true, count: rows.length, messages: rows });

  } catch (err) {
    console.error('[ClickSafe] Get contact messages error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal server error.' });
  }
}

/**
 * PATCH /api/contact/:id  (admin only)
 * Body: { status?, assigned_to? }
 * Updates the status or assignment of a single message.
 */
async function updateContactMessage(req, res) {
  try {
    const { id } = req.params;
    const { status, assigned_to } = req.body;

    if (!status && !assigned_to) {
      return res.status(400).json({ success: false, error: 'Provide status or assigned_to.' });
    }

    const sets = [];
    const params = [];

    if (status && ['new', 'read', 'replied', 'closed'].includes(status)) {
      sets.push('status = ?');
      params.push(status);
    }
    if (assigned_to !== undefined) {
      sets.push('assigned_to = ?');
      params.push(assigned_to || null);
    }

    params.push(id);
    const sql = `UPDATE contact_messages SET ${sets.join(', ')} WHERE id = ?`;
    const [result] = await db.query(sql, params);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Message not found.' });
    }
    return res.json({ success: true });

  } catch (err) {
    console.error('[ClickSafe] Update contact message error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal server error.' });
  }
}

module.exports = { submitContactMessage, getContactMessages, updateContactMessage };