const express = require('express');
const { getFeedArticles } = require('../../controllers/feedController');

const router = express.Router();
router.get('/', getFeedArticles);

module.exports = router;
