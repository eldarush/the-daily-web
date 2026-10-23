const { test, expect } = require('@playwright/test');
const mongoose = require('mongoose');
const User = require('../../models/User');
const Article = require('../../models/Article');
const ViewAnalytics = require('../../models/ViewAnalytics');
let reporter, editor, articles;

test.beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  reporter = await User.create({ username: 'integration_reporter', password: 'password123', fullName: 'Integration Reporter', role: 'reporter' });
  editor = await User.create({ username: 'integration_editor', password: 'password123', fullName: 'Integration Editor', role: 'editor' });
  articles = await Article.insertMany(Array.from({ length: 25 }, (_, i) => ({ title: 'Integration headline ' + i, summary: 'Summary ' + i, content: 'Approved full article ' + i, category: 'News', author: reporter._id, status: 'published', publishedAt: new Date(Date.now() - i * 3600000) })));
  await ViewAnalytics.create({ article: articles[24]._id, timestampBucket: new Date('2026-10-08T12:00:00Z'), views: 15 });
});
test.afterAll(async () => {
  await ViewAnalytics.deleteMany({ article: { $in: articles.map(a => a._id) } });
  await Article.deleteMany({ author: reporter._id });
  await User.deleteMany({ _id: { $in: [reporter._id, editor._id] } });
  await mongoose.disconnect();
});

test('real feed cards open SSR articles and integrate viewed/unviewed filters', async ({ page, browser, baseURL }) => {
  await page.goto('/');
  const card = page.locator('.article-card').first();
  const id = await card.getAttribute('data-article-id');
  await card.locator('.card-title-link').click();
  await expect(page.locator('.article-content')).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('the_daily_web_viewed_ids')))).toContain(id);
  await page.goto('/');
  await page.locator('#viewed-filter').selectOption('viewed');
  await expect(page.locator('.article-card')).toHaveCount(1);
  expect(await page.locator('.article-card').getAttribute('data-article-id')).toBe(id);
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const noScript = await context.newPage();
    await noScript.goto('/articles/' + id);
    await expect(noScript.locator('.article-content')).toContainText('Approved full article');
  } finally { await context.close(); }
});

test('analytics selector reaches articles beyond first20 and draws their timeline', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { username: editor.username, password: 'password123' } });
  expect(login.ok()).toBeTruthy();
  await page.goto('/editor/analytics');
  await expect(page.locator('#article-select option')).toHaveCount(21);
  await page.locator('#article-select').selectOption({ index: 20 });
  await page.locator('#articles-next').click();
  await expect(page.locator('#articles-page')).toHaveText('Page 2');
  await expect(page.locator('#article-select option:checked')).toHaveText(articles[20].title);
  await page.locator('#article-select').selectOption(articles[24].id);
  await expect(page.locator('#chart-summary')).toBeVisible();
  await expect(page.locator('#sum-total')).toHaveText('15');
  // last article overall, nothing after it
  await expect(page.locator('#articles-next')).toBeDisabled();
});

test('analytics Previous and Next step one article at a time and the chart follows', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { username: editor.username, password: 'password123' } });
  expect(login.ok()).toBeTruthy();
  await page.goto('/editor/analytics');
  const chosen = page.locator('#article-select option:checked');
  await expect(page.locator('#articles-previous')).toBeDisabled();
  // nothing chosen yet: Next picks the newest article
  await page.locator('#articles-next').click();
  await expect(chosen).toHaveText(articles[0].title);
  await expect(page.locator('#articles-previous')).toBeDisabled();
  await page.locator('#articles-next').click();
  await expect(chosen).toHaveText(articles[1].title);
  await page.locator('#articles-previous').click();
  await expect(chosen).toHaveText(articles[0].title);
  // across the page boundary, both ways
  await page.locator('#article-select').selectOption({ index: 20 });
  await expect(chosen).toHaveText(articles[19].title);
  await page.locator('#articles-next').click();
  await expect(page.locator('#articles-page')).toHaveText('Page 2');
  await expect(chosen).toHaveText(articles[20].title);
  await page.locator('#articles-previous').click();
  await expect(page.locator('#articles-page')).toHaveText('Page 1');
  await expect(chosen).toHaveText(articles[19].title);
  // only the last article has views
  await page.locator('#articles-next').click();
  await page.locator('#article-select').selectOption(articles[24].id);
  await expect(page.locator('#sum-total')).toHaveText('15');
  await page.locator('#articles-previous').click();
  await expect(chosen).toHaveText(articles[23].title);
  await expect(page.locator('#chart-summary')).toBeHidden();
  await page.locator('#articles-next').click();
  await expect(chosen).toHaveText(articles[24].title);
  await expect(page.locator('#sum-total')).toHaveText('15');
});

test('weather expires on screen at the observation deadline', async ({ page }) => {
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  await page.route('**/api/weather', route => route.fulfill({ json: { temp: 22, description: 'Cloudy', city: 'Tel Aviv', observedAt: new Date(now - 14 * 60 * 1000).toISOString(), fetchedAt: new Date(now).toISOString(), cached: true } }));
  await page.goto('/');
  await expect(page.locator('#weather-temp')).toHaveText('22°C');
  await page.clock.fastForward(60001);
  await expect(page.locator('#weather-temp')).toHaveText('—');
  await expect(page.locator('#weather-cache-status')).toHaveText('Unavailable');
});
