const Article = require('../models/Article');
const Comment = require('../models/Comment');

const { recordView } = require('./analyticsController');

exports.renderArticlePage = async (req, res, next) => {
    try {
        if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
            return res.status(400).render('pages/error', { title: 'Invalid article ID', message: 'Invalid article ID' });
        }
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

        if (!req.session.user) {
            req.session.commentDevice = true;
            await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
        }
        await recordView(article._id);

        const comments = await Comment.find({
        article: article._id
        }).select('_id authorName content createdAt').sort({createdAt: -1});

        res.render('pages/article', {
            title: article.title,
            article: article,
            comments: comments
        });
    }

    catch (error) {
        next(error);
    }
};
