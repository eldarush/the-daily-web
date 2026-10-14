const express = require('express');
const { requireRole } = require('../../middlewares/rbac');
const {
  listAllArticles,
  getArticleDiff,
  editArticle,
  approveArticle,
  rejectArticle,
  deleteArticle
} = require('../../controllers/editorController');

const router = express.Router();

// Every editor route requires an authenticated user with the 'editor' role.
router.use(requireRole('editor'));

router.get('/articles', listAllArticles);
router.get('/articles/:id/diff', getArticleDiff);
// These actions operate on the controller-selected candidate: submitted original
// text or a staged revision. Only approval promotes that candidate to public fields.
router.put('/articles/:id', editArticle);
router.post('/articles/:id/approve', approveArticle);
router.post('/articles/:id/reject', rejectArticle);
router.delete('/articles/:id', deleteArticle);

module.exports = router;
