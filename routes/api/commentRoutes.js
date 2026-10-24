const express = require('express');
const router = express.Router();

const commentController = require('../../controllers/commentController');
const {guestCommentLimiter} = require('../../middlewares/rateLimiter');
const {requireRole} = require('../../middlewares/rbac');

// Reject missing/private articles and malformed text before reserving a guest
// attempt. Moving the limiter first would charge invalid submissions too.
router.post(
    '/comments',
    commentController.validatePublicArticle,
    commentController.validateCommentInput,
    guestCommentLimiter,
    commentController.createComment
);

router.get(
    '/articles/:articleId/comments',
    commentController.validatePublicArticle,
    commentController.getComments
);

router.delete(
    '/comments/:commentId',
    requireRole('editor'),
    commentController.deleteComment
);

router.put('/comments/:commentId', requireRole('editor'), commentController.updateComment);

module.exports = router;
