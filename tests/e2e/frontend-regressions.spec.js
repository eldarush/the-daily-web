const { test, expect } = require('@playwright/test');
const mongoose = require('mongoose');
const User = require('../../models/User');
const Article = require('../../models/Article');
const Comment = require('../../models/Comment');
const ViewAnalytics = require('../../models/ViewAnalytics');
let reporter, editor;

test.beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  reporter = await User.create({ username: 'frontend_reporter', password: 'password123', fullName: 'Frontend Reporter', role: 'reporter' });
  editor = await User.create({ username: 'frontend_editor', password: 'password123', fullName: 'Frontend Editor', role: 'editor' });
});
test.afterEach(async () => {
  const ids = await Article.find({ author: reporter._id }).distinct('_id');
  await Comment.deleteMany({ article: { $in: ids } });
  await ViewAnalytics.deleteMany({ article: { $in: ids } });
  await Article.deleteMany({ author: reporter._id });
});
test.afterAll(async () => {
  await User.deleteMany({ _id: { $in: [reporter._id, editor._id] } });
  await mongoose.disconnect();
});

function article(fields = {}) {
  return Article.create({ title: 'Frontend article', summary: 'Summary', content: 'Original content', category: 'News', author: reporter._id, ...fields });
}
async function login(page, user) {
  const res = await page.request.post('/api/auth/login', { data: { username: user.username, password: 'password123' } });
  expect(res.ok()).toBeTruthy();
}
async function openReview(page, a) {
  await page.locator('tr', { hasText: a.title }).getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.locator('#review-modal')).toBeVisible();
}
function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

test('reporter paging waits for a response and retries a failed page without skipping', async ({ page }) => {
  await Article.insertMany(Array.from({ length: 41 }, (_, i) => ({ title: 'Page article ' + i, category: 'News', author: reporter._id })));
  await login(page, reporter);
  await page.goto('/workspace');
  await expect(page.locator('#workspace-page')).toHaveText('Page 1 of 3');
  const expected = await (await page.request.get('/api/reporter/articles?page=2')).json();
  const held = gate();
  const started = gate();
  const requests = [];
  await page.route('**/api/reporter/articles?page=*', async route => {
    const number = new URL(route.request().url()).searchParams.get('page');
    requests.push(number);
    if (number === '2') { started.release(); await held.promise; }
    await route.continue();
  });
  try {
    await page.locator('#workspace-next').evaluate(el => { el.click(); el.click(); });
    await started.promise;
    await expect(page.locator('#workspace-next')).toBeDisabled();
    await expect(page.locator('#workspace-page')).toHaveText('Page 1 of 3');
    held.release();
    await expect(page.locator('#workspace-page')).toHaveText('Page 2 of 3');
    expect(requests).toEqual(['2']);
    expect(await page.locator('#article-list [data-id]').evaluateAll(els => els.map(el => el.dataset.id)))
      .toEqual(expected.articles.map(a => a._id));
  } finally { held.release(); }
  await page.unroute('**/api/reporter/articles?page=*');
  await page.route('**/api/reporter/articles?page=3', route => route.fulfill({ status: 503, json: {} }));
  await page.locator('#workspace-next').click();
  await expect(page.locator('#workspace-message')).toContainText('Could not load');
  await expect(page.locator('#workspace-page')).toHaveText('Page 2 of 3');
  await page.unroute('**/api/reporter/articles?page=3');
  await page.locator('#workspace-retry').click();
  await expect(page.locator('#workspace-page')).toHaveText('Page 3 of 3');
  await expect(page.locator('#article-list [data-id]')).toHaveCount(1);
  await expect(page.locator('#workspace-next')).toBeDisabled();
});

test('a new review clears old return notes while a failed return keeps its notes', async ({ page }) => {
  const a = await article({ title: 'First review', status: 'pending' });
  const b = await article({ title: 'Second review', status: 'pending' });
  await login(page, editor);
  await page.goto('/editor');
  await openReview(page, a);
  await page.locator('#btn-reject').click();
  await page.locator('#reject-notes').fill('Only for the first article');
  await page.locator('#modal-close').click();
  await openReview(page, b);
  await page.locator('#btn-reject').click();
  await expect(page.locator('#reject-notes')).toHaveValue('');
  await page.locator('#reject-notes').fill('Keep this note on failure');
  await page.route('**/' + b.id + '/reject', route => route.fulfill({ status: 503, json: { error: 'Return unavailable' } }));
  await page.locator('#btn-reject').click();
  await expect(page.locator('#modal-status')).toContainText('Return unavailable');
  await expect(page.locator('#reject-notes')).toHaveValue('Keep this note on failure');
  await expect(page.locator('#reject-notes')).toBeEnabled();
});

