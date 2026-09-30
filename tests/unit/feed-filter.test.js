const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');

let mongod;
let app;
let Article;
let articles;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.SESSION_SECRET = 'feed-test-secret';
  process.env.NODE_ENV = 'test';
  await mongoose.connect(process.env.MONGODB_URI);
  app = require('../../app');
  Article = require('../../models/Article');
  const User = require('../../models/User');
  const author = await User.create({
    username: 'feed_reporter', password: 'password123',
    fullName: 'Feed Reporter', role: 'reporter'
  });
  articles = await Article.insertMany(Array.from({ length: 45 }, (_, i) => ({
    title: i === 0 ? 'News [special] <script>alert(1)</script>' : `Story ${i}`,
    summary: i === 1 ? 'A unique discovery' : `Summary ${i}`,
    content: 'Private full article body',
    category: i % 2 === 0 ? 'Technology' : 'Sports',
    author: author._id, status: 'published', viewsCount: i * 10,
    publishedAt: new Date('2026-09-01T12:00:00Z'),
    pendingUpdate: { hasUpdate: true, title: 'Unapproved secret', content: 'Secret draft' },
    editorNotes: 'Private editor note'
  })));
  await Article.insertMany(['draft', 'pending', 'rejected'].map(status => ({
    title: `Hidden ${status}`, summary: 'Hidden summary', content: 'Hidden body',
    category: 'Technology', author: author._id, status
  })));
});

afterAll(async () => {
  await require('../../config/session').getSessionStore().close();
  await mongoose.disconnect();
  await mongod.stop();
});

test('published articles are paginated into 20, 20 and 5 with no overlap', async () => {
  const pages = [];
  for (let page = 1; page <= 3; page++) {
    const res = await request(app).get('/api/articles').query({ page });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page, limit: 20, total: 45, hasMore: page < 3 });
    expect(res.body.articles).toHaveLength(page === 3 ? 5 : 20);
    pages.push(...res.body.articles.map(article => article._id));
  }
  expect(new Set(pages).size).toBe(45);
});

test('the home HTML contains the first 20 cards with escaped titles', async () => {
  const res = await request(app).get('/');
  expect(res.status).toBe(200);
  expect((res.text.match(/class="article-card" data-article-id="[a-f\d]{24}"/g) || [])).toHaveLength(20);
  expect(res.text).not.toContain('<script>alert(1)</script>');
  expect(res.text).not.toContain('Hidden draft');
});

test('public responses exclude staged edits, full bodies and private author data', async () => {
  const res = await request(app).get('/api/articles');
  for (const article of res.body.articles) {
    expect(article.author.fullName).toBe('Feed Reporter');
    for (const field of ['content', 'pendingUpdate', 'editorNotes', 'status']) {
      expect(article[field]).toBeUndefined();
    }
    expect(article.author.password).toBeUndefined();
    expect(article.author.username).toBeUndefined();
  }
  expect(JSON.stringify(res.body)).not.toContain('Unapproved secret');
});

test('category and popularity filters apply before pagination', async () => {
  const res = await request(app).get('/api/articles?category=Technology&sort=popularity');
  expect(res.body.total).toBe(23);
  expect(res.body.articles).toHaveLength(20);
  expect(res.body.articles.every(article => article.category === 'Technology')).toBe(true);
  expect(res.body.articles[0].viewsCount).toBe(440);
  expect(res.body.articles[19].viewsCount).toBe(60);
});

test.each(['[special]', '<script>', 'UNIQUE discovery'])('search treats %s as literal text', async search => {
  const res = await request(app).get('/api/articles').query({ search });
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(1);
});

test('no matches and pages past the end return an empty result', async () => {
  for (const query of [{ search: 'no-such-title' }, { page: 4 }]) {
    const res = await request(app).get('/api/articles').query(query);
    expect(res.body.articles).toEqual([]);
    expect(res.body.hasMore).toBe(false);
  }
});

test('read and unread IDs combine correctly with category, search and sorting', async () => {
  const viewedIds = articles.slice(0, 30).map(article => article.id).join(',');
  const read = await request(app).get('/api/articles').query({ viewedFilter: 'viewed', viewedIds });
  expect(read.body.total).toBe(30);
  expect(read.body.articles).toHaveLength(20);
  const unread = await request(app).get('/api/articles').query({
    viewedFilter: 'unviewed', viewedIds, category: 'Technology', search: 'Story', sort: 'popularity'
  });
  expect(unread.body.total).toBe(8);
  expect(unread.body.articles.every(article => article.viewsCount >= 300)).toBe(true);
  expect(unread.body.articles[0].viewsCount).toBe(440);
});

test('empty reading history means zero read articles and all unread articles', async () => {
  const read = await request(app).get('/api/articles?viewedFilter=viewed');
  expect(read.body.total).toBe(0);
  expect(read.body.articles).toEqual([]);
  const unread = await request(app).get('/api/articles?viewedFilter=unviewed');
  expect(unread.body.total).toBe(45);
});

test.each([
  { page: '0' }, { page: '-1' }, { page: '1.5' }, { page: 'abc' },
  { page: '9007199254740992' }, { limit: '50' }, { category: 'Unknown' },
  { sort: 'random' }, { viewedFilter: 'unknown' },
  { viewedFilter: 'viewed', viewedIds: 'not-an-id' },
  { search: 'x'.repeat(101) }, { search: ['one', 'two'] }
])('invalid parameters return 400: %j', async query => {
  const res = await request(app).get('/api/articles').query(query);
  expect(res.status).toBe(400);
  expect(res.body.error).toEqual(expect.any(String));
});

test('a database failure returns an error page instead of crashing the home route', async () => {
  const spy = jest.spyOn(Article, 'countDocuments').mockRejectedValueOnce(new Error('Temporary database failure'));
  const res = await request(app).get('/');
  spy.mockRestore();
  expect(res.status).toBe(500);
  expect(res.text).toContain('Temporary database failure');
  const recovered = await request(app).get('/');
  expect(recovered.status).toBe(200);
});
