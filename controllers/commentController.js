const Comment = require('../models/Comment');
const Article = require('../models/Article');
const validId = id => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
const publicComment = comment => ({
    _id: comment._id, authorName: comment.authorName,
    content: comment.content, createdAt: comment.createdAt
});
exports.publicComment = publicComment;

exports.validatePublicArticle = async (req, res, next) => {
    try {
        const articleId = req.params.articleId || req.body.articleId;
        if (!validId(articleId)) return res.status(400).json({ message: 'Invalid article ID' });
        if (!await Article.exists({ _id: articleId, status: 'published' })) {
            return res.status(404).json({ message: 'Article not found' });
        }
        next();
    } catch (error) { next(error); }
};

exports.validateCommentInput = (req, res, next) => {
    const authorName = req.session?.user ? req.session.user.fullName : req.body.authorName;
    const content = req.body.content;
    if (typeof authorName !== 'string' || !authorName.trim() || authorName.trim().length > 100 ||
        typeof content !== 'string' || !content.trim() || content.trim().length > 1000) {
        return res.status(400).json({ message: 'Name (1–100 characters) and comment (1–1000 characters) are required' });
    }
    req.commentInput = { authorName: authorName.trim(), content: content.trim() };
    next();
};

exports.createComment = async (req, res, next) => {
    try {
        const comment = await Comment.create({ ...req.commentInput, article: req.body.articleId,
            userIp: req.ip, isRegisteredUser: !!req.session?.user, user: req.session?.user?.id || null });
        res.status(201).json({ comment: publicComment(comment) });
    } catch (error) { next(error); }
};

exports.getComments = async (req, res, next) => {
    try {
        const comments = await Comment.find({ article: req.params.articleId }).select('_id authorName content createdAt').sort({ createdAt: -1 });
        res.json({ comments: comments.map(publicComment) });
    } catch (error) { next(error); }
};

exports.updateComment = async (req, res, next) => {
    try {
        if (!validId(req.params.commentId)) return res.status(400).json({ message: 'Invalid comment ID' });
        const updates = {};
        for (const [field, max] of [['authorName', 100], ['content', 1000]]) {
            if (Object.prototype.hasOwnProperty.call(req.body, field)) {
                if (typeof req.body[field] !== 'string' || !req.body[field].trim() || req.body[field].trim().length > max) {
                    return res.status(400).json({ message: 'Invalid comment text' });
                }
                updates[field] = req.body[field].trim();
            }
        }
        if (!Object.keys(updates).length) return res.status(400).json({ message: 'Name or content is required' });
        const comment = await Comment.findByIdAndUpdate(req.params.commentId, { $set: updates }, { new: true, runValidators: true });
        if (!comment) return res.status(404).json({ message: 'Comment not found' });
        res.json({ comment: publicComment(comment) });
    } catch (error) { next(error); }
};

exports.deleteComment = async (req, res, next) => {
    try {
        if (!validId(req.params.commentId)) return res.status(400).json({ message: 'Invalid comment ID' });
        if (!await Comment.findByIdAndDelete(req.params.commentId)) return res.status(404).json({ message: 'Comment not found' });
        res.json({ success: true });
    } catch (error) { next(error); }
};
