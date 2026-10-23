const { test, expect } = require('@playwright/test');
const mongoose = require('mongoose');
const User = require('../../models/User');
const Article = require('../../models/Article');
const ViewAnalytics = require('../../models/ViewAnalytics');
let reporter, editor;
test.beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  reporter = await User.create({ username: 'explore_reporter', password: 'password123', fullName: 'Explore Reporter', role: 'reporter' });
  editor = await User.create({ username: 'explore_editor', password: 'password123', fullName: 'Explore Editor', role: 'editor' });
});
test.afterEach(async () => {
  const ids = await Article.find({ author: reporter.id }).distinct('_id');
  await ViewAnalytics.deleteMany({ article: { $in: ids } });
  await Article.deleteMany({ author: reporter.id });
});
test.afterAll(async () => {
  await User.deleteMany({ _id: { $in: [reporter.id, editor.id] } });
  await mongoose.disconnect();
});
async function create(fields) {
  return Article.create({ title: 'Exploratory article', summary: 'Summary', content: 'Body', category: 'News', author: reporter.id, ...fields });
}
async function login(page, user) {
  await page.request.post('/api/auth/login', { data: { username: user.username, password: 'password123' } });
}

test('a corrupt recovery record does not prevent opening and saving an article', async ({ page }) => {
  const a = await create({ title: 'Corrupt backup' });
  await login(page, reporter);
  await page.addInitScript(id => localStorage.setItem('autosave_' + id, '{"stamp":9999999999999,"data":null}'), a.id);
  await page.goto('/workspace');
  await page.locator(`[data-id="${a.id}"]`).click();
  await expect(page.locator('#article-content')).toHaveValue('Body');
  await page.locator('#article-content').fill('Recovered editing');
  await expect.poll(async () => (await Article.findById(a.id)).content).toBe('Recovered editing');
});

test('closing a saving review cannot approve a different article', async ({ page }) => {
  const a = await create({ title: 'Saving article A', status: 'pending' });
  const b = await create({ title: 'Untouched article B', status: 'pending' });
  await login(page, editor);
  await page.goto('/editor');
  await page.locator('tr', { hasText: a.title }).getByRole('button', { name: 'Review' }).click();
  await page.locator('#btn-edit').click();
  await page.locator('#edit-title').fill('A changed');
  let release, arrived;
  const intercepted = new Promise(resolve => { arrived = resolve; });
  await page.route('**/api/editor/articles/' + a.id, async route => {
    const response = await route.fetch();
    await new Promise(resolve => { release = () => resolve(); arrived(); });
    await route.fulfill({ response });
  });
  await page.locator('#btn-approve').click();
  await intercepted;
  await page.locator('#modal-close').click();
  await page.locator('tr', { hasText: b.title }).getByRole('button', { name: 'Review' }).click();
  await expect(page.locator('#btn-edit')).toBeEnabled();
  release();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#edit-title')).toHaveValue(b.title);
  await expect(page.locator('#modal-status')).toHaveText('pending');
  expect((await Article.findById(b.id)).status).toBe('pending');
  await page.unroute('**/api/editor/articles/' + a.id);
});

test('an older analytics response cannot replace the selected article', async ({ page }) => {
  const a = await create({ title: 'Slow chart A', status: 'published', publishedAt: new Date() });
  const b = await create({ title: 'Fast chart B', status: 'published', publishedAt: new Date() });
  await ViewAnalytics.insertMany([a, b].map((article, i) => ({ article: article.id, timestampBucket: new Date('2026-10-22T10:00:00Z'), views: i + 1 })));
  await login(page, editor);
  let release, arrived;
  const intercepted = new Promise(resolve => { arrived = resolve; });
  await page.route('**/api/analytics/' + a.id, async route => {
    const response = await route.fetch();
    await new Promise(resolve => { release = resolve; arrived(); });
    await route.fulfill({ response });
  });
  await page.goto('/editor/analytics');
  await page.locator('#article-select').selectOption(a.id);
  await intercepted;
  await page.locator('#article-select').selectOption(b.id);
  await expect(page.locator('#sum-total')).toHaveText('2');
  release();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#sum-total')).toHaveText('2');
  await page.unroute('**/api/analytics/' + a.id);
});

