const express = require('express');
const { renderHome } = require('../controllers/feedController');
const { renderArticlePage } = require('../controllers/articleController');

const router = express.Router();
router.get('/', renderHome);
router.get('/articles/:id', renderArticlePage);

module.exports = router;
