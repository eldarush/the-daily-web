const express = require('express');
const { requireRole } = require('../../middlewares/rbac');
const { getArticleAnalytics, listPublishedArticles, setViewBucket, resetArticleAnalytics } = require('../../controllers/analyticsController');

const router = express.Router();

// Mounted at /api/analytics in app.js.
// Impact Analytics is an editor-only view.
// One line protects every route below: guests get 401, reporters 403.
router.use(requireRole('editor'));

// Used by the chart page (public/js/impact-chart.js):
// Keep this literal route before /:articleId, or "articles" becomes an ID.
router.get('/articles', listPublishedArticles); // fills the article picker
router.get('/:articleId', getArticleAnalytics); // the data for one article's chart
// Editor tools to correct or reset the stored counters (not used by the chart page):
router.put('/:articleId/buckets', setViewBucket);
router.delete('/:articleId', resetArticleAnalytics);

module.exports = router;
