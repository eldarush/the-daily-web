const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;
let app;
let request;
let User;
let Article;
let ViewAnalytics;
let analyticsController;
let reporterController;
let editorController;

/**
 * Full coverage suite for Module 4: Article + ViewAnalytics models, the
 * reporter workspace / autosave API, the editor review/diff/approve API, and
 * the Impact Analytics endpoint. Integration paths run through supertest agents;
 * error/edge branches are driven by direct controller calls with mocks.
 */
describe('Module 4: Workflow, Dual-Version, Diff & Impact Analytics', () => {
  let reporter;
  let otherReporter;
  let editor;
  let reporterAgent;
  let editorAgent;

  async function login(username) {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username, password: 'password123' });
    return agent;
  }

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    process.env.MONGODB_URI = uri;
    process.env.SESSION_SECRET = 'test-secret-workflow-isolated-only';
    process.env.NODE_ENV = 'test';

    await mongoose.connect(uri);

    app = require('../../app');
    request = require('supertest');
    User = require('../../models/User');
    Article = require('../../models/Article');
    ViewAnalytics = require('../../models/ViewAnalytics');
    analyticsController = require('../../controllers/analyticsController');
    reporterController = require('../../controllers/reporterController');
    editorController = require('../../controllers/editorController');

    reporter = await User.create({ username: 'wf_reporter', password: 'password123', fullName: 'WF Reporter', role: 'reporter' });
    otherReporter = await User.create({ username: 'wf_reporter2', password: 'password123', fullName: 'Other Reporter', role: 'reporter' });
    editor = await User.create({ username: 'wf_editor', password: 'password123', fullName: 'WF Editor', role: 'editor' });

    reporterAgent = await login('wf_reporter');
    editorAgent = await login('wf_editor');
  });

  afterAll(async () => {
    const { getSessionStore } = require('../../config/session');
    const store = getSessionStore();
    if (store && store.close) {
      await store.close();
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    if (mongod) {
      await mongod.stop();
    }
  });

  /** Creates an article directly, defaulting owner to the main reporter. */
  async function makeArticle(overrides = {}) {
    return Article.create({
      title: 'Seed Title',
      summary: 'Seed summary',
      content: 'Seed content',
      category: 'Technology',
      author: reporter._id,
      ...overrides
    });
  }

  // --------------------------------------------------------------------------
  describe('Models', () => {
    test('Article exposes category and status vocabularies', () => {
      expect(Article.ARTICLE_CATEGORIES).toHaveLength(7);
      expect(Article.ARTICLE_STATUSES).toEqual(['draft', 'pending', 'published', 'rejected']);
    });

    test('Article defaults: draft status, empty pendingUpdate, zero views', async () => {
      const a = await makeArticle();
      expect(a.status).toBe('draft');
      expect(a.pendingUpdate.hasUpdate).toBe(false);
      expect(a.viewsCount).toBe(0);
      expect(a.publishedAt).toBeNull();
    });

    test('ViewAnalytics enforces a unique (article, hour) bucket', async () => {
      const a = await makeArticle();
      const bucket = new Date('2026-01-01T10:00:00.000Z');
      await ViewAnalytics.create({ article: a._id, timestampBucket: bucket, views: 1 });
      await expect(
        ViewAnalytics.create({ article: a._id, timestampBucket: bucket, views: 1 })
      ).rejects.toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  describe('Reporter API — RBAC & listing', () => {
    test('unauthenticated request is 401', async () => {
      const res = await request(app).get('/api/reporter/articles');
      expect(res.status).toBe(401);
    });

    test('editor role is forbidden from reporter routes (403)', async () => {
      const res = await editorAgent.get('/api/reporter/articles');
      expect(res.status).toBe(403);
    });

    test('reporter lists only their own articles, paginated', async () => {
      await makeArticle({ author: reporter._id, title: 'Mine A' });
      await makeArticle({ author: otherReporter._id, title: 'Not mine' });

      const res = await reporterAgent.get('/api/reporter/articles');
      expect(res.status).toBe(200);
      expect(res.body.pageSize).toBe(20);
      res.body.articles.forEach((a) => expect(a.author).toBe(reporter._id.toString()));

      const paged = await reporterAgent.get('/api/reporter/articles?page=2');
      expect(paged.status).toBe(200);
      expect(paged.body.page).toBe(2);
    });

    test('getReporterArticles forwards errors to next()', async () => {
      const spy = jest.spyOn(Article, 'find').mockImplementationOnce(() => {
        throw new Error('find boom');
      });
      const next = jest.fn();
      await reporterController.getReporterArticles({ session: { user: { id: String(reporter._id) } }, query: {} }, {}, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      spy.mockRestore();
    });
  });

  // --------------------------------------------------------------------------
  describe('Reporter API — create / autosave / submit', () => {
    test('create returns 201 with an id (default fields)', async () => {
      const res = await reporterAgent.post('/api/reporter/articles').send({});
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
    });

    test('create accepts a valid category and rejects an invalid one', async () => {
      const ok = await reporterAgent.post('/api/reporter/articles').send({ title: 'T', category: 'Sports' });
      expect(ok.status).toBe(201);

      const bad = await reporterAgent.post('/api/reporter/articles').send({ category: 'Nonsense' });
      expect(bad.status).toBe(400);
    });

    test('create forwards errors to next()', async () => {
      const spy = jest.spyOn(Article, 'create').mockRejectedValueOnce(new Error('create boom'));
      const next = jest.fn();
      await reporterController.createArticle({ session: { user: { id: String(reporter._id) } }, body: {} }, {}, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      spy.mockRestore();
    });

    test('autosave on a draft writes primary fields', async () => {
      const a = await makeArticle({ status: 'draft' });
      const res = await reporterAgent
        .put(`/api/reporter/articles/${a._id}/autosave`)
        .send({ title: 'Live Draft Title', summary: 'S', content: 'C', category: 'Health', imageUrl: '/x.jpg' });
      expect(res.status).toBe(200);
      const fresh = await Article.findById(a._id);
      expect(fresh.title).toBe('Live Draft Title');
      expect(fresh.category).toBe('Health');
    });

    test('autosave on a published article stages into pendingUpdate, live stays intact', async () => {
      const a = await makeArticle({ status: 'published', title: 'Original Live Title', publishedAt: new Date() });
      const res = await reporterAgent
        .put(`/api/reporter/articles/${a._id}/autosave`)
        .send({ title: 'Staged Title', summary: 'Staged summary', content: 'Staged body', category: 'News', imageUrl: '/staged.jpg' });
      expect(res.status).toBe(200);

      const fresh = await Article.findById(a._id);
      expect(fresh.title).toBe('Original Live Title'); // live untouched
      expect(fresh.category).toBe('Technology'); // live category untouched
      expect(fresh.pendingUpdate.hasUpdate).toBe(true);
      expect(fresh.pendingUpdate.title).toBe('Staged Title');
      expect(fresh.pendingUpdate.category).toBe('News'); // provided-value branch
      expect(fresh.pendingUpdate.imageUrl).toBe('/staged.jpg'); // provided-value branch
    });

    test('autosave on a published article with an empty body stages the live values', async () => {
      const a = await makeArticle({ status: 'published', title: 'Keep Me', publishedAt: new Date() });
      const res = await reporterAgent.put(`/api/reporter/articles/${a._id}/autosave`).send({});
      expect(res.status).toBe(200);
      const fresh = await Article.findById(a._id);
      expect(fresh.pendingUpdate.hasUpdate).toBe(true);
      expect(fresh.pendingUpdate.title).toBe('Keep Me'); // fallback branch
      expect(fresh.pendingUpdate.summary).toBe('Seed summary'); // fallback branch
      expect(fresh.pendingUpdate.category).toBe('Technology'); // fallback branch
      expect(fresh.pendingUpdate.imageUrl).toBe('/images/default-article.jpg'); // fallback branch
    });

    test('autosave rejects an invalid category (400)', async () => {
      const a = await makeArticle({ status: 'draft' });
      const res = await reporterAgent.put(`/api/reporter/articles/${a._id}/autosave`).send({ category: 'Bogus' });
      expect(res.status).toBe(400);
    });

    test('autosave refuses editing an article awaiting approval (400)', async () => {
      const a = await makeArticle({ status: 'pending' });
      const res = await reporterAgent.put(`/api/reporter/articles/${a._id}/autosave`).send({ title: 'x' });
      expect(res.status).toBe(400);
    });

    test('autosave guards: invalid id (400), missing (404), not owner (403)', async () => {
      const invalid = await reporterAgent.put('/api/reporter/articles/not-an-id/autosave').send({ title: 'x' });
      expect(invalid.status).toBe(400);

      const missing = await reporterAgent.put(`/api/reporter/articles/${new mongoose.Types.ObjectId()}/autosave`).send({ title: 'x' });
      expect(missing.status).toBe(404);

      const foreign = await makeArticle({ author: otherReporter._id });
      const notOwner = await reporterAgent.put(`/api/reporter/articles/${foreign._id}/autosave`).send({ title: 'x' });
      expect(notOwner.status).toBe(403);
    });

    test('autosave forwards unexpected errors to next()', async () => {
      const a = await makeArticle({ status: 'draft' });
      const spy = jest.spyOn(Article, 'updateOne').mockRejectedValueOnce(new Error('save boom'));
      const next = jest.fn();
      await reporterController.autosaveArticle(
        { params: { id: String(a._id) }, body: { title: 'x' }, session: { user: { id: String(reporter._id) } } },
        {},
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      spy.mockRestore();
    });

    test('submit moves draft → pending and clears editor notes', async () => {
      const a = await makeArticle({ status: 'rejected', editorNotes: 'fix this' });
      const res = await reporterAgent.post(`/api/reporter/articles/${a._id}/submit`);
      expect(res.status).toBe(200);
      const fresh = await Article.findById(a._id);
      expect(fresh.status).toBe('pending');
      expect(fresh.editorNotes).toBe('');
    });

    test('submit refuses an illegal source state (published)', async () => {
      const a = await makeArticle({ status: 'published', publishedAt: new Date() });
      const res = await reporterAgent.post(`/api/reporter/articles/${a._id}/submit`);
      expect(res.status).toBe(400);
    });

    test('submit guard: missing article (404) and error forwarding', async () => {
      const missing = await reporterAgent.post(`/api/reporter/articles/${new mongoose.Types.ObjectId()}/submit`);
      expect(missing.status).toBe(404);

      const a = await makeArticle({ status: 'draft' });
      const spy = jest.spyOn(Article.prototype, 'save').mockRejectedValueOnce(new Error('submit boom'));
      const next = jest.fn();
      await reporterController.submitArticle(
        { params: { id: String(a._id) }, session: { user: { id: String(reporter._id) } } },
        {},
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      spy.mockRestore();
    });
  });

  // --------------------------------------------------------------------------
  describe('Editor API — listing, diff, edit, approve, reject, delete', () => {
    test('reporter is forbidden from editor routes (403)', async () => {
      const res = await reporterAgent.get('/api/editor/articles');
      expect(res.status).toBe(403);
    });

    test('editor lists all articles, filters by status, rejects a bad filter', async () => {
      const all = await editorAgent.get('/api/editor/articles');
      expect(all.status).toBe(200);
      expect(all.body.articles.length).toBeGreaterThan(0);

      const pending = await editorAgent.get('/api/editor/articles?status=pending&page=1');
      expect(pending.status).toBe(200);
      pending.body.articles.forEach((a) => expect(a.status === 'pending' || a.pendingUpdate.status === 'pending').toBe(true));

      const bad = await editorAgent.get('/api/editor/articles?status=bogus');
      expect(bad.status).toBe(400);
    });

    test('listAllArticles forwards errors to next()', async () => {
      const spy = jest.spyOn(Article, 'find').mockImplementationOnce(() => {
        throw new Error('list boom');
      });
      const next = jest.fn();
      await editorController.listAllArticles({ query: {} }, {}, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      spy.mockRestore();
    });

    test('diff returns live vs staged pending, and null when none staged', async () => {
      const staged = await makeArticle({
        status: 'published',
        publishedAt: new Date(),
        pendingUpdate: { hasUpdate: true, title: 'New', summary: 'New s', content: 'New c', category: 'Technology' }
      });
      const withDiff = await editorAgent.get(`/api/editor/articles/${staged._id}/diff`);
      expect(withDiff.status).toBe(200);
      expect(withDiff.body.live.title).toBe('Seed Title');
      expect(withDiff.body.pending.title).toBe('New');

      const plain = await makeArticle({ status: 'published', publishedAt: new Date() });
      const noDiff = await editorAgent.get(`/api/editor/articles/${plain._id}/diff`);
      expect(noDiff.body.pending).toBeNull();
    });

    test('diff guards: invalid id (400), missing (404), error forwarding', async () => {
      const invalid = await editorAgent.get('/api/editor/articles/xxx/diff');
      expect(invalid.status).toBe(400);
      const missing = await editorAgent.get(`/api/editor/articles/${new mongoose.Types.ObjectId()}/diff`);
      expect(missing.status).toBe(404);

      const spy = jest.spyOn(Article, 'findById').mockImplementationOnce(() => {
        throw new Error('diff boom');
      });
      const next = jest.fn();
      await editorController.getArticleDiff({ params: { id: String(new mongoose.Types.ObjectId()) } }, {}, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      spy.mockRestore();
    });

    test('editor edit updates a draft in place and rejects bad category', async () => {
      const a = await makeArticle({ status: 'draft' });
      const res = await editorAgent.put(`/api/editor/articles/${a._id}`).send({ title: 'Editor Edited', content: 'edited' });
      expect(res.status).toBe(200);
      const fresh = await Article.findById(a._id);
      expect(fresh.title).toBe('Editor Edited');

      const bad = await editorAgent.put(`/api/editor/articles/${a._id}`).send({ category: 'Nope' });
      expect(bad.status).toBe(400);
    });

    test('editor edit on a published article stages a pending update', async () => {
      const a = await makeArticle({ status: 'published', title: 'Live', publishedAt: new Date() });
      const res = await editorAgent
        .put(`/api/editor/articles/${a._id}`)
        .send({ title: 'Editor Staged', summary: 'ed s', content: 'ed c', category: 'Economy', imageUrl: '/ed.jpg' });
      expect(res.status).toBe(200);
      const fresh = await Article.findById(a._id);
      expect(fresh.title).toBe('Live');
      expect(fresh.pendingUpdate.title).toBe('Editor Staged');
      expect(fresh.pendingUpdate.category).toBe('Economy'); // provided-value branch
      expect(fresh.pendingUpdate.imageUrl).toBe('/ed.jpg'); // provided-value branch
    });

    test('editor edit on a published article with an empty body stages the live values', async () => {
      const a = await makeArticle({ status: 'published', title: 'Editor Keep', publishedAt: new Date() });
      const res = await editorAgent.put(`/api/editor/articles/${a._id}`).send({});
      expect(res.status).toBe(200);
      const fresh = await Article.findById(a._id);
      expect(fresh.pendingUpdate.hasUpdate).toBe(true);
      expect(fresh.pendingUpdate.title).toBe('Editor Keep'); // fallback branch
      expect(fresh.pendingUpdate.content).toBe('Seed content'); // fallback branch
      expect(fresh.pendingUpdate.category).toBe('Technology'); // fallback branch
      expect(fresh.pendingUpdate.imageUrl).toBe('/images/default-article.jpg'); // fallback branch
    });

    test('editor edit guards + error forwarding', async () => {
      const invalid = await editorAgent.put('/api/editor/articles/zzz').send({ title: 'x' });
      expect(invalid.status).toBe(400);
      const missing = await editorAgent.put(`/api/editor/articles/${new mongoose.Types.ObjectId()}`).send({ title: 'x' });
      expect(missing.status).toBe(404);

      const a = await makeArticle({ status: 'draft' });
      const spy = jest.spyOn(Article.prototype, 'save').mockRejectedValueOnce(new Error('edit boom'));
      const next = jest.fn();
      await editorController.editArticle({ params: { id: String(a._id) }, body: { title: 'x' }, session: { user: { id: String(editor._id) } } }, {}, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      spy.mockRestore();
    });

    test('approve publishes a pending article for the first time', async () => {
      const a = await makeArticle({ status: 'pending' });
      const res = await editorAgent.post(`/api/editor/articles/${a._id}/approve`).send({});
      expect(res.status).toBe(200);
      const fresh = await Article.findById(a._id);
      expect(fresh.status).toBe('published');
      expect(fresh.publishedAt).not.toBeNull();
    });

    test('approve promotes a staged update and logs a milestone (default note)', async () => {
      const a = await makeArticle({
        status: 'published',
        publishedAt: new Date(),
        pendingUpdate: { hasUpdate: true, title: 'Promoted', summary: 'ps', content: 'pc', category: 'World', imageUrl: '/p.jpg' }
      });
      await reporterAgent.post(`/api/reporter/articles/${a._id}/submit`);
      const res = await editorAgent.post(`/api/editor/articles/${a._id}/approve`).send({});
      expect(res.status).toBe(200);
      const fresh = await Article.findById(a._id);
      expect(fresh.title).toBe('Promoted');
      expect(fresh.category).toBe('World');
      expect(fresh.pendingUpdate.hasUpdate).toBe(false);
      expect(fresh.publishedUpdates).toHaveLength(1);
      expect(fresh.publishedUpdates[0].changelogNote).toBe('Editorial update');
    });

    test('approve promotes a staged update with a custom changelog note', async () => {
      const a = await makeArticle({
        status: 'published',
        publishedAt: new Date(),
        pendingUpdate: { hasUpdate: true, title: 'P2', summary: 's', content: 'c', category: 'News' }
      });
      await reporterAgent.post(`/api/reporter/articles/${a._id}/submit`);
      const res = await editorAgent.post(`/api/editor/articles/${a._id}/approve`).send({ changelogNote: 'Fixed the numbers' });
      expect(res.status).toBe(200);
      const fresh = await Article.findById(a._id);
      expect(fresh.publishedUpdates[0].changelogNote).toBe('Fixed the numbers');
    });

    test('approve refuses a non-pending article with no staged update (400)', async () => {
      const a = await makeArticle({ status: 'draft' });
      const res = await editorAgent.post(`/api/editor/articles/${a._id}/approve`).send({});
      expect(res.status).toBe(400);
    });

    test('approve guards + error forwarding', async () => {
      const missing = await editorAgent.post(`/api/editor/articles/${new mongoose.Types.ObjectId()}/approve`).send({});
      expect(missing.status).toBe(404);

      const a = await makeArticle({ status: 'pending' });
      const spy = jest.spyOn(Article.prototype, 'save').mockRejectedValueOnce(new Error('approve boom'));
      const next = jest.fn();
      await editorController.approveArticle({ params: { id: String(a._id) }, body: {}, session: { user: { id: String(editor._id) } } }, {}, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      spy.mockRestore();
    });

    test('reject requires notes, requires pending state, then returns the article', async () => {
      const noNotes = await editorAgent.post(`/api/editor/articles/${new mongoose.Types.ObjectId()}/reject`).send({});
      expect(noNotes.status).toBe(400);

      const blankNotes = await editorAgent.post(`/api/editor/articles/${new mongoose.Types.ObjectId()}/reject`).send({ notes: 123 });
      expect(blankNotes.status).toBe(400);

      const draft = await makeArticle({ status: 'draft' });
      const wrongState = await editorAgent.post(`/api/editor/articles/${draft._id}/reject`).send({ notes: 'please fix' });
      expect(wrongState.status).toBe(400);

      const pending = await makeArticle({ status: 'pending' });
      const ok = await editorAgent.post(`/api/editor/articles/${pending._id}/reject`).send({ notes: 'Add a source' });
      expect(ok.status).toBe(200);
      const fresh = await Article.findById(pending._id);
      expect(fresh.status).toBe('rejected');
      expect(fresh.editorNotes).toBe('Add a source');
    });

    test('reject guard (missing) + error forwarding', async () => {
      const missing = await editorAgent.post(`/api/editor/articles/${new mongoose.Types.ObjectId()}/reject`).send({ notes: 'x' });
      expect(missing.status).toBe(404);

      const a = await makeArticle({ status: 'pending' });
      const spy = jest.spyOn(Article.prototype, 'save').mockRejectedValueOnce(new Error('reject boom'));
      const next = jest.fn();
      await editorController.rejectArticle({ params: { id: String(a._id) }, body: { notes: 'x' } }, {}, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      spy.mockRestore();
    });

    test('delete removes an article; guards missing + errors', async () => {
      const a = await makeArticle({ status: 'draft' });
      const ok = await editorAgent.delete(`/api/editor/articles/${a._id}`);
      expect(ok.status).toBe(200);
      expect(await Article.findById(a._id)).toBeNull();

      const missing = await editorAgent.delete(`/api/editor/articles/${new mongoose.Types.ObjectId()}`);
      expect(missing.status).toBe(404);

      const b = await makeArticle({ status: 'draft' });
      const spy = jest.spyOn(Article.prototype, 'deleteOne').mockRejectedValueOnce(new Error('delete boom'));
      const next = jest.fn();
      await editorController.deleteArticle({ params: { id: String(b._id) } }, {}, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      spy.mockRestore();
    });
  });

  test('blank intermediate drafts persist but cannot be submitted or published', async () => {
    const a = await makeArticle();
    expect((await reporterAgent.put(`/api/reporter/articles/${a._id}/autosave`).send({ title: '', summary: '', content: '' })).status).toBe(200);
    expect((await Article.findById(a._id)).title).toBe('');
    expect((await reporterAgent.post(`/api/reporter/articles/${a._id}/submit`)).status).toBe(400);
    await Article.updateOne({ _id: a._id }, { status: 'pending' });
    expect((await editorAgent.post(`/api/editor/articles/${a._id}/approve`).send({})).status).toBe(400);
  });

  test('delayed older autosave cannot overwrite a newer acknowledged version', async () => {
    const a = await makeArticle();
    const url = `/api/reporter/articles/${a._id}/autosave`;
    for (const saveVersion of [0, -1, 1.5, '1']) {
      expect((await reporterAgent.put(url).send({ content: 'Invalid', saveVersion })).status).toBe(400);
    }
    let release;
    let announce;
    const blocked = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { announce = resolve; });
    const original = Article.updateOne.bind(Article);
    const spy = jest.spyOn(Article, 'updateOne').mockImplementation(async (...args) => {
      if (args[1].$set.saveVersion === 1) {
        announce();
        await blocked;
      }
      return original(...args);
    });
    const older = reporterAgent.put(url).send({ content: 'Delayed older', saveVersion: 1 }).then(response => response);
    await started;
    const newest = await reporterAgent.put(url).send({ content: 'Newest', saveVersion: 2 });
    const retried = await reporterAgent.put(url).send({ content: 'Newest', saveVersion: 2 });
    release();
    expect(newest.status).toBe(200);
    expect(retried.status).toBe(200);
    expect((await older).status).toBe(409);
    spy.mockRestore();
    expect((await Article.findById(a._id)).content).toBe('Newest');
  });

  test('editor preserves submitted fields and refuses invalid notes and repeat submissions', async () => {
    const a = await makeArticle({ status: 'published', publishedAt: new Date() });
    await reporterAgent.put(`/api/reporter/articles/${a._id}/autosave`).send({ title: 'Reporter revision', content: 'New report' });
    await reporterAgent.post(`/api/reporter/articles/${a._id}/submit`);
    expect((await reporterAgent.post(`/api/reporter/articles/${a._id}/submit`)).status).toBe(400);
    const draft = await makeArticle({ status: 'pending' });
    expect((await reporterAgent.post(`/api/reporter/articles/${draft._id}/submit`)).status).toBe(400);
    expect((await editorAgent.post(`/api/editor/articles/${a._id}/approve`).send({ changelogNote: {} })).status).toBe(400);
    expect((await editorAgent.put(`/api/editor/articles/${a._id}`).send({ summary: 'Editor summary' })).status).toBe(200);
    const fresh = await Article.findById(a._id);
    expect(fresh.pendingUpdate.title).toBe('Reporter revision');
    expect(fresh.pendingUpdate.content).toBe('New report');
    expect(fresh.pendingUpdate.summary).toBe('Editor summary');
    const published = await editorAgent.get('/api/editor/articles?status=published');
    published.body.articles.forEach(article => expect(article.status).toBe('published'));
  });

  test('workflow rejects object fields and deletes related records', async () => {
    const bad = await reporterAgent.post('/api/reporter/articles').send({ title: { $gt: '' } });
    expect(bad.status).toBe(400);
    const a = await makeArticle();
    expect((await reporterAgent.put(`/api/reporter/articles/${a._id}/autosave`).send({ content: ['bad'] })).status).toBe(400);
    expect((await editorAgent.put(`/api/editor/articles/${a._id}`).send({ summary: 123 })).status).toBe(400);
    const Comment = require('../../models/Comment');
    await Comment.create({ article: a._id, authorName: 'Reader', content: 'Comment', userIp: '127.0.0.1' });
    await ViewAnalytics.create({ article: a._id, timestampBucket: new Date(), views: 1 });
    expect((await editorAgent.delete(`/api/editor/articles/${a._id}`)).status).toBe(200);
    expect(await Comment.countDocuments({ article: a._id })).toBe(0);
    expect(await ViewAnalytics.countDocuments({ article: a._id })).toBe(0);
  });

  test('published revision must be submitted, returned and resubmitted before promotion', async () => {
    const a = await makeArticle({ status: 'published', title: 'Still live', publishedAt: new Date() });
    const base = `/api/reporter/articles/${a._id}`;
    const review = `/api/editor/articles/${a._id}`;
    await reporterAgent.put(base + '/autosave').send({ title: 'Proposed' });
    expect((await editorAgent.post(review + '/approve').send({})).status).toBe(400);
    expect((await reporterAgent.post(base + '/submit')).status).toBe(200);
    expect((await reporterAgent.put(base + '/autosave').send({ title: 'Forbidden' })).status).toBe(400);
    const listed = await editorAgent.get('/api/editor/articles?status=pending');
    expect(listed.body.articles.some(article => article._id === String(a._id))).toBe(true);
    expect((await editorAgent.post(review + '/reject').send({ notes: 'Cite a source' })).status).toBe(200);
    let fresh = await Article.findById(a._id);
    expect(fresh.status).toBe('published');
    expect(fresh.title).toBe('Still live');
    expect(fresh.pendingUpdate.status).toBe('rejected');
    expect(fresh.pendingUpdate.editorNotes).toBe('Cite a source');
    await reporterAgent.put(base + '/autosave').send({ content: 'Corrected source' });
    expect((await reporterAgent.post(base + '/submit')).status).toBe(200);
    expect((await editorAgent.post(review + '/approve').send({})).status).toBe(200);
    fresh = await Article.findById(a._id);
    expect(fresh.title).toBe('Proposed');
    expect(fresh.content).toBe('Corrected source');
    expect(fresh.publishedUpdates).toHaveLength(1);
    expect((await reporterAgent.put(base + '/autosave').send({ title: 'Next revision' })).status).toBe(200);
  });

  // --------------------------------------------------------------------------
  describe('Analytics — recordView & timeline', () => {
    test('toHourBucket truncates to the start of the UTC hour', () => {
      const bucket = analyticsController.toHourBucket(new Date('2026-05-01T13:47:22.500Z'));
      expect(bucket.toISOString()).toBe('2026-05-01T13:00:00.000Z');
    });

    test('recordView increments the hourly bucket and the article total', async () => {
      const a = await makeArticle({ status: 'published', publishedAt: new Date() });
      await analyticsController.recordView(String(a._id));
      await analyticsController.recordView(String(a._id));

      const fresh = await Article.findById(a._id);
      expect(fresh.viewsCount).toBe(2);
      const buckets = await ViewAnalytics.find({ article: a._id });
      expect(buckets).toHaveLength(1);
      expect(buckets[0].views).toBe(2);
    });

    test('recordView ignores an invalid id', async () => {
      await expect(analyticsController.recordView('not-valid')).resolves.toBeUndefined();
    });

    test('recordView swallows errors (never throws into the caller)', async () => {
      const spy = jest.spyOn(ViewAnalytics, 'findOneAndUpdate').mockRejectedValueOnce(new Error('view boom'));
      await expect(analyticsController.recordView(String(new mongoose.Types.ObjectId()))).resolves.toBeUndefined();
      spy.mockRestore();
    });

    test('GET /api/analytics/:id returns timeline + milestones (editor only)', async () => {
      const a = await makeArticle({
        status: 'published',
        publishedAt: new Date(),
        publishedUpdates: [
          { publishedAt: new Date(), editor: editor._id, changelogNote: 'Note A' },
          { publishedAt: new Date(), editor: editor._id }
        ]
      });
      await ViewAnalytics.create({ article: a._id, timestampBucket: analyticsController.toHourBucket(new Date()), views: 9 });

      const res = await editorAgent.get(`/api/analytics/${a._id}`);
      expect(res.status).toBe(200);
      expect(res.body.timeline[0].views).toBe(9);
      expect(res.body.milestones).toHaveLength(2);
      expect(res.body.milestones[0].changelogNote).toBe('Note A');
      expect(res.body.milestones[1].changelogNote).toBe('Editorial update'); // default-note branch
    });

    test('analytics endpoint is editor-only and validates the id', async () => {
      const a = await makeArticle();
      const forbidden = await reporterAgent.get(`/api/analytics/${a._id}`);
      expect(forbidden.status).toBe(403);

      const invalid = await editorAgent.get('/api/analytics/nope');
      expect(invalid.status).toBe(400);

      const missing = await editorAgent.get(`/api/analytics/${new mongoose.Types.ObjectId()}`);
      expect(missing.status).toBe(404);
    });

    test('analytics tolerates an article with no publishedUpdates field', async () => {
      const a = await makeArticle({ status: 'published', publishedAt: new Date() });
      await Article.collection.updateOne({ _id: a._id }, { $unset: { publishedUpdates: '' } });
      const res = await editorAgent.get(`/api/analytics/${a._id}`);
      expect(res.status).toBe(200);
      expect(res.body.milestones).toEqual([]);
    });

    test('getArticleAnalytics forwards errors to next()', async () => {
      const a = await makeArticle({ status: 'published', publishedAt: new Date() });
      const spy = jest.spyOn(ViewAnalytics, 'find').mockImplementationOnce(() => {
        throw new Error('timeline boom');
      });
      const next = jest.fn();
      await analyticsController.getArticleAnalytics({ params: { articleId: String(a._id) } }, { json: jest.fn(), status: jest.fn().mockReturnThis() }, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      spy.mockRestore();
    });
  });
});
