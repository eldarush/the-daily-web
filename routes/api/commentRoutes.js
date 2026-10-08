const express = require('express');
const router = express.Router();

const commentController = require('../../controllers/commentController');
const {guestCommentLimiter} = require('../../middlewares/rateLimiter');
const {requireRole} = require('../../middlewares/rbac');

router.post(
    '/comments',
    guestCommentLimiter,
    commentController.createComment
);

router.get(
    '/articles/:articleId/comments',
    commentController.getComments
);

router.delete(
    '/comments/:commentId',
    requireRole('editor'),
    commentController.deleteComment
);

module.exports = router;
