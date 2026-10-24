const express = require('express');
const router = express.Router();
const authController = require('../../controllers/authController');
const { requireAuth } = require('../../middlewares/auth');

// Login establishes the session; logout and /me require the fresh user loaded by app.js.
router.post('/login', authController.login);
router.post('/logout', requireAuth, authController.logout);
router.get('/me', requireAuth, authController.getCurrentUser);

module.exports = router;
