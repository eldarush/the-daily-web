const { test, expect } = require('@playwright/test');
const mongoose = require('mongoose');

const User = require('../../models/User');
const Article = require('../../models/Article');
const Comment = require('../../models/Comment');

let testAuthor;
let testArticle;


test.describe('Article Page & Comments E2E', () => {

    test.beforeAll(async () => {
        const mongoUri =
            process.env.MONGODB_URI ||
            'mongodb://127.0.0.1:27017/the_daily_web';

        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(mongoUri);
        }

        // Clean old test data if a previous test run stopped unexpectedly
        const oldAuthor = await User.findOne({
            username: 'e2e_comments_author'
        });

        if (oldAuthor) {
            const oldArticles = await Article.find({
                author: oldAuthor._id
            });

            for (const article of oldArticles) {
                await Comment.deleteMany({
                    article: article._id
                });
            }

            await Article.deleteMany({
                author: oldAuthor._id
            });

            await User.findByIdAndDelete(
                oldAuthor._id
            );
        }

        // Create a test reporter
        testAuthor = await User.create({
            username: 'e2e_comments_author',
            password: 'password123',
            fullName: 'E2E Test Author',
            role: 'reporter'
        });

        // Create a published test article
        testArticle = await Article.create({
            title: 'E2E Comments Test Article',
            summary: 'Article created for the comments E2E test',
            content: 'This is the full content of the E2E test article.',
            category: 'Technology',
            author: testAuthor._id,
            status: 'published',
            publishedAt: new Date()
        });
    });


    test('Guest can open an article and post a comment without page reload', async ({ page }) => {

        // Open the article page
        await page.goto(`/articles/${testArticle._id}`);


        // Make sure the article title is visible
        await expect(
            page.getByRole('heading', {
                name: 'E2E Comments Test Article'
            })
        ).toBeVisible();


        // Make sure the full article content is visible
        await expect(
            page.locator('.article-content')
        ).toContainText(
            'This is the full content of the E2E test article.'
        );


        // Fill in the guest name
        await page.locator('#author-name').fill(
            'E2E Guest'
        );


        // Fill in the comment
        await page.locator('#comment-content').fill(
            'My E2E test comment'
        );


        // Submit the comment
        await page.locator(
            '#comment-form button[type="submit"]'
        ).click();


        // The new comment should appear immediately
        const firstComment =
            page.locator('.comment').first();

        await expect(
            firstComment.locator('strong')
        ).toHaveText('E2E Guest');

        await expect(
            firstComment.locator('.comment-content')
        ).toHaveText('My E2E test comment');
    });


    test.afterAll(async () => {

        // Delete comments created for the test
        if (testArticle) {
            await Comment.deleteMany({
                article: testArticle._id
            });

            // Delete the test article
            await Article.findByIdAndDelete(
                testArticle._id
            );
        }

        // Delete the test reporter
        if (testAuthor) {
            await User.findByIdAndDelete(
                testAuthor._id
            );
        }

        // Close the MongoDB connection
        if (mongoose.connection.readyState !== 0) {
            await mongoose.connection.close();
        }
    });

});