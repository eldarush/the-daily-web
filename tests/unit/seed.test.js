const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Article = require('../../models/Article');
const User = require('../../models/User');
const ViewAnalytics = require('../../models/ViewAnalytics');

const run = promisify(execFile);
let mongod;
let published;
let editor;
let seededAt;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('seed_editor_updates');
  // Run the real command in its own process, with an explicit disposable URI.
  await run(process.execPath, ['scripts/seed.js'], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, MONGODB_URI: uri, NODE_ENV: 'test' },
    timeout: 90000
  });
  seededAt = Date.now();
  await mongoose.connect(uri);
  published = await Article.find({ status: 'published' }).sort({ _id: 1 }).lean();
  editor = await User.findOne({ username: 'editor' }).lean();
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test('every published demo article has ordered, attributed updates without publishing drafts', async () => {
  expect(await Article.countDocuments()).toBe(520);
  expect(published).toHaveLength(390);
  expect(new Set(published.map(article => article.author.toString())).size).toBe(4);
  expect(new Set(published.map(article => article.category)).size).toBe(7);
  expect(editor.role).toBe('editor');
  expect(new Set(published.map(article => article.publishedUpdates.length))).toEqual(new Set([1, 2, 3]));
  expect(await User.countDocuments({ role: 'reporter' })).toBe(4);
  expect(await User.countDocuments({ role: 'editor' })).toBe(1);
  expect(await require('../../models/Comment').countDocuments()).toBe(120);
  for (const [status, count] of [['draft', 52], ['pending', 52], ['rejected', 26]]) {
    expect(await Article.countDocuments({ status })).toBe(count);
    expect(await Article.distinct('category', { status })).toHaveLength(7);
  }

  for (const article of published) {
    expect(article.publishedUpdates.length).toBeGreaterThanOrEqual(1);
    expect(article.publishedUpdates.length).toBeLessThanOrEqual(3);
    let previous = article.publishedAt.getTime();
    for (const update of article.publishedUpdates) {
      expect(update.publishedAt.getTime()).toBeGreaterThan(previous);
      expect(update.publishedAt.getTime()).toBeLessThan(seededAt);
      expect(update.editor.toString()).toBe(editor._id.toString());
      expect(update.changelogNote.trim().length).toBeGreaterThan(0);
      previous = update.publishedAt.getTime();
    }
  }

  const unpublished = await Article.find({ status: { $ne: 'published' } }).lean();
  expect(unpublished).toHaveLength(130);
  for (const article of unpublished) {
    expect(article.publishedAt).toBeNull();
    expect(article.publishedUpdates).toHaveLength(0);
  }
});

test('seeded view timelines surround updates and pending revisions follow approved history', async () => {
  const totals = await ViewAnalytics.aggregate([
    { $group: { _id: '$article', views: { $sum: '$views' }, first: { $min: '$timestampBucket' }, last: { $max: '$timestampBucket' } } }
  ]);
  const byArticle = new Map(totals.map(row => [row._id.toString(), row]));
  expect(byArticle.size).toBe(published.length);
  for (const article of published) {
    const timeline = byArticle.get(article._id.toString());
    expect(timeline.views).toBe(article.viewsCount);
    expect(timeline.first.getTime()).toBeGreaterThanOrEqual(article.publishedAt.getTime());
    for (const update of article.publishedUpdates) {
      expect(timeline.first.getTime()).toBeLessThan(update.publishedAt.getTime());
      expect(timeline.last.getTime()).toBeGreaterThan(update.publishedAt.getTime());
    }
  }
  const staged = published.filter(article => article.pendingUpdate.hasUpdate);
  expect(staged).toHaveLength(15);
  for (const article of staged) {
    expect(article.pendingUpdate.status).toBe('pending');
    expect(article.pendingUpdate.updatedAt.getTime()).toBeGreaterThan(article.publishedUpdates.at(-1).publishedAt.getTime());
    expect(article.pendingUpdate.updatedAt.getTime()).toBeLessThan(seededAt);
    expect(article.pendingUpdate.content).not.toBe(article.content);
  }
});

test('analytics exposes the update milestones for a post outside the former first-40 sample', async () => {
  const article = published.at(-1);
  const res = { json: jest.fn() };
  const next = jest.fn();
  await require('../../controllers/analyticsController').getArticleAnalytics(
    { params: { articleId: article._id.toString() } }, res, next
  );
  expect(next).not.toHaveBeenCalled();
  const result = res.json.mock.calls[0][0];
  expect(result.timeline.length).toBeGreaterThan(0);
  expect(result.milestones).toEqual(article.publishedUpdates.map(update => ({
    time: update.publishedAt, changelogNote: update.changelogNote
  })));
});
