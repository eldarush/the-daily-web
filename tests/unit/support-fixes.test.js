const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod, app, User, Article, ViewAnalytics, editor, agent;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.SESSION_SECRET = 'isolated-support-test-secret-key';
  process.env.NODE_ENV = 'test';
  await mongoose.connect(process.env.MONGODB_URI);
  app = require('../../app');
  User = require('../../models/User');
  Article = require('../../models/Article');
  ViewAnalytics = require('../../models/ViewAnalytics');
  editor = await User.create({ username: 'support_editor', password: 'password123', fullName: 'Support Editor', role: 'editor' });
  agent = request.agent(app);
  await agent.post('/api/auth/login').send({ username: editor.username, password: 'password123' });
});

afterAll(async () => {
  await require('../../config/session').getSessionStore().close();
  await mongoose.disconnect();
  await mongod.stop();
});

test('editor bucket CRUD keeps totals consistent and guests cannot change statistics', async () => {
  const article = await Article.create({ title: 'Statistics', summary: 'Summary', content: 'Content', category: 'News', author: editor._id, status: 'published' });
  const url = '/api/analytics/' + article._id + '/buckets';
  const body = { time: '2026-10-08T12:00:00.000Z', views: 7 };
  expect((await request(app).put(url).send(body)).status).toBe(401);
  expect((await agent.put(url).send(body)).status).toBe(200);
  expect((await Article.findById(article._id)).viewsCount).toBe(7);
  expect((await agent.put(url).send({ ...body, views: 3 })).status).toBe(200);
  expect((await Article.findById(article._id)).viewsCount).toBe(3);
  expect((await agent.get('/api/analytics/' + article._id)).body.timeline).toHaveLength(1);
  expect((await agent.delete('/api/analytics/' + article._id)).status).toBe(200);
  expect(await ViewAnalytics.countDocuments({ article: article._id })).toBe(0);
  expect((await Article.findById(article._id)).viewsCount).toBe(0);
});

test('analytics article selection is paginated and excludes full content', async () => {
  await Article.insertMany(Array.from({ length: 25 }, (_, i) => ({ title: 'Selectable ' + i, summary: 'Summary', content: 'Private heavy content', category: 'News', author: editor._id, status: 'published' })));
  const res = await agent.get('/api/analytics/articles?page=2');
  expect(res.status).toBe(200);
  expect(res.body.articles.length).toBeGreaterThan(0);
  expect(res.body.articles[0].content).toBeUndefined();
});

describe('weather freshness and request sharing', () => {
  let controller;
  const realFetch = global.fetch;
  const reply = () => ({ current: { time: Math.floor(Date.now() / 1000), temperature_2m: 21.5, weather_code: 0 } });
  const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
  beforeEach(() => { controller = require('../../controllers/weatherController'); controller.resetWeatherCache(); });
  afterEach(() => { global.fetch = realFetch; controller.resetWeatherCache(); jest.restoreAllMocks(); });

  test('cold concurrent callers share one provider request and warm callers keep the fetch timestamp', async () => {
    global.fetch = jest.fn().mockImplementation(async () => ({ ok: true, json: async () => reply() }));
    const responses = Array.from({ length: 20 }, response);
    await Promise.all(responses.map(res => controller.getWeather({}, res, jest.fn())));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const first = responses[0].json.mock.calls[0][0];
    expect(first.temp).toBe(22);
    expect(first.observedAt).toBeDefined();
    const res = response();
    await controller.getWeather({}, res, jest.fn());
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0].fetchedAt).toBe(first.fetchedAt);
  });

  test('provider failure returns unavailable instead of invented weather', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Offline'));
    const res = response();
    await controller.getWeather({}, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0].temp).toBeUndefined();
  });

  test('old provider observations are never presented as current', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ current: { ...reply().current, time: Math.floor(Date.now() / 1000) - 901 } }) });
    const res = response();
    await controller.getWeather({}, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(503);
  });
});

test('concurrent first views create one hour bucket without lost increments', async () => {
  const controller = require('../../controllers/analyticsController');
  await ViewAnalytics.init();
  const article = await Article.create({ title: 'Cold views', summary: 'Summary', content: 'Content', category: 'News', author: editor._id, status: 'published' });
  await Promise.all(Array.from({ length: 100 }, () => controller.recordView(article.id)));
  const buckets = await ViewAnalytics.find({ article: article._id });
  expect(buckets).toHaveLength(1);
  expect(buckets[0].views).toBe(100);
  expect((await Article.findById(article._id)).viewsCount).toBe(100);
});

