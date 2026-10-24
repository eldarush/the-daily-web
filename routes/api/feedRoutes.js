const express = require('express');
const { getFeedArticles } = require('../../controllers/feedController');

const router = express.Router();
router.get('/', getFeedArticles);
// Read-only POST keeps large local reading-history lists out of the URL.
router.post('/search', getFeedArticles);

module.exports = router;
