const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;
let app;
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
        const res = await request(app)
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

        for (let i = 1; i <= 3; i++) {
            const res = await request(app)
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
        const blockedRes = await request(app)
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

        const res = await request(app)
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
        const guestDeleteRes = await request(app)
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
        const agent = request.agent(app);


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


    afterAll(async () => {
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