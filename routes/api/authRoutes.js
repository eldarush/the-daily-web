const express = require('express');
const router = express.Router();
const authController = require('../../controllers/authController');
const { requireAuth } = require('../../middlewares/auth');

router.post('/login', authController.login);
router.post('/logout', requireAuth, authController.logout);
router.get('/me', requireAuth, authController.getCurrentUser);

module.exports = router;
