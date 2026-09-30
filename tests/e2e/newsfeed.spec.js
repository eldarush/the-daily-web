const { test, expect } = require('@playwright/test');
const mongoose = require('mongoose');
const User = require('../../models/User');
const Article = require('../../models/Article');

let author;
let articles;

test.beforeAll(async () => {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI to an empty test database before running E2E tests.');
  await mongoose.connect(process.env.MONGODB_URI);
  author = await User.create({ username: 'e2e_feed_author', password: 'password123', fullName: 'Feed Author' });
  articles = await Article.insertMany(Array.from({ length: 65 }, (_, i) => ({
    title: i === 0 ? '<img src=x onerror="window.feedXss=1">' : `Feed demo ${i}`,
    summary: `Feed summary ${i}`, content: 'Full body', author: author._id,
    category: i % 2 === 0 ? 'Technology' : 'Sports', status: 'published',
    viewsCount: i, publishedAt: new Date(Date.now() - i * 60000),
    imageUrl: '/missing-feed-image.jpg'
  })));
});

test.afterAll(async () => {
  if (author) {
    await Article.deleteMany({ author: author._id });
    await User.deleteOne({ _id: author._id });
  }
  await mongoose.disconnect();
});

test('scrolling loads successive batches of 20 and stops at the end', async ({ page }) => {
  await page.goto('/');
  const cards = page.locator('#articles-grid .article-card');
  await expect(cards).toHaveCount(20);
  for (const count of [40, 60, 65]) {
    await page.locator('#infinite-scroll-sentinel').scrollIntoViewIfNeeded();
    await expect(cards).toHaveCount(count);
  }
  await expect(page.locator('#end-of-feed-msg')).toBeVisible();
  await expect(page.locator('#load-more')).toBeHidden();
});

test('search, category, reading filter and sort update without a page navigation', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { window.feedPageMarker = 'same-page'; });
  await page.locator('#feed-search').fill('Feed demo 1');
  await expect(page.locator('#articles-grid .article-card')).toHaveCount(11);
  await page.locator('[data-category="Sports"]').click();
  await expect(page.locator('#articles-grid .article-card')).toHaveCount(6);
  await page.locator('#feed-sort').selectOption('popularity');
  await expect(page.locator('#articles-grid .card-title-link').first()).toHaveText('Feed demo 19');
  await page.locator('#viewed-filter').selectOption('viewed');
  await expect(page.locator('#empty-feed')).toBeVisible();
  expect(await page.evaluate(() => window.feedPageMarker)).toBe('same-page');
});

test('an older response cannot overwrite a more recent category selection', async ({ page }) => {
  await page.goto('/');
  await page.route('**/api/articles?**', async route => {
    if (new URL(route.request().url()).searchParams.get('category') === 'Technology') {
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    await route.continue();
  });
  const oldResponse = page.waitForResponse(res => res.url().includes('category=Technology'));
  await page.locator('[data-category="Technology"]').click();
  await page.locator('[data-category="Sports"]').click();
  await expect(page.locator('#articles-grid .card-category').first()).toHaveText('Sports');
  await oldResponse;
  expect(await page.locator('#articles-grid .card-category').allTextContents()).toEqual(Array(20).fill('Sports'));
});

test('a failed second page can be retried without skipping articles', async ({ page }) => {
  await page.goto('/');
  let failed = false;
  await page.route('**/api/articles?**', async route => {
    if (!failed && new URL(route.request().url()).searchParams.get('page') === '2') {
      failed = true;
      await route.fulfill({ status: 500, json: { error: 'Temporary feed error' } });
    } else {
      await route.continue();
    }
  });
  await page.locator('#infinite-scroll-sentinel').scrollIntoViewIfNeeded();
  await expect(page.locator('#feed-error')).toHaveText('Temporary feed error');
  await expect(page.locator('#articles-grid .article-card')).toHaveCount(20);
  await page.locator('#load-more').click();
  await expect(page.locator('#articles-grid .article-card')).toHaveCount(40);
  await expect(page.locator('#feed-error')).toBeHidden();
});

test('titles remain text in both SSR and AJAX cards and failed images have a fallback', async ({ page }) => {
  await page.goto('/');
  const first = page.locator('#articles-grid .article-card').first();
  await expect(first.locator('.card-title-link')).toHaveText('<img src=x onerror="window.feedXss=1">');
  await expect(first.locator('.card-image')).toBeHidden();
  await page.locator('[data-category="Technology"]').click();
  await expect(page.locator('#articles-grid .card-title-link').first()).toHaveText('<img src=x onerror="window.feedXss=1">');
  expect(await page.evaluate(() => window.feedXss)).toBeUndefined();
  expect(await page.locator('#articles-grid h2 img').count()).toBe(0);
});

test('a successfully opened article is remembered when returning to the feed', async ({ page }) => {
  // Ofir owns the article route; this fixture tests the shared markup contract.
  await page.route(`**/articles/${articles[0].id}`, route => route.fulfill({
    contentType: 'text/html',
    body: `<article class="article-detail-container" data-article-id="${articles[0].id}"><h1>Article</h1></article><script src="/js/newsfeed.js" defer></script>`
  }));
  await page.goto('/');
  await page.locator('#articles-grid .card-title-link').first().click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('the_daily_web_viewed_ids'))).toContain(articles[0].id);
  await page.goBack();
  await page.locator('#viewed-filter').selectOption('viewed');
  await expect(page.locator('#articles-grid .article-card')).toHaveCount(1);
  await expect(page.locator('#articles-grid .read-badge')).toBeVisible();
});

test('malformed or blocked reading storage does not prevent using the feed', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('the_daily_web_viewed_ids', '{broken'));
  await page.goto('/');
  await page.locator('#viewed-filter').selectOption('viewed');
  await expect(page.locator('#empty-feed')).toBeVisible();
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage blocked'); };
  });
  await page.reload();
  await page.locator('[data-category="Sports"]').click();
  await expect(page.locator('#articles-grid .article-card')).toHaveCount(20);
});

test('mobile layout has no horizontal overflow and filters remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('[data-category="Sports"]').click();
  await expect(page.locator('#articles-grid .article-card')).toHaveCount(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('read filtering supports thousands of stored article IDs', async ({ page }) => {
  await page.goto('/');
  const ids = articles.map(article => article.id);
  for (let i = 0; ids.length < 5000; i++) ids.push(i.toString(16).padStart(24, '0'));
  await page.evaluate(history => localStorage.setItem('the_daily_web_viewed_ids', JSON.stringify(history)), ids);
  await page.locator('#viewed-filter').selectOption('viewed');
  await expect(page.locator('#feed-status')).toHaveText('65 articles · 20 shown');
  await expect(page.locator('#articles-grid .article-card')).toHaveCount(20);
  await expect(page.locator('#feed-error')).toBeHidden();
});
