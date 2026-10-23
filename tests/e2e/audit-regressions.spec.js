const { test, expect } = require('@playwright/test');
const mongoose = require('mongoose');
const User = require('../../models/User');
const Article = require('../../models/Article');
const ViewAnalytics = require('../../models/ViewAnalytics');
let reporter, editor;

test.beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  reporter = await User.create({ username: 'audit_reporter', password: 'password123', fullName: 'Audit Reporter', role: 'reporter' });
  editor = await User.create({ username: 'audit_editor', password: 'password123', fullName: 'Audit Editor', role: 'editor' });
});
test.afterAll(async () => {
  const ids = await Article.find({ author: reporter._id }).distinct('_id');
  await ViewAnalytics.deleteMany({ article: { $in: ids } });
  await Article.deleteMany({ author: reporter._id });
  await User.deleteMany({ _id: { $in: [reporter._id, editor._id] } });
  await mongoose.disconnect();
});
async function article(fields = {}) {
  return Article.create({ title: 'Audit article', summary: 'Summary', content: 'Original body', category: 'News', author: reporter._id, ...fields });
}
async function login(page, user) {
  await page.request.post('/api/auth/login', { data: { username: user.username, password: 'password123' } });
}
async function review(page, a) {
  await login(page, editor);
  await page.goto('/editor');
  await page.locator('tr', { hasText: a.title }).getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.locator('#review-modal')).toBeVisible();
}

test('immediate sign out waits for autosave, including failure and a fresh browser', async ({ page, browser, baseURL }) => {
  const a = await article({ title: 'Logout regression' });
  await login(page, reporter);
  await page.goto('/workspace');
  await page.locator(`[data-id="${a.id}"]`).click();
  await page.route('**/autosave', route => route.fulfill({ status: 503, json: { error: 'Audit save unavailable' } }));
  await page.locator('#article-content').fill('Last edit before sign out');
  await page.locator('#logout-btn').click();
  await expect(page.locator('#autosave-badge')).toContainText('Audit save unavailable');
  await expect(page).toHaveURL(/workspace$/);
  await page.unroute('**/autosave');
  await page.locator('#logout-btn').click();
  await expect(page).toHaveURL(/login$/);
  const fresh = await browser.newContext({ baseURL });
  try {
    const other = await fresh.newPage();
    await login(other, reporter);
    await other.goto('/workspace');
    await other.locator(`[data-id="${a.id}"]`).click();
    await expect(other.locator('#article-content')).toHaveValue('Last edit before sign out');
  } finally { await fresh.close(); }
});

test('approval saves the displayed editor changes and stops on failed save', async ({ page }) => {
  const a = await article({ title: 'Approval regression', status: 'pending' });
  await review(page, a);
  await expect(page.locator('#btn-save-edit')).toBeHidden();
  await page.locator('#btn-edit').click();
  await expect(page.locator('#btn-edit')).toBeHidden();
  await page.locator('#edit-title').fill('Edited and approved');
  await page.route('**/api/editor/articles/' + a.id, route => route.fulfill({ status: 503, json: { error: 'Audit edit unavailable' } }));
  await page.locator('#btn-approve').click();
  await expect(page.locator('#modal-status')).toContainText('Audit edit unavailable');
  expect((await Article.findById(a.id)).status).toBe('pending');
  await page.unroute('**/api/editor/articles/' + a.id);
  await page.locator('#btn-approve').click();
  await expect(page.locator('#review-modal')).toBeHidden();
  const saved = await Article.findById(a.id);
  expect(saved.title).toBe('Edited and approved');
  expect(saved.status).toBe('published');
});

test('Ajax cards retain valid images after filtering and additional batches', async ({ page }) => {
  await Article.insertMany(Array.from({ length: 25 }, (_, i) => ({ title: 'Image regression ' + i, summary: 'S', content: 'C', category: 'Technology', author: reporter._id, status: 'published', publishedAt: new Date() })));
  await page.goto('/');
  await page.locator('#feed-search').fill('Image regression');
  await expect(page.locator('#feed-status')).toHaveText('25 articles · 20 shown');
  await expect(page.locator('.article-card')).toHaveCount(20);
  const image = page.locator('.card-image').first();
  await expect.poll(() => image.evaluate(e => e.naturalWidth)).toBeGreaterThan(0);
  await expect(image).toBeVisible();
  await page.locator('#infinite-scroll-sentinel').scrollIntoViewIfNeeded();
  await expect(page.locator('.article-card')).toHaveCount(25);
  await expect(page.locator('.card-image').last()).toBeVisible();
});

