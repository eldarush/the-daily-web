const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
let mongod, app, article, directory;
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-web-audit-'));
  process.env.LOG_DIRECTORY = directory;
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.SESSION_SECRET = 'audit-boundary-test-secret-0123456789';
  process.env.NODE_ENV = 'test';
  await mongoose.connect(process.env.MONGODB_URI);
  app = require('../../app');
  const User = require('../../models/User');
  const author = await User.create({ username: 'audit_boundary', password: 'private-password', fullName: 'Boundary Reporter', role: 'reporter' });
  article = await require('../../models/Article').create({ title: 'Boundary article', summary: 'S', content: 'C', category: 'News', author: author.id, status: 'published' });
});
afterAll(async () => {
  await require('../../config/session').getSessionStore().close();
  await mongoose.disconnect();
  await mongod.stop();
  delete process.env.LOG_DIRECTORY;
  fs.rmSync(directory, { recursive: true, force: true });
});
test('guest comment budget survives signing in and out of the same browser', async () => {
  const browser = request.agent(app);
  await browser.get('/articles/' + article.id);
  for (let i = 0; i < 3; i++) expect((await browser.post('/api/comments').send({ articleId: article.id, authorName: 'Guest', content: 'Comment ' + i })).status).toBe(201);
  await browser.post('/api/auth/login').send({ username: 'audit_boundary', password: 'private-password' });
  await browser.post('/api/auth/logout');
  const blocked = await browser.post('/api/comments').send({ articleId: article.id, authorName: 'Guest', content: 'Fourth comment' });
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
});
test('operations are persisted without credentials, cookies, query strings or article text', async () => {
  await request(app).post('/api/auth/login?secret=private-query').send({ username: 'audit_boundary', password: 'private-password' });
  await request(app).post('/api/comments').send({ articleId: article.id, authorName: 'Private Name', content: 'Private comment body' });
  const file = path.join(directory, 'operations.jsonl');
  expect(fs.existsSync(file)).toBe(true);
  const text = fs.readFileSync(file, 'utf8');
  const entries = text.trim().split('\n').map(line => JSON.parse(line));
  expect(entries.some(e => e.area === 'auth' && e.status === 200)).toBe(true);
  for (const secret of ['private-password', 'private-query', 'Private Name', 'Private comment body', 'connect.sid']) expect(text).not.toContain(secret);
});
test('authentication rotates the guest session identifier', async () => {
  const browser = request.agent(app);
  const guest = await browser.get('/articles/' + article.id);
  const signedIn = await browser.post('/api/auth/login').send({ username: 'audit_boundary', password: 'private-password' });
  const cookie = res => res.headers['set-cookie'].find(value => value.startsWith('connect.sid=')).split(';')[0];
  expect(cookie(signedIn)).not.toBe(cookie(guest));
});

test('forged device signatures cannot spend another browser comment budget', async () => {
  const browser = request.agent(app);
  await browser.get('/articles/' + article.id);
  const first = await browser.post('/api/comments').send({ articleId: article.id, authorName: 'Guest', content: 'First' });
  const cookie = first.headers['set-cookie'].find(value => value.startsWith('daily_web_device='));
  const forged = cookie.split(';')[0].replace(/\.[a-f0-9]{64}$/, '.' + '0'.repeat(64));
  const another = await request(app).post('/api/comments').set('Cookie', forged).send({ articleId: article.id, authorName: 'Other', content: 'Separate browser' });
  expect(another.status).toBe(201);
  expect(another.headers['set-cookie'].find(value => value.startsWith('daily_web_device='))).not.toContain(forged);
});

test('five thousand stored articles preserve deep combined filtering and concurrent view counts', async () => {
  const Article = require('../../models/Article');
  const ViewAnalytics = require('../../models/ViewAnalytics');
  await Article.insertMany(Array.from({ length: 5000 }, (_, i) => ({
    title: 'AUDIT_SCALE ' + i, summary: 'Scale summary', content: 'Scale content',
    category: i % 2 ? 'News' : 'Technology', author: article.author,
    status: 'published', publishedAt: new Date(Date.now() - i * 1000), viewsCount: i
  })));
  const result = await request(app).get('/api/articles?search=AUDIT_SCALE&category=Technology&sort=popularity&page=125');
  expect(result.status).toBe(200);
  expect(result.body.total).toBe(2500);
  expect(result.body.articles).toHaveLength(20);
  expect(result.body.articles[0].viewsCount).toBe(38);
  expect(result.body.articles.every(a => a.category === 'Technology')).toBe(true);
  const before = (await Article.findById(article.id)).viewsCount;
  const visits = await Promise.all(Array.from({ length: 100 }, () => request(app).get('/articles/' + article.id)));
  expect(visits.every(response => response.status === 200)).toBe(true);
  expect((await Article.findById(article.id)).viewsCount).toBe(before + 100);
  const records = await ViewAnalytics.find({ article: article.id });
  expect(records.reduce((sum, bucket) => sum + bucket.views, 0)).toBe(before + 100);
});
