const express = require('express');
const { renderHome } = require('../controllers/feedController');

const router = express.Router();
router.get('/', renderHome);

module.exports = router;
