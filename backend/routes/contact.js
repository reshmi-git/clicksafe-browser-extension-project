// backend/routes/contact.js
// Mounts contact form endpoints on the Express app.

const express = require('express');
const router  = express.Router();
const { submitContactMessage, getContactMessages, updateContactMessage } = require('../controllers/contactController');
const auth = require('../middleware/auth');

// Public — anyone can submit the contact form
router.post('/', submitContactMessage);

// Admin-only — view and manage messages
router.get('/',        auth, getContactMessages);
router.patch('/:id',   auth, updateContactMessage);

module.exports = router;