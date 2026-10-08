const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;
let app;
let server;
let request;
let Article;
let Comment;
let User;
let testArticle;
let testAuthor;

describe('Article Comments & Guest Spam Protection', () => {

    beforeAll(async () => {
        // Create a temporary MongoDB database for the tests
        mongod = await MongoMemoryServer.create();
        const uri = mongod.getUri();

        process.env.MONGODB_URI = uri;
        process.env.SESSION_SECRET = 'test-session-secret-key-12345';
        process.env.NODE_ENV = 'test';

        await mongoose.connect(uri);

        // Load the application and models
        app = require('../../app');
        server = app.listen(0);
        request = require('supertest');

        Article = require('../../models/Article');
        Comment = require('../../models/Comment');
        User = require('../../models/User');

        // Create a test reporter
        testAuthor = await User.create({
            username: 'comments_test_author',
            password: 'password123',
            fullName: 'Test Article Author',
            role: 'reporter'
        });

        // Create a published test article
        testArticle = await Article.create({
            title: 'Test Article For Comments',
            summary: 'This is a test article summary',
            content: 'This is the full content of the test article.',
            category: 'Technology',
            author: testAuthor._id,
            status: 'published',
            publishedAt: new Date()
        });
    });


    // 1. SSR - the full article is already rendered by the server
    test('GET /articles/:id renders the full published article', async () => {
        const res = await request(server)
            .get(`/articles/${testArticle._id}`);

        expect(res.status).toBe(200);

        expect(res.text).toContain(
            'Test Article For Comments'
        );

        expect(res.text).toContain(
            'This is the full content of the test article.'
        );
    });


    // 2. Guest can create 3 comments, but the 4th is blocked
    test('Guest can post 3 comments but the 4th is blocked with 429', async () => {

        const device = request.agent(server);
        await device.get(`/articles/${testArticle._id}`);
        for (let i = 1; i <= 3; i++) {
            const res = await device
                .post('/api/comments')
                .send({
                    articleId: testArticle._id,
                    authorName: 'Guest Tester',
                    content: `Test comment ${i}`
                });

            expect(res.status).toBe(201);

            expect(res.body.comment).toBeDefined();

            expect(res.body.comment.authorName)
                .toBe('Guest Tester');

            expect(res.body.comment.content)
                .toBe(`Test comment ${i}`);
        }


        // Fourth comment from the same guest/IP should be blocked
        const blockedRes = await device
            .post('/api/comments')
            .send({
                articleId: testArticle._id,
                authorName: 'Guest Tester',
                content: 'This comment should be blocked'
            });

        expect(blockedRes.status).toBe(429);

        expect(blockedRes.body.error)
            .toBeDefined();

        expect(blockedRes.body.retryAfterSeconds)
            .toBeDefined();
    });


    // 3. Comments for the article can be fetched
    test('GET /api/articles/:articleId/comments returns article comments', async () => {

        const res = await request(server)
            .get(`/api/articles/${testArticle._id}/comments`);

        expect(res.status).toBe(200);

        expect(
            Array.isArray(res.body.comments)
        ).toBe(true);

        expect(res.body.comments.length)
            .toBeGreaterThanOrEqual(3);

        expect(
            res.body.comments.some(
                comment => comment.content === 'Test comment 1'
            )
        ).toBe(true);

        expect(
            res.body.comments.some(
                comment => comment.content === 'Test comment 2'
            )
        ).toBe(true);

        expect(
            res.body.comments.some(
                comment => comment.content === 'Test comment 3'
            )
        ).toBe(true);
    });


    // 4. A guest cannot delete a comment, but an editor can
    test('Only an editor can delete a comment', async () => {

        // Create a comment directly in the database
        const testComment = await Comment.create({
            article: testArticle._id,
            authorName: 'Comment To Delete',
            content: 'This comment will be deleted',
            userIp: 'test-delete-ip',
            isRegisteredUser: false,
            user: null
        });


        // Guest tries to delete the comment
        const guestDeleteRes = await request(server)
            .delete(`/api/comments/${testComment._id}`);

        expect(guestDeleteRes.status).toBe(401);


        // Make sure the comment still exists
        const commentStillExists =
            await Comment.findById(testComment._id);

        expect(commentStillExists)
            .not.toBeNull();


        // Create an editor
        await User.create({
            username: 'comments_test_editor',
            password: 'password123',
            fullName: 'Test Editor',
            role: 'editor'
        });


        // agent keeps the login session between requests
        const agent = request.agent(server);


        // Log in as the editor
        const loginRes = await agent
            .post('/api/auth/login')
            .send({
                username: 'comments_test_editor',
                password: 'password123'
            });

        expect([200, 302])
            .toContain(loginRes.status);


        // Logged-in editor deletes the comment
        const editorDeleteRes = await agent
            .delete(`/api/comments/${testComment._id}`);

        expect(editorDeleteRes.status)
            .toBe(200);


        // Make sure the comment was actually deleted
        const deletedComment =
            await Comment.findById(testComment._id);

        expect(deletedComment)
            .toBeNull();
    });


    test('Private articles and malformed IDs cannot expose or create comments', async () => {
        const draft = await Article.create({title: 'Private', summary: 'Private', content: 'Private', category: 'News', author: testAuthor._id});
        for (const id of [draft._id.toString(), new mongoose.Types.ObjectId().toString(), 'bad-id']) {
            const expected = id === 'bad-id' ? 400 : 404;
            expect((await request(server).get(`/api/articles/${id}/comments`)).status).toBe(expected);
            expect((await request(server).post('/api/comments').send({articleId: id, authorName: 'Guest', content: 'Hello'})).status).toBe(expected);
        }
        expect(await Comment.countDocuments({article: draft._id})).toBe(0);
    });

    test('Comment responses contain only public fields', async () => {
        const res = await request(server).post('/api/comments').send({articleId: testArticle._id, authorName: '<script>name</script>', content: '<script>text</script>'});
        expect(res.status).toBe(201);
        expect(Object.keys(res.body.comment).sort()).toEqual(['_id', 'authorName', 'content', 'createdAt']);
        const list = await request(server).get(`/api/articles/${testArticle._id}/comments`);
        list.body.comments.forEach(comment => expect(Object.keys(comment).sort()).toEqual(['_id', 'authorName', 'content', 'createdAt']));
    });

    test('Parallel requests share a device limit while same-IP devices remain independent', async () => {
        const device = request.agent(server);
        await device.get(`/articles/${testArticle._id}`);
        const responses = await Promise.all(Array.from({length: 8}, () => device.post('/api/comments').send({articleId: testArticle._id, authorName: 'Parallel', content: 'Parallel'})));
        expect(responses.filter(res => res.status === 201)).toHaveLength(3);
        expect(responses.filter(res => res.status === 429)).toHaveLength(5);
        expect(responses.find(res => res.status === 429).headers['retry-after']).toBeDefined();
        const other = request.agent(server);
        await other.get(`/articles/${testArticle._id}`);
        expect((await other.post('/api/comments').send({articleId: testArticle._id, authorName: 'Other device', content: 'Allowed'})).status).toBe(201);
    });

    test('Device limits survive middleware reload and recover after expiration', async () => {
        const Limit = require('../../models/GuestCommentLimit');
        const device = request.agent(server);
        const articleResponse = await device.get(`/articles/${testArticle._id}`);
        for (let i = 0; i < 3; i++) expect((await device.post('/api/comments').send({articleId: testArticle._id, authorName: 'Persistent', content: 'Hello'})).status).toBe(201);
        const persisted = await Limit.findOne().sort({expiresAt: -1});
        expect(persisted.attempts).toHaveLength(3);
        // A newly loaded limiter has no process-local count to preserve.
        delete require.cache[require.resolve('../../middlewares/rateLimiter')];
        const freshLimiter = require('../../middlewares/rateLimiter').guestCommentLimiter;
        const signedCookie = decodeURIComponent(articleResponse.headers['set-cookie'][0].split(';')[0].split('=').slice(1).join('='));
        const sessionID = signedCookie.slice(2, signedCookie.lastIndexOf('.'));
        let freshStatus;
        await freshLimiter({sessionID, session: {save: callback => callback()}}, {
            set: () => {}, status: status => { freshStatus = status; return {json: () => {}}; }
        }, error => { if (error) throw error; });
        expect(freshStatus).toBe(429);
        expect((await device.post('/api/comments').send({articleId: testArticle._id, authorName: 'Persistent', content: 'Blocked'})).status).toBe(429);
        await Limit.updateMany({}, {$set: {attempts: [new Date(Date.now() - 61000)], expiresAt: new Date(Date.now() + 60000)}});
        expect((await device.post('/api/comments').send({articleId: testArticle._id, authorName: 'Persistent', content: 'Recovered'})).status).toBe(201);
    });

    test('Editor update validates fields and returns public text', async () => {
        const comment = await Comment.findOne({article: testArticle._id});
        expect((await request(server).put(`/api/comments/${comment._id}`).send({content: 'Changed'})).status).toBe(401);
        const editor = request.agent(server);
        await editor.post('/api/auth/login').send({username: 'comments_test_editor', password: 'password123'});
        expect((await editor.put('/api/comments/bad-id').send({content: 'Changed'})).status).toBe(400);
        expect((await editor.put(`/api/comments/${comment._id}`).send({content: {bad: 'value'}})).status).toBe(400);
        const updated = await editor.put(`/api/comments/${comment._id}`).send({content: '<b>Changed</b>', userIp: 'evil'});
        expect(updated.status).toBe(200);
        expect(updated.body.comment.content).toBe('<b>Changed</b>');
        expect(Object.keys(updated.body.comment).sort()).toEqual(['_id', 'authorName', 'content', 'createdAt']);
        expect((await Comment.findById(comment._id)).userIp).not.toBe('evil');
        expect((await editor.put(`/api/comments/${new mongoose.Types.ObjectId()}`).send({content: 'Changed'})).status).toBe(404);
    });

    test('Article pages reject malformed IDs and preserve escaped SSR without an author', async () => {
        expect((await request(server).get('/articles/invalid')).status).toBe(400);
        expect((await request(server).get(`/articles/${new mongoose.Types.ObjectId()}`)).status).toBe(404);
        const orphan = await Article.create({title: 'Orphan', summary: 'Summary', content: '<script>text</script>', category: 'News', author: new mongoose.Types.ObjectId(), status: 'published'});
        const response = await request(server).get(`/articles/${orphan._id}`);
        expect(response.status).toBe(200);
        expect(response.text).toContain('Staff Reporter');
        expect(response.text).toContain('&lt;script&gt;text&lt;/script&gt;');
        expect(response.text).toContain('article-detail-container');
        expect(response.text).toContain(`data-article-id="${orphan._id}"`);
    });

    afterAll(async () => {
        if (server) await new Promise(resolve => server.close(resolve));
        const { getSessionStore } =
            require('../../config/session');

        const store = getSessionStore();

        if (store && store.close) {
            await store.close();
        }

        if (mongoose.connection.readyState !== 0) {
            await mongoose.connection.close();
        }

        if (mongod) {
            await mongod.stop();
        }
    });

});