for (const published of [false, true]) {
  test('return saves edits before changing status' + (published ? ' for a live revision' : ''), async ({ page }) => {
    const a = await article(published ? { status: 'published', publishedAt: new Date(), pendingUpdate: {
      hasUpdate: true, status: 'pending', title: 'New title', summary: 'Summary', content: 'Proposed content', category: 'News'
    } } : { status: 'pending' });
    await login(page, editor);
    await page.goto('/editor');
    await openReview(page, a);
    await page.locator('#btn-edit').click();
    await page.locator('#edit-content').fill('Content corrected by the editor');
    await page.locator('#btn-reject').click();
    await page.locator('#btn-reject').click();
    await expect(page.locator('#modal-status')).toContainText('Notes are required');
    expect((await Article.findById(a.id)).editorChanges).toBeUndefined();
    await page.locator('#reject-notes').fill('Add a source');

    await page.route('**/api/editor/articles/' + a.id, route => route.fulfill({ status: 503, json: { error: 'Save unavailable' } }));
    await page.locator('#btn-reject').click();
    await expect(page.locator('#modal-status')).toContainText('Save unavailable');
    await expect(page.locator('#edit-content')).toHaveValue('Content corrected by the editor');
    await expect(page.locator('#reject-notes')).toHaveValue('Add a source');
    let saved = await Article.findById(a.id);
    expect(published ? saved.pendingUpdate.status : saved.status).toBe('pending');
    await page.unroute('**/api/editor/articles/' + a.id);

    await page.route('**/' + a.id + '/reject', route => route.fulfill({ status: 503, json: { error: 'Return unavailable' } }));
    await page.locator('#btn-reject').click();
    await expect(page.locator('#modal-status')).toContainText('Changes saved.');
    await expect(page.locator('#modal-status')).toContainText('Return unavailable');
    saved = await Article.findById(a.id);
    expect(published ? saved.pendingUpdate.content : saved.content).toBe('Content corrected by the editor');
    expect(published ? saved.pendingUpdate.status : saved.status).toBe('pending');

    await page.unroute('**/' + a.id + '/reject');
    await page.locator('#btn-reject').click();
    await expect(page.locator('#review-modal')).toBeHidden();
    saved = await Article.findById(a.id);
    expect(published ? saved.pendingUpdate.status : saved.status).toBe('rejected');
    expect(saved.editorChanges.after.content).toBe('Content corrected by the editor');
    if (published) {
      expect(saved.content).toBe('Original content');
      const html = await (await page.request.get('/articles/' + a.id)).text();
      expect(html).toContain('Original content');
      expect(html).not.toContain('Content corrected by the editor');
    }
  });
}

test('closing a review during save cannot return the next article', async ({ page }) => {
  const a = await article({ title: 'Slow save review', status: 'pending' });
  const b = await article({ title: 'Next review', status: 'pending' });
  await login(page, editor);
  await page.goto('/editor');
  await openReview(page, a);
  await page.locator('#btn-edit').click();
  await page.locator('#edit-content').fill('Saved to the first article');
  await page.locator('#btn-reject').click();
  await page.locator('#reject-notes').fill('First article notes');
  const held = gate();
  const started = gate();
  let puts = 0;
  const returns = [];
  page.on('request', req => { if (req.url().endsWith('/reject')) returns.push(req.url()); });
  await page.route('**/api/editor/articles/' + a.id, async route => {
    puts++;
    const response = await route.fetch();
    started.release();
    await held.promise;
    await route.fulfill({ response });
  });
  try {
    await page.locator('#btn-reject').evaluate(el => { el.click(); el.click(); });
    await started.promise;
    expect(puts).toBe(1);
    await page.locator('#modal-close').click();
    await openReview(page, b);
    await page.locator('#btn-reject').click();
    const response = page.waitForResponse(res => res.url().endsWith('/' + a.id) && res.request().method() === 'PUT');
    held.release();
    await response;
    await expect(page.locator('#edit-title')).toHaveValue(b.title);
    await expect(page.locator('#reject-notes')).toHaveValue('');
    await expect(page.locator('#reject-notes')).toBeEnabled();
    expect(returns).toEqual([]);
    expect((await Article.findById(a.id)).status).toBe('pending');
    expect((await Article.findById(b.id)).status).toBe('pending');
  } finally { held.release(); }
});

