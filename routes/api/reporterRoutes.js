const express = require('express');
const { requireRole } = require('../../middlewares/rbac');
const {
  getReporterArticles,
  createArticle,
  autosaveArticle,
  submitArticle
} = require('../../controllers/reporterController');

const router = express.Router();

// Every reporter route requires an authenticated user with the 'reporter' role.
router.use(requireRole('reporter'));

router.get('/articles', getReporterArticles);
router.post('/articles', createArticle);
router.put('/articles/:id/autosave', autosaveArticle);
router.post('/articles/:id/submit', submitArticle);

module.exports = router;
