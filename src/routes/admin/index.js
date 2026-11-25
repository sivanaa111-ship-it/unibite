const express = require('express');
const { requireRole } = require('../../middleware/auth');

const router = express.Router();
// Every admin endpoint is protected server-side (Super Admin only), regardless of the UI.
router.use(requireRole('admin'));
router.use('/', require('./overview'));
router.use('/restaurants', require('./restaurants'));
router.use('/categories', require('./categories'));
router.use('/requests', require('./requests'));
router.use('/', require('./accounts'));      // /restaurant-accounts, /invitations
router.use('/students', require('./students'));
router.use('/', require('./security'));      // /notifications, /security

module.exports = router;
