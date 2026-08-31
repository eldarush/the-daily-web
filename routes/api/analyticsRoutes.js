const express = require('express');
const { requireRole } = require('../../middlewares/rbac');
const { getArticleAnalytics } = require('../../controllers/analyticsController');

const router = express.Router();

// Impact Analytics is an editor-only view.
router.use(requireRole('editor'));

router.get('/:articleId', getArticleAnalytics);

module.exports = router;