test('mobile pointer navigation opens the article and records its reading state', async ({ page }) => {
  const a = await create({ title: 'Exploratory mobile pointer navigation', status: 'published', publishedAt: new Date() });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('link', { name: a.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/articles/' + a.id + '$'));
  await expect(page.locator('.article-content')).toContainText('Body');
  await page.getByRole('link', { name: 'Newsfeed', exact: true }).click();
  await page.locator('#viewed-filter').selectOption('viewed');
  await expect(page.locator('.article-card')).toHaveCount(1);
  expect(await page.locator('.article-card').getAttribute('data-article-id')).toBe(a.id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a slow status-filter response cannot replace the latest editor table', async ({ page }) => {
  const pending = await create({ title: 'Slow pending table', status: 'pending' });
  const published = await create({ title: 'Current published table', status: 'published', publishedAt: new Date() });
  await login(page, editor);
  await page.goto('/editor');
  await expect(page.locator('tr', { hasText: pending.title })).toBeVisible();
  let release, arrived;
  const intercepted = new Promise(resolve => { arrived = resolve; });
  await page.route('**/api/editor/articles?*', async route => {
    if (new URL(route.request().url()).searchParams.get('status') !== 'pending') return route.continue();
    const response = await route.fetch();
    await new Promise(resolve => { release = resolve; arrived(); });
    await route.fulfill({ response });
  });
  await page.locator('#status-filter').selectOption('pending');
  await intercepted;
  await page.locator('#status-filter').selectOption('published');
  await expect(page.locator('tr', { hasText: pending.title })).toHaveCount(0);
  await expect(page.locator('tr', { hasText: published.title })).toBeVisible();
  const lateResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get('status') === 'pending');
  release();
  await (await lateResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('tr', { hasText: published.title })).toBeVisible();
  await expect(page.locator('tr', { hasText: pending.title })).toHaveCount(0);
});

test('repeated approval clicks send one mutation while the first is in flight', async ({ page }) => {
  const a = await create({ title: 'Repeated approval', status: 'pending' });
  await login(page, editor);
  await page.goto('/editor');
  await page.locator('tr', { hasText: a.title }).getByRole('button', { name: 'Review' }).click();
  let release, arrived, requests = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const intercepted = new Promise(resolve => { arrived = resolve; });
  await page.route('**/api/editor/articles/' + a.id + '/approve', async route => {
    requests++;
    arrived();
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.locator('#btn-approve').click();
  await intercepted;
  await page.locator('#btn-approve').click();
  release();
  await page.waitForLoadState('networkidle');
  expect(requests).toBe(1);
  expect((await Article.findById(a.id)).status).toBe('published');
});

for (const action of ['approve', 'save-edit']) {
  test(`${action} freezes its edit snapshot and restores editing after failure`, async ({ page }) => {
    const a = await create({ title: 'Frozen edit snapshot', status: 'pending' });
    await login(page, editor);
    await page.goto('/editor');
    await page.locator('tr', { hasText: a.title }).getByRole('button', { name: 'Review' }).click();
    await page.locator('#btn-edit').click();
    await page.locator('#edit-title').fill('Confirmed snapshot');
    let release, arrived;
    const gate = new Promise(resolve => { release = resolve; });
    const intercepted = new Promise(resolve => { arrived = resolve; });
    await page.route('**/api/editor/articles/' + a.id, async route => {
      arrived();
      await gate;
      await route.fulfill({ status: 503, json: { error: 'Delayed save unavailable' } });
    });
    await page.locator('#btn-' + action).click();
    await intercepted;
    try {
      await expect(page.locator('#edit-title')).toBeDisabled();
      await expect(page.locator('#edit-content')).toBeDisabled();
      await expect(page.locator('#btn-edit')).toBeDisabled();
    } finally { release(); }
    await expect(page.locator('#modal-status')).toHaveText('Delayed save unavailable');
    await expect(page.locator('#edit-title')).toBeEditable();
    await expect(page.locator('#edit-title')).toHaveValue('Confirmed snapshot');
    expect((await Article.findById(a.id)).status).toBe('pending');
    await page.unroute('**/api/editor/articles/' + a.id);
    await page.locator('#edit-title').fill('Retried snapshot');
    let finish;
    const savedResponse = new Promise(resolve => { arrived = resolve; });
    await page.route('**/api/editor/articles/' + a.id, async route => {
      const response = await route.fetch();
      await new Promise(resolve => { finish = resolve; arrived(); });
      await route.fulfill({ response });
    });
    await page.locator('#btn-' + action).click();
    await savedResponse;
    try { await expect(page.locator('#edit-title')).toBeDisabled(); }
    finally { finish(); }
    await expect(page.locator('#review-modal')).toBeHidden();
    const saved = await Article.findById(a.id);
    expect(saved.title).toBe('Retried snapshot');
    expect(saved.status).toBe(action === 'approve' ? 'published' : 'pending');
  });
}

test('sign-out blocks workspace interaction until logout finishes and restores it on failure', async ({ page }) => {
  const a = await create({ title: 'Frozen sign-out snapshot' });
  await login(page, reporter);
  await page.goto('/workspace');
  await page.locator(`[data-id="${a.id}"]`).click();
  await page.locator('#article-content').fill('Confirmed before logout');
  let release, arrived;
  let fail = true;
  const intercepted = new Promise(resolve => { arrived = resolve; });
  await page.route('**/api/auth/logout', async route => {
    const response = !fail ? await route.fetch() : null;
    await new Promise(resolve => { release = resolve; arrived(); });
    if (response) await route.fulfill({ response });
    else await route.fulfill({ status: 503, json: { error: 'Logout unavailable' } });
  });
  await page.locator('#logout-btn').click();
  await intercepted;
  try {
    await expect(page.locator('main')).toHaveAttribute('inert', '');
    await page.keyboard.type('Unconfirmed keystrokes');
    await expect(page.locator('#article-content')).toHaveValue('Confirmed before logout');
    expect((await Article.findById(a.id)).content).toBe('Confirmed before logout');
  } finally { release(); }
  await expect(page.locator('#logout-btn')).toBeEnabled();
  await expect(page.locator('main')).not.toHaveAttribute('inert');
  await page.locator('#article-content').fill('Retried logout content');
  fail = false;
  const loggedOut = new Promise(resolve => { arrived = resolve; });
  await page.locator('#logout-btn').click();
  await loggedOut;
  try {
    await expect(page.locator('main')).toHaveAttribute('inert', '');
    await page.keyboard.type('Post-session keystrokes');
    await expect(page.locator('#article-content')).toHaveValue('Retried logout content');
  } finally { release(); }
  await expect(page).toHaveURL(/login$/);
  expect((await Article.findById(a.id)).content).toBe('Retried logout content');
});