test('analytics management validates IDs, pages, hour boundaries and count types', async () => {
  const missingId = new mongoose.Types.ObjectId();
  for (const page of ['0', 'abc', '1.5']) {
    expect((await agent.get('/api/analytics/articles?page=' + page)).status).toBe(400);
  }
  expect((await agent.get('/api/analytics/articles')).status).toBe(200);
  const article = await Article.create({ title: 'Validation', summary: 'Summary', content: 'Content', category: 'News', author: editor._id });
  const url = '/api/analytics/' + article.id + '/buckets';
  for (const body of [{}, { time: 1, views: 2 }, { time: 'bad', views: 2 }, { time: '2026-10-08T12:01:00Z', views: 2 }, { time: '2026-10-08T12:00:00Z', views: '2' }, { time: '2026-10-08T12:00:00Z', views: -1 }]) {
    expect((await agent.put(url).send(body)).status).toBe(400);
  }
  expect((await agent.put('/api/analytics/bad/buckets').send({})).status).toBe(400);
  expect((await agent.delete('/api/analytics/bad')).status).toBe(400);
  expect((await agent.delete('/api/analytics/' + missingId)).status).toBe(404);
  expect((await agent.put('/api/analytics/' + missingId + '/buckets').send({ time: '2026-10-08T12:00:00Z', views: 1 })).status).toBe(404);
});

test('analytics storage failures are passed to the shared handler', async () => {
  const controller = require('../../controllers/analyticsController');
  const err = new Error('Database unavailable');
  const next = jest.fn();
  const id = new mongoose.Types.ObjectId().toString();
  const req = { params: { articleId: id }, body: { time: '2026-10-08T12:00:00Z', views: 1 }, query: {} };
  try {
    jest.spyOn(Article, 'find').mockImplementation(() => { throw err; });
    await controller.listPublishedArticles(req, {}, next);
    expect(next).toHaveBeenLastCalledWith(err);
    jest.restoreAllMocks();
    jest.spyOn(Article, 'exists').mockRejectedValue(err);
    await controller.setViewBucket(req, {}, next);
    expect(next).toHaveBeenLastCalledWith(err);
    jest.restoreAllMocks();
    jest.spyOn(Article, 'findById').mockRejectedValue(err);
    await controller.resetArticleAnalytics(req, {}, next);
    expect(next).toHaveBeenLastCalledWith(err);
  } finally { jest.restoreAllMocks(); }
});

test('weather refreshes expired observations and aborts a stalled provider', async () => {
  const controller = require('../../controllers/weatherController');
  const originalFetch = global.fetch;
  const now = Date.now();
  try {
    controller.resetWeatherCache();
    global.fetch = jest.fn().mockImplementation(async () => ({ ok: true, json: async () => ({ current: { time: Math.floor(Date.now() / 1000), temperature_2m: 18, weather_code: 3 } }) }));
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controller.getWeather({}, res);
    jest.spyOn(Date, 'now').mockReturnValue(now + 16 * 60 * 1000);
    await controller.getWeather({}, res);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    jest.restoreAllMocks();
    jest.useFakeTimers();
    global.fetch = jest.fn().mockImplementation((url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('Request aborted')));
    }));
    const pending = expect(controller.fetchWeather()).rejects.toThrow('Request aborted');
    await jest.advanceTimersByTimeAsync(10000);
    await pending;
  } finally {
    jest.useRealTimers();
    jest.restoreAllMocks();
    global.fetch = originalFetch;
    controller.resetWeatherCache();
  }
});

test('analytics reset preserves views arriving immediately after bucket deletion', async () => {
  const controller = require('../../controllers/analyticsController');
  const article = await Article.create({ title: 'Reset race', summary: 'Summary', content: 'Content', category: 'News', author: editor._id, status: 'published' });
  await controller.recordView(article.id);
  const deleteMany = ViewAnalytics.deleteMany.bind(ViewAnalytics);
  const findByIdAndDelete = ViewAnalytics.findByIdAndDelete.bind(ViewAnalytics);
  let injected = false;
  const afterDelete = async result => {
    if (!injected) { injected = true; await controller.recordView(article.id); }
    return result;
  };
  jest.spyOn(ViewAnalytics, 'deleteMany').mockImplementation(async filter => afterDelete(await deleteMany(filter)));
  jest.spyOn(ViewAnalytics, 'findByIdAndDelete').mockImplementation(async id => afterDelete(await findByIdAndDelete(id)));
  try {
    expect((await agent.delete('/api/analytics/' + article.id)).status).toBe(200);
    expect(injected).toBe(true);
    const bucketSum = (await ViewAnalytics.find({article: article.id})).reduce((sum, row) => sum + row.views, 0);
    expect(bucketSum).toBe(1);
    expect((await Article.findById(article.id)).viewsCount).toBe(bucketSum);
  } finally { jest.restoreAllMocks(); }
});

test('analytics reset tolerates a bucket already removed by another reset', async () => {
  const controller = require('../../controllers/analyticsController');
  const article = await Article.create({ title: 'Repeated reset', summary: 'Summary', content: 'Content', category: 'News', author: editor._id, status: 'published' });
  await controller.recordView(article.id);
  const originalDelete = ViewAnalytics.findByIdAndDelete.bind(ViewAnalytics);
  jest.spyOn(ViewAnalytics, 'findByIdAndDelete').mockImplementationOnce(async id => {
    const removed = await originalDelete(id);
    await Article.findByIdAndUpdate(article.id, { $inc: { viewsCount: -removed.views } });
    return null;
  });
  try {
    expect((await agent.delete('/api/analytics/' + article.id)).status).toBe(200);
    expect((await Article.findById(article.id)).viewsCount).toBe(0);
    expect(await ViewAnalytics.countDocuments({ article: article.id })).toBe(0);
  } finally { jest.restoreAllMocks(); }
});
