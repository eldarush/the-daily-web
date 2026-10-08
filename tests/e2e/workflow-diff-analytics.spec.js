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
    await page.request.post('/api/auth/logout');
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

  test('immediate switch, reload, close and failed save retain the captured article', async ({ page, context }) => {
    const reporter = await User.findOne({ username: REP });
    const a = await Article.create({ title: 'Switch source', summary: 'S', content: 'C', category: 'News', author: reporter._id });
    const b = await Article.create({ title: 'Switch target', summary: 'S', content: 'C', category: 'News', author: reporter._id });
    await login(page, REP);
    await page.waitForURL('**/workspace');
    await page.locator(`[data-id="${a._id}"]`).click();
    await page.fill('#article-content', 'Immediate source edit');
    await page.locator(`[data-id="${b._id}"]`).click();
    await expect(page.locator('#article-id')).toHaveValue(String(b._id));
    expect((await Article.findById(a._id)).content).toBe('Immediate source edit');
    expect((await Article.findById(b._id)).content).toBe('C');
    await page.fill('#article-content', 'Reload edit');
    await page.reload();
    await page.locator(`[data-id="${b._id}"]`).click();
    await expect(page.locator('#article-content')).toHaveValue('Reload edit');
    await expect.poll(async () => (await Article.findById(b._id)).content).toBe('Reload edit');
    await page.route('**/autosave', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Temporary failure"}' }));
    await page.fill('#article-content', 'Retry edit');
    await page.click('#submit-article-btn');
    await expect(page.locator('#autosave-badge')).toContainText('Temporary failure');
    expect((await Article.findById(b._id)).status).toBe('draft');
    await page.unroute('**/autosave');
    await page.click('#submit-article-btn');
    await expect.poll(async () => (await Article.findById(b._id)).content).toBe('Retry edit');
    await page.locator(`[data-id="${a._id}"]`).click();
    await page.fill('#article-content', 'Close edit');
    await page.close();
    await expect.poll(async () => (await Article.findById(a._id)).content).toBe('Close edit');
    const fresh = await context.browser().newContext({ baseURL: 'http://localhost:3000' });
    const freshPage = await fresh.newPage();
    await login(freshPage, REP);
    await freshPage.waitForURL('**/workspace');
    await freshPage.locator(`[data-id="${a._id}"]`).click();
    await expect(freshPage.locator('#article-content')).toHaveValue('Close edit');
    await fresh.close();
  });

  test('reporter reaches and edits an article beyond page one', async ({ page }) => {
    const reporter = await User.findOne({ username: REP });
    const articles = await Article.insertMany(Array.from({ length: 25 }, (_, index) => ({
      title: 'Paged ' + index, summary: 'S', content: 'C', category: 'News', author: reporter._id,
      updatedAt: new Date(Date.now() - (index + 1) * 1000)
    })));
    await login(page, REP);
    await page.waitForURL('**/workspace');
    await page.click('#workspace-next');
    await expect(page.locator('#workspace-page')).toContainText('Page 2');
    const older = articles[24];
    await page.locator(`[data-id="${older._id}"]`).click();
    await page.fill('#article-content', 'Older article edited');
    await page.click('#workspace-prev');
    await expect(page.locator('#workspace-page')).toContainText('Page 1');
    expect((await Article.findById(older._id)).content).toBe('Older article edited');
    await Article.deleteMany({ _id: { $in: articles.map(article => article._id) } });
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
  test('published revision stays live through return and resubmission', async ({ page }) => {
    const reporter = await User.findOne({ username: REP });
    const a = await Article.create({ title: 'Revision live', summary: 'S', content: 'Live body', category: 'News', author: reporter._id, status: 'published', publishedAt: new Date() });
    await login(page, REP);
    await page.waitForURL('**/workspace');
    await page.locator(`[data-id="${a._id}"]`).click();
    await page.fill('#article-title-input', 'Revision proposed');
    await expect(page.locator('#autosave-badge')).toContainText('All changes saved');
    await login(page, ED);
    await page.waitForURL('**/editor');
    expect((await page.request.post(`/api/editor/articles/${a._id}/approve`, { data: {} })).status()).toBe(400);
    await login(page, REP);
    await page.waitForURL('**/workspace');
    await page.locator(`[data-id="${a._id}"]`).click();
    await page.click('#submit-article-btn');
    await expect(page.locator('#submit-article-btn')).toBeDisabled();
    await login(page, ED);
    await page.waitForURL('**/editor');
    await page.selectOption('#status-filter', 'pending');
    await page.locator('tr', { hasText: 'Revision live' }).getByRole('button', { name: 'Review' }).click();
    await expect(page.locator('#edit-title')).toHaveValue('Revision proposed');
    await expect(page.locator('#diff-live')).toContainText('Revision live');
    await expect(page.locator('#diff-pending')).toContainText('Revision proposed');
    await page.click('#btn-reject');
    await page.fill('#reject-notes', 'Add a source');
    await page.click('#btn-reject');
    await expect(page.locator('#review-modal')).toBeHidden();
    expect((await Article.findById(a._id)).title).toBe('Revision live');
    await login(page, REP);
    await page.waitForURL('**/workspace');
    await page.locator(`[data-id="${a._id}"]`).click();
    await expect(page.locator('#rejection-notes')).toHaveText('Add a source');
    await page.fill('#article-content', 'Corrected body with source');
    await page.click('#submit-article-btn');
    await expect(page.locator('#submit-article-btn')).toBeDisabled();
    await login(page, ED);
    await page.waitForURL('**/editor');
    await page.selectOption('#status-filter', 'pending');
    await page.locator('tr', { hasText: 'Revision live' }).getByRole('button', { name: 'Review' }).click();
    await page.click('#btn-approve');
    await expect(page.locator('#review-modal')).toBeHidden();
    const fresh = await Article.findById(a._id);
    expect(fresh.title).toBe('Revision proposed');
    expect(fresh.content).toBe('Corrected body with source');
    expect(fresh.publishedUpdates).toHaveLength(1);
  });

  test('blank editing and delayed exit saves recover across fresh sessions', async ({ page, context }) => {
    const reporter = await User.findOne({ username: REP });
    const a = await Article.create({ title: 'Ordered saves', summary: 'S', content: 'C', category: 'News', author: reporter._id });
    await login(page, REP);
    await page.waitForURL('**/workspace');
    await page.locator(`[data-id="${a._id}"]`).click();
    await page.fill('#article-title-input', '');
    await page.fill('#article-summary-input', '');
    await page.fill('#article-content', '');
    await expect(page.locator('#autosave-badge')).toContainText('All changes saved');
    const fresh = await context.browser().newContext({ baseURL: 'http://localhost:3000' });
    const freshPage = await fresh.newPage();
    await login(freshPage, REP);
    await freshPage.waitForURL('**/workspace');
    await freshPage.locator(`[data-id="${a._id}"]`).click();
    await expect(freshPage.locator('#article-title-input')).toHaveValue('');
    await expect(freshPage.locator('#article-summary-input')).toHaveValue('');
    await expect(freshPage.locator('#article-content')).toHaveValue('');
    await fresh.close();
    let delayed;
    let announce;
    const intercepted = new Promise(resolve => { announce = resolve; });
    await page.route('**/autosave', async route => {
      if (route.request().postDataJSON().content === 'Older in flight') {
        delayed = route;
        announce();
      } else await route.continue();
    });
    await page.fill('#article-content', 'Older in flight');
    await intercepted;
    await page.fill('#article-content', 'Latest exit edit');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect.poll(async () => (await Article.findById(a._id)).content).toBe('Latest exit edit');
    await delayed.continue();
    await expect(page.locator('#autosave-badge')).toContainText('newer save');
    expect((await Article.findById(a._id)).content).toBe('Latest exit edit');
    await page.close();
    const finalContext = await context.browser().newContext({ baseURL: 'http://localhost:3000' });
    const finalPage = await finalContext.newPage();
    await login(finalPage, REP);
    await finalPage.waitForURL('**/workspace');
    await finalPage.locator(`[data-id="${a._id}"]`).click();
    await expect(finalPage.locator('#article-content')).toHaveValue('Latest exit edit');
    await finalContext.close();
  });

});
