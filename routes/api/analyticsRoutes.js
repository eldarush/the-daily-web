const express = require('express');
const { requireRole } = require('../../middlewares/rbac');
const { getArticleAnalytics, listPublishedArticles, setViewBucket, resetArticleAnalytics } = require('../../controllers/analyticsController');

const router = express.Router();

// Impact Analytics is an editor-only view.
router.use(requireRole('editor'));

router.get('/articles', listPublishedArticles);
router.get('/:articleId', getArticleAnalytics);
router.put('/:articleId/buckets', setViewBucket);
router.delete('/:articleId', resetArticleAnalytics);

module.exports = router;
