const { test, expect } = require('@playwright/test');
const mongoose = require('mongoose');
const User = require('../../models/User');
const Article = require('../../models/Article');

const REP = 'e2e_wf_reporter';
const ED = 'e2e_wf_editor';

test.describe('Hodara Track: Autosave Continuity, Editorial Review & Approval', () => {
  test.beforeAll(async () => {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/the_daily_web';
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }
    await User.deleteMany({ username: { $in: [REP, ED] } });
    const reporter = await User.create({ username: REP, password: 'password123', fullName: 'WF Reporter E2E', role: 'reporter' });
    await User.create({ username: ED, password: 'password123', fullName: 'WF Editor E2E', role: 'editor' });
    await Article.deleteMany({ author: reporter._id });
  });

  test.afterAll(async () => {
    const reporter = await User.findOne({ username: REP });
    if (reporter) await Article.deleteMany({ author: reporter._id });
    await User.deleteMany({ username: { $in: [REP, ED] } });
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  });

  async function login(page, username) {
    await page.goto('/login');
    await page.fill('#username', username);
    await page.fill('#password', 'password123');
    await page.click('#login-submit-btn');
  }

  test('reporter autosaves without a save button, survives reload, and submits for review', async ({ page }) => {
    const title = 'Continuity Headline ' + Date.now();

    await login(page, REP);
    await page.waitForURL('**/workspace');

    // Create a new article and type into it — no save button is clicked.
    await page.click('#new-article-btn');
    await expect(page.locator('#editor-panel')).toBeVisible();
    await page.fill('#article-title-input', title);
    await page.fill('#article-content', 'Body of the continuity test article.');

    // Autosave badge confirms the work was persisted.
    await expect(page.locator('#autosave-badge')).toContainText(/saved/i, { timeout: 8000 });

    // Reload the page: the draft must come back from the server (work continuity).
    await page.reload();
    await page.locator('.article-list-item', { hasText: title }).click();
    await expect(page.locator('#article-title-input')).toHaveValue(title);

    // Submit the draft for editorial review.
    await page.click('#submit-article-btn');
    await expect(page.locator('.article-list-item', { hasText: title }).locator('.status-pill')).toContainText('pending', { timeout: 8000 });
  });

  test('editor reviews the pending article and approves it', async ({ page }) => {
    await login(page, ED);
    await page.waitForURL('**/editor');

    await page.selectOption('#status-filter', 'pending');
    const row = page.locator('tr', { hasText: 'Continuity Headline' }).first();
    await expect(row).toBeVisible({ timeout: 8000 });
    await row.getByRole('button', { name: 'Review' }).click();

    await expect(page.locator('#review-modal')).toBeVisible();
    await page.click('#btn-approve');
    await expect(page.locator('#review-modal')).toBeHidden({ timeout: 8000 });

    // The approved article now appears under the published filter.
    await page.selectOption('#status-filter', 'published');
    await expect(page.locator('tr', { hasText: 'Continuity Headline' }).first()).toBeVisible({ timeout: 8000 });
  });
});
