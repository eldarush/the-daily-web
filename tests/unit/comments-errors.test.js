const mongoose = require('mongoose');
const Article = require('../../models/Article');
const Comment = require('../../models/Comment');
const Limit = require('../../models/GuestCommentLimit');
const comments = require('../../controllers/commentController');
const articles = require('../../controllers/articleController');
const { guestCommentLimiter } = require('../../middlewares/rateLimiter');

const id = new mongoose.Types.ObjectId().toString();
function response() {
    const res = { status: jest.fn(), json: jest.fn(), render: jest.fn(), set: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
}
function request() {
    return { params: { commentId: id, articleId: id, id }, body: {articleId: id, authorName: 'Guest', content: 'Hello'},
        commentInput: {authorName: 'Guest', content: 'Hello'}, ip: '127.0.0.1', sessionID: 'signed-device',
        session: {save: callback => callback()} };
}
afterEach(() => jest.restoreAllMocks());

test.each([
    ['validatePublicArticle', 'exists', Article],
    ['createComment', 'create', Comment],
    ['updateComment', 'findByIdAndUpdate', Comment],
    ['deleteComment', 'findByIdAndDelete', Comment]
])('%s forwards database failure to centralized handling', async (handler, method, model) => {
    const error = new Error('Database unavailable');
    jest.spyOn(model, method).mockRejectedValue(error);
    const next = jest.fn();
    await comments[handler](request(), response(), next);
    expect(next).toHaveBeenCalledWith(error);
});

test('Comment listing forwards query failure', async () => {
    const error = new Error('Database unavailable');
    jest.spyOn(Comment, 'find').mockReturnValue({select: () => ({sort: () => Promise.reject(error)})});
    const next = jest.fn();
    await comments.getComments(request(), response(), next);
    expect(next).toHaveBeenCalledWith(error);
});

test.each([undefined, '', ' ', {}, 'a'.repeat(101)])('Rejects invalid guest display name %p', authorName => {
    const req = request(); req.body.authorName = authorName;
    const res = response(); const next = jest.fn();
    comments.validateCommentInput(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
});

test.each([undefined, '', ' ', {}, 'a'.repeat(1001)])('Rejects invalid comment content %p', content => {
    const req = request(); req.body.content = content;
    const res = response(); const next = jest.fn();
    comments.validateCommentInput(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
});

test('Registered author comes from session and registered comments bypass guest budget', async () => {
    const req = request(); req.session.user = {id, fullName: 'Registered'};
    const next = jest.fn();
    comments.validateCommentInput(req, response(), next);
    expect(req.commentInput.authorName).toBe('Registered');
    const spy = jest.spyOn(Comment, 'create').mockResolvedValue({_id: id, authorName: 'Registered', content: 'Hello', createdAt: new Date()});
    await comments.createComment(req, response(), next);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({user: id, isRegisteredUser: true}));
    await guestCommentLimiter(req, response(), next);
    expect(next).toHaveBeenCalledTimes(2);
});

test('Editor must supply a supported update and delete IDs must be valid and present', async () => {
    const req = request(); req.body = {userIp: 'unsupported'};
    const res = response();
    await comments.updateComment(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    req.params.commentId = 'invalid';
    await comments.deleteComment(req, res, jest.fn());
    expect(res.status).toHaveBeenLastCalledWith(400);
    req.params.commentId = id;
    jest.spyOn(Comment, 'findByIdAndDelete').mockResolvedValue(null);
    await comments.deleteComment(req, res, jest.fn());
    expect(res.status).toHaveBeenLastCalledWith(404);
});

function articleQuery(article) {
    jest.spyOn(Article, 'findOne').mockReturnValue({populate: () => Promise.resolve(article)});
}
test('Article session persistence failure is handled before rendering', async () => {
    articleQuery({_id: id});
    const error = new Error('Session store unavailable');
    const req = request(); req.session.save = callback => callback(error);
    const next = jest.fn();
    await articles.renderArticlePage(req, response(), next);
    expect(next).toHaveBeenCalledWith(error);
});
test('Registered article readers do not need a guest session initialization', async () => {
    articleQuery({_id: id, title: 'Live'});
    jest.spyOn(Article, 'findByIdAndUpdate').mockResolvedValue({});
    const ViewBucket = require('../../models/ViewAnalytics');
    jest.spyOn(ViewBucket, 'findOneAndUpdate').mockResolvedValue({});
    jest.spyOn(Comment, 'find').mockReturnValue({select: () => ({sort: () => Promise.resolve([])})});
    const req = request(); req.session.user = {id}; req.session.save = jest.fn();
    const res = response();
    await articles.renderArticlePage(req, res, jest.fn());
    expect(req.session.save).not.toHaveBeenCalled();
    expect(res.render).toHaveBeenCalledWith('pages/article', expect.objectContaining({title: 'Live'}));
});

test('Limiter fails closed and forwards unavailable session persistence', async () => {
    const error = new Error('Session store unavailable');
    const req = request(); req.session.save = callback => callback(error);
    const next = jest.fn();
    await guestCommentLimiter(req, response(), next);
    expect(next).toHaveBeenCalledWith(error);
});

test.each([11000, 12345])('Limiter distinguishes duplicate initialization from database failure (%s)', async code => {
    const error = Object.assign(new Error('Insert failure'), {code});
    jest.spyOn(Limit, 'updateOne').mockRejectedValue(error);
    const accepted = jest.spyOn(Limit, 'findOneAndUpdate').mockResolvedValue({attempts: [new Date()]});
    const next = jest.fn();
    await guestCommentLimiter(request(), response(), next);
    if (code === 11000) {
        expect(accepted).toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith();
    } else {
        expect(accepted).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(error);
    }
});

test('Limiter gives usable retry timing if a TTL cleanup races a denied request', async () => {
    jest.spyOn(Limit, 'updateOne').mockResolvedValue({});
    jest.spyOn(Limit, 'findOneAndUpdate').mockResolvedValue(null);
    jest.spyOn(Limit, 'findById').mockReturnValue({lean: () => Promise.resolve(null)});
    const res = response();
    await guestCommentLimiter(request(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '60');
});