test('comment submit cannot duplicate an in-flight request and recovers from failure', async ({ page }) => {
  const a = await article({ status: 'published', publishedAt: new Date() });
  await page.goto('/articles/' + a.id);
  await page.locator('#author-name').fill('Guest');
  await page.locator('#comment-content').fill('One comment only');
  const held = gate();
  const started = gate();
  let posts = 0;
  await page.route('**/api/comments', async route => {
    posts++;
    started.release();
    await held.promise;
    await route.continue();
  });
  try {
    await page.locator('#comment-form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    await started.promise;
    await expect(page.locator('#comment-form button')).toBeDisabled();
    await expect(page.locator('#comment-content')).toBeDisabled();
    held.release();
    await expect(page.locator('#comment-message')).toHaveText('Comment posted successfully');
    expect(posts).toBe(1);
    expect(await Comment.countDocuments({ article: a.id })).toBe(1);
    await expect(page.locator('#comments-list .comment')).toHaveCount(1);
  } finally { held.release(); }
  await page.unroute('**/api/comments');
  await page.locator('#author-name').fill('Guest');
  await page.locator('#comment-content').fill('Preserve after failure');
  await page.route('**/api/comments', route => route.fulfill({ status: 503, json: { error: 'Comments unavailable' } }));
  await page.locator('#comment-form button').click();
  await expect(page.locator('#comment-message')).toHaveText('Comments unavailable');
  await expect(page.locator('#comment-content')).toHaveValue('Preserve after failure');
  await expect(page.locator('#comment-content')).toBeEnabled();
  await expect(page.locator('#comment-form button')).toBeEnabled();
  await page.unroute('**/api/comments');
  await page.locator('#comment-form button').click();
  await expect(page.locator('#comments-list .comment')).toHaveCount(2);
});

test('review load explains HTTP, network and session failures and can retry', async ({ page }) => {
  const a = await article({ status: 'pending' });
  await login(page, editor);
  await page.goto('/editor');
  const url = '**/' + a.id + '/diff';
  await page.route(url, route => route.fulfill({ status: 503, json: {} }));
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.locator('#review-message')).toContainText('Could not load');
  await expect(page.locator('#review-retry')).toBeVisible();
  await expect(page.locator('#review-modal')).toBeHidden();
  await page.unroute(url);
  await page.route(url, route => route.abort());
  await page.locator('#review-retry').click();
  await expect(page.locator('#review-message')).toContainText('Could not load');
  await expect(page.locator('#review-retry')).toBeVisible();
  await page.unroute(url);
  await page.route(url, route => route.fulfill({ status: 401, json: {} }));
  await page.locator('#review-retry').click();
  await expect(page.locator('#review-login')).toBeVisible();
  await expect(page.locator('#review-message')).toContainText('Sign in');
  await page.unroute(url);
  await page.locator('#review-retry').click();
  await expect(page.locator('#review-modal')).toBeVisible();
  await expect(page.locator('#review-feedback')).toBeHidden();
});

test('a late review failure cannot replace a newer open review', async ({ page }) => {
  const a = await article({ title: 'Delayed review', status: 'pending' });
  const b = await article({ title: 'Current review', status: 'pending' });
  await login(page, editor);
  await page.goto('/editor');
  const held = gate();
  await page.route('**/' + a.id + '/diff', async route => {
    await held.promise;
    await route.fulfill({ status: 503, json: {} });
  });
  try {
    await page.locator('tr', { hasText: a.title }).getByRole('button', { name: 'Review', exact: true }).click();
    await expect(page.locator('#review-message')).toContainText('Loading');
    await openReview(page, b);
    const response = page.waitForResponse(res => res.url().endsWith('/' + a.id + '/diff'));
    held.release();
    await response;
    await expect(page.locator('#review-feedback')).toBeHidden();
    await expect(page.locator('#edit-title')).toHaveValue(b.title);
  } finally { held.release(); }
});

test('analytics replaces an error with the empty state and then a chart', async ({ page }) => {
  const a = await article({ title: 'No views', status: 'published', publishedAt: new Date() });
  const b = await article({ title: 'With views', status: 'published', publishedAt: new Date() });
  await ViewAnalytics.create({ article: b.id, timestampBucket: new Date('2026-10-22T10:00:00Z'), views: 7 });
  await login(page, editor);
  await page.goto('/editor/analytics');
  await page.route('**/api/analytics/' + a.id, route => route.fulfill({ status: 503, json: {} }));
  await page.locator('#article-select').selectOption(a.id);
  await expect(page.locator('#chart-empty')).toContainText('Could not load');
  await page.unroute('**/api/analytics/' + a.id);
  await page.locator('#article-select').selectOption('');
  await page.locator('#article-select').selectOption(a.id);
  await expect(page.locator('#chart-empty')).toHaveText('No view data yet for this article.');
  await expect(page.locator('#chart-summary')).toBeHidden();
  await expect(page.locator('#impactChart')).toBeHidden();
  await page.locator('#article-select').selectOption(b.id);
  await expect(page.locator('#sum-total')).toHaveText('7');
  await expect(page.locator('#impactChart')).toBeVisible();
  await expect(page.locator('#chart-empty')).toBeHidden();
});
