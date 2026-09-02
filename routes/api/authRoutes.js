/**
 * Authentication API routes.
 * Exposes /api/auth endpoints for login, logout, and current user retrieval.
 */
const express = require('express');
const router = express.Router();
const authController = require('../../controllers/authController');
const { requireAuth } = require('../../middlewares/auth');

// Public route for authentication
router.post('/login', authController.login);

// Authenticated session routes
router.post('/logout', requireAuth, authController.logout);
router.get('/me', requireAuth, authController.getCurrentUser);

module.exports = router;