test('revision review compares both category and image and safely handles long text', async ({ page }) => {
  const body = 'A long paragraph with useful words. '.repeat(100);
  const a = await article({ title: 'Metadata regression', content: body, status: 'published', publishedAt: new Date(), imageUrl: '/images/default-article.jpg?live=1', pendingUpdate: { hasUpdate: true, status: 'pending', title: 'Metadata regression', summary: 'Summary', content: body + '<script>unsafe()</script>', category: 'Health', imageUrl: '/images/default-article.jpg?proposed=1' } });
  await review(page, a);
  await expect(page.locator('#diff-live')).toContainText('News');
  await expect(page.locator('#diff-live')).toContainText('?live=1');
  await expect(page.locator('#diff-pending')).toContainText('Health');
  await expect(page.locator('#diff-pending')).toContainText('?proposed=1');
  await expect(page.locator('#diff-pending')).toContainText('<script>unsafe()</script>');
  await expect(page.locator('#diff-pending script')).toHaveCount(0);
});

test('review window keeps its buttons in view and says why Approve is off', async ({ page }) => {
  const body = 'A long paragraph with useful words. '.repeat(100);
  const revision = status => ({ hasUpdate: true, status, editorNotes: 'Needs sources', title: 'Review buttons ' + status, summary: 'Summary', content: body + ' revised', category: 'News', imageUrl: '/images/default-article.jpg' });
  const rejected = await article({ title: 'Review buttons rejected', content: body, status: 'published', publishedAt: new Date(), pendingUpdate: revision('rejected') });
  const pending = await article({ title: 'Review buttons pending', content: body, status: 'published', publishedAt: new Date(), pendingUpdate: revision('pending') });
  const openReview = a => page.locator('tr', { hasText: a.title }).getByRole('button', { name: 'Review', exact: true }).click();

  // a returned revision can't be approved, and the window says so
  await review(page, rejected);
  await expect(page.locator('#btn-approve')).toBeDisabled();
  await expect(page.locator('#btn-approve')).toHaveCSS('opacity', '0.45');
  await expect(page.locator('#modal-status')).toContainText('Returned to the reporter');
  await expect(page.locator('#btn-approve')).toBeInViewport();
  // only the article scrolls, and it ends where the buttons start, so they never cover its text
  const box = async sel => page.locator(sel).boundingBox();
  expect(await page.locator('.modal-body').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  expect((await box('.modal-body')).y + (await box('.modal-body')).height).toBeLessThanOrEqual((await box('.modal-actions')).y + 1);
  await page.locator('#modal-close').click();

  // a submitted one: one click on Return opens the notes box without scrolling anywhere
  await openReview(pending);
  await expect(page.locator('#btn-reject')).toBeInViewport();
  await page.locator('#btn-reject').click();
  await expect(page.locator('#reject-box')).toBeInViewport();
  await expect(page.locator('#btn-reject')).toBeInViewport();
  await expect(page.locator('#modal-status')).toContainText('click again');
  await page.locator('#reject-notes').fill('Please add sources');
  await page.locator('#btn-reject').click();
  await expect(page.locator('#review-modal')).toBeHidden();
  expect((await Article.findById(pending.id)).pendingUpdate.status).toBe('rejected');
});

test('reporter editor gets the width, even next to long titles', async ({ page }) => {
  const a = await article({ title: 'A very long headline that would once stretch the list and squeeze the editor beside it', status: 'published', publishedAt: new Date(), pendingUpdate: { hasUpdate: true, status: 'draft', title: 'Revised', summary: 'Summary', content: 'Body', category: 'News', imageUrl: '/images/default-article.jpg' } });
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, reporter);
  await page.goto('/workspace');
  await page.locator(`[data-id="${a.id}"]`).click();
  const list = await page.locator('.article-list-panel').boundingBox();
  const editorPanel = await page.locator('.editor-panel').boundingBox();
  expect(list.width).toBeLessThanOrEqual(300);
  expect(editorPanel.width).toBeGreaterThan(2 * list.width);
  // the weather card moves below the editor instead of taking a column
  expect((await page.locator('#site-sidebar').boundingBox()).y).toBeGreaterThan(editorPanel.y + editorPanel.height);
});

