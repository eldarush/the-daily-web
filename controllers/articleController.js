const Article = require('../models/Article');
const Comment = require('../models/Comment');

const { recordView } = require('./analyticsController');

exports.renderArticlePage = async (req, res) => {
    try {
        const article = await Article.findOne({
            _id: req.params.id,
            status: 'published'
        }).populate('author', 'fullName');

        if (!article) {
        return res.status(404).render('pages/error', {
        title: 'Article Not Found',
        message: 'The requested article could not be found'
        });
        }

        recordView(article._id);

        const comments = await Comment.find({
        article: article._id
        }).sort({createdAt: -1});

        res.render('pages/article', {
            title: article.title,
            article: article,
            comments: comments
        });
    }

    catch (error) {
        res.status(500).render('pages/error', {
            title: 'Server error',
            message: 'Failed to load article'
        });
    }
};