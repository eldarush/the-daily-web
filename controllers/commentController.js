const Comment = require('../models/Comment');

exports.createComment = async (req, res) => {
    try{
        const { articleId, authorName, content } = req.body;
        const userIp = req.ip;

        const isRegisteredUser = !!req.session?.user;
        const user = req.session?.user?.id || null;

        const finalAuthorName = isRegisteredUser
            ? req.session.user.fullName
            : authorName;

        if (!articleId || !finalAuthorName || !content?.trim()) {
            return res.status(400).json({
            message: 'Article, author name and content are required'
            });
        }

        const comment = await Comment.create({
            article: articleId,
            authorName: finalAuthorName,
            content,
            userIp,
            isRegisteredUser,
            user
        });

        res.status(201).json({ comment });
    } catch (error) {
        res.status(500).json({
            message: 'Failed to create comment'});

    }
};

exports.getComments = async (req, res) => {
    try {
        const comments = await Comment.find({
        article: req.params.articleId
        }).sort({createdAt: -1});

        res.status(200).json({ comments });
    }
    catch (error) {
        res.status(500).json({
        message: 'Failed to get comments'});
    }
};

exports.deleteComment = async (req, res) => {
    try {
        const comment = await Comment.findByIdAndDelete(
            req.params.commentId);

        if (!comment) {
            return res.status(404).json({message: 'Comment not found'});
            }

        res.status(200).json({ success: true});
        }
    catch (error) {
        res.status(500).json({message: 'Failed to delete comment'});
    }
};