test('editor edits only submitted work, and the reporter sees those edits marked', async ({ page }) => {
  const draft = await article({ title: 'Still with the reporter', status: 'draft' });
  await review(page, draft);
  await expect(page.locator('#btn-edit')).toBeDisabled();
  await expect(page.locator('#modal-status')).toContainText('Approve, Return and Edit are off');
  await page.locator('#modal-close').click();

  const a = await article({ title: 'Bike lanes open', status: 'pending', content: 'Riders said the lanes feel safe and fast.' });
  await review(page, a);
  await expect(page.locator('#btn-edit')).toBeEnabled();
  await page.locator('#btn-edit').click();
  await page.locator('#edit-content').fill('Riders said the protected lanes feel safe.');
  await page.locator('#btn-save-edit').click();
  await expect.poll(async () => (await Article.findById(a.id)).content).toBe('Riders said the protected lanes feel safe.');
  await page.request.post(`/api/editor/articles/${a.id}/reject`, { data: { notes: 'Add a quote' } });

  await login(page, reporter);
  await page.goto('/workspace');
  await page.locator(`[data-id="${a.id}"]`).click();
  const changes = page.locator('#editor-changes');
  await expect(changes).toBeVisible();
  await expect(changes.locator('.change-label')).toHaveText(['Content']);
  await expect(changes.locator('ins.diff-add', { hasText: 'protected' })).toHaveCSS('font-weight', '700');
  await expect(changes.locator('del.diff-del', { hasText: 'fast.' })).toBeVisible();
  await expect(page.locator('#rejection-notes')).toHaveText('Add a quote');

  // once resubmitted, the next review starts clean
  await page.locator('#submit-article-btn').click();
  await expect(changes).toBeHidden();
});

test('analytics draws a single-hour point and clears stale results on pagination', async ({ page }) => {
  await Article.insertMany(Array.from({ length: 21 }, (_, i) => ({ title: 'Chart page fixture ' + i, summary: 'S', content: 'C', category: 'News', author: reporter._id, status: 'published', publishedAt: new Date(Date.now() - 3600000) })));
  // dated ahead of everything else, so these two are always first and second in the picker
  const a = await article({ title: 'Single hour regression', status: 'published', publishedAt: new Date(Date.now() + 120000) });
  await article({ title: 'Single hour neighbour', status: 'published', publishedAt: new Date(Date.now() + 60000) });
  await ViewAnalytics.create({ article: a.id, timestampBucket: new Date('2026-10-22T10:00:00Z'), views: 103 });
  await login(page, editor);
  await page.goto('/editor/analytics');
  await page.locator('#article-select').selectOption(a.id);
  await expect(page.locator('#sum-total')).toHaveText('103');
  const painted = await page.locator('canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 43 && pixels[i + 1] === 108 && pixels[i + 2] === 176 && pixels[i + 3] > 200) count++;
    return count;
  });
  expect(painted).toBeGreaterThan(10);
  // next article has no views, so the old chart must go
  await page.locator('#articles-next').click();
  await expect(page.locator('#article-select option:checked')).toHaveText('Single hour neighbour');
  await expect(page.locator('#chart-summary')).toBeHidden();
  await expect(page.locator('canvas')).toBeHidden();
  await expect(page.locator('#chart-empty')).toBeVisible();
  // stepping past the last article of page 1 loads page 2
  await page.locator('#article-select').selectOption({ index: 20 });
  await page.locator('#articles-next').click();
  await expect(page.locator('#articles-page')).toHaveText('Page 2');
  await expect(page.locator('#chart-summary')).toBeHidden();
  await expect(page.locator('canvas')).toBeHidden();
});

test('analytics shows zero-view hours between stored counters', async ({ page }) => {
  const a = await article({ title: 'Zero hour regression', status: 'published', publishedAt: new Date() });
  await ViewAnalytics.insertMany([
    { article: a.id, timestampBucket: new Date('2026-10-22T10:00:00Z'), views: 10 },
    { article: a.id, timestampBucket: new Date('2026-10-22T12:00:00Z'), views: 10 }
  ]);
  await login(page, editor);
  await page.goto('/editor/analytics');
  await page.locator('#article-select').selectOption(a.id);
  await expect(page.locator('#sum-total')).toHaveText('20');
  const rect = await page.locator('canvas').boundingBox();
  await page.mouse.move(rect.x + rect.width * 464 / 900, rect.y + rect.height * 334 / 380);
  await expect(page.locator('#chart-tooltip')).toContainText('0 views');
});
