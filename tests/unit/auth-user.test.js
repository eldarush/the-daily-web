const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;
let app;
let request;
let User;
let weatherController;
const originalFetch = global.fetch;

describe('Authentication, User Management & Weather Service', () => {
  let reporterUser;
  let editorUser;
  let editorAgent;
  let reporterAgent;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    process.env.MONGODB_URI = uri;
    process.env.SESSION_SECRET = 'test-session-secret-key-12345';
    process.env.NODE_ENV = 'test';

    await mongoose.connect(uri);

    app = require('../../app');
    request = require('supertest');
    User = require('../../models/User');
    weatherController = require('../../controllers/weatherController');

    reporterUser = await User.create({
      username: 'test_rep_1',
      password: 'password123',
      fullName: 'Test Reporter 1',
      role: 'reporter'
    });

    editorUser = await User.create({
      username: 'test_ed_1',
      password: 'password123',
      fullName: 'Test Editor 1',
      role: 'editor'
    });
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

  describe('User Model & Bcrypt Security', () => {
    test('Password must be hashed with bcrypt (salt 12) upon save and never stored plaintext', async () => {
      expect(reporterUser.password).not.toBe('password123');
      expect(reporterUser.password.startsWith('$2')).toBe(true);

      const isValid = await reporterUser.comparePassword('password123');
      expect(isValid).toBe(true);

      const isInvalid = await reporterUser.comparePassword('wrongpassword');
      expect(isInvalid).toBe(false);
    });

    test('toSafeObject excludes the password hash', () => {
      const safe = reporterUser.toSafeObject();
      expect(safe.password).toBeUndefined();
      expect(safe.username).toBe('test_rep_1');
      expect(safe.role).toBe('reporter');
    });

    test('Saving user without modifying password does not rehash', async () => {
      const prevHash = reporterUser.password;
      reporterUser.fullName = 'Updated Name';
      await reporterUser.save();
      expect(reporterUser.password).toBe(prevHash);
    });
  });

  describe('Authentication API (/api/auth)', () => {
    test('POST /api/auth/login with valid credentials establishes session and returns 200', async () => {
      reporterAgent = request.agent(app);
      const res = await reporterAgent
        .post('/api/auth/login')
        .send({ username: 'test_rep_1', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.role).toBe('reporter');
      expect(res.headers['set-cookie']).toBeDefined();
    });

    test('GET /api/auth/me returns current session user for authenticated agent', async () => {
      const res = await reporterAgent.get('/api/auth/me');
      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe('test_rep_1');
    });

    test('GET /api/auth/me returns 401 when not authenticated', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    test('POST /api/auth/login with invalid password returns 401', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'test_rep_1', password: 'incorrectpassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid username or password');
    });

    test('POST /api/auth/login with non-existent user returns 401', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'non_existent_user', password: 'password123' });

      expect(res.status).toBe(401);
    });

    test('POST /api/auth/login with missing fields returns 400', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: '' });

      expect(res.status).toBe(400);
    });

    test('POST /api/auth/logout destroys session', async () => {
      const logoutRes = await reporterAgent.post('/api/auth/logout');
      expect(logoutRes.status).toBe(200);

      const meRes = await reporterAgent.get('/api/auth/me');
      expect(meRes.status).toBe(401);
    });

    test('logout handles session destroy error gracefully', () => {
      const { logout } = require('../../controllers/authController');
      const mockReq = {
        session: {
          destroy: (cb) => cb(new Error('Destroy failed'))
        }
      };
      const mockNext = jest.fn();
      logout(mockReq, {}, mockNext);
      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Role-Based Access Control (RBAC) & User CRUD (/api/users)', () => {
    beforeAll(async () => {
      editorAgent = request.agent(app);
      await editorAgent
        .post('/api/auth/login')
        .send({ username: 'test_ed_1', password: 'password123' });

      reporterAgent = request.agent(app);
      await reporterAgent
        .post('/api/auth/login')
        .send({ username: 'test_rep_1', password: 'password123' });
    });

    test('Unauthenticated user cannot access /api/users (returns 401)', async () => {
      const res = await request(app).get('/api/users');
      expect(res.status).toBe(401);
    });

    test('Reporter cannot access /api/users (returns 403 Forbidden)', async () => {
      const res = await reporterAgent.get('/api/users');
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });

    test('Editor can list users (returns 200)', async () => {
      const res = await editorAgent.get('/api/users');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users)).toBe(true);
      expect(res.body.users.length).toBeGreaterThanOrEqual(2);
    });

    test('Editor can filter users by role', async () => {
      const res = await editorAgent.get('/api/users?role=reporter');
      expect(res.status).toBe(200);
      res.body.users.forEach(u => expect(u.role).toBe('reporter'));
    });

    test('Editor can search users by username or full name', async () => {
      const res = await editorAgent.get('/api/users?search=Updated');
      expect(res.status).toBe(200);
      expect(res.body.users.length).toBeGreaterThan(0);
      expect(res.body.users[0].fullName).toContain('Updated');
    });

    test('Editor can perform full CRUD on users (Create, Read, Update, Delete)', async () => {
      // 1. Create with validation failure
      const failCreate = await editorAgent.post('/api/users').send({ username: 'short' });
      expect(failCreate.status).toBe(400);

      // Duplicate username check
      const dupCreate = await editorAgent.post('/api/users').send({
        username: 'test_rep_1',
        password: 'password123',
        fullName: 'Duplicate Tester'
      });
      expect(dupCreate.status).toBe(400);

      // Successful Create
      const createRes = await editorAgent
        .post('/api/users')
        .send({
          username: 'test_created_1',
          password: 'password123',
          fullName: 'Created User Test',
          role: 'reporter'
        });
      expect(createRes.status).toBe(201);
      const createdId = createRes.body.user.id;

      // 2. Read
      const readRes = await editorAgent.get(`/api/users/${createdId}`);
      expect(readRes.status).toBe(200);
      expect(readRes.body.user.username).toBe('test_created_1');

      // 3. Update
      const updateRes = await editorAgent
        .put(`/api/users/${createdId}`)
        .send({ fullName: 'Updated Full Name', role: 'editor', password: 'newpassword123' });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.user.fullName).toBe('Updated Full Name');
      expect(updateRes.body.user.role).toBe('editor');

      // 4. Delete
      const deleteRes = await editorAgent.delete(`/api/users/${createdId}`);
      expect(deleteRes.status).toBe(200);

      // Verify deletion (Read after delete)
      const checkRes = await editorAgent.get(`/api/users/${createdId}`);
      expect(checkRes.status).toBe(404);

      // Delete non-existent user
      const deleteNonExistent = await editorAgent.delete(`/api/users/${new mongoose.Types.ObjectId()}`);
      expect(deleteNonExistent.status).toBe(404);

      // Attempt to delete own account (cannot delete self)
      const deleteOwnRes = await editorAgent.delete(`/api/users/${editorUser._id}`);
      expect(deleteOwnRes.status).toBe(400);
      expect(deleteOwnRes.body.error).toContain('Cannot delete your own account');

      // Update non-existent user
      const updateNonExistent = await editorAgent.put(`/api/users/${new mongoose.Types.ObjectId()}`).send({ fullName: 'Nobody' });
      expect(updateNonExistent.status).toBe(404);
    });
  });

  describe('Session and malformed-input regressions', () => {
    beforeAll(async () => { editorAgent = request.agent(app); await editorAgent.post('/api/auth/login').send({ username: 'test_ed_1', password: 'password123' }); });
    test('login rejects non-string credentials and malformed JSON', async () => {
      for (const body of [{ username: {}, password: 'password123' }, { username: 'test_rep_1', password: 123 }, { username: '   ', password: 'password123' }]) {
        expect((await request(app).post('/api/auth/login').send(body)).status).toBe(400);
      }
      const malformed = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad');
      expect(malformed.status).toBe(400);
      expect(malformed.body.error).toBe('Invalid JSON body.');
    });

    test('deleted accounts lose API and web access with their existing cookie', async () => {
      const user = await User.create({ username: 'deleted_session', password: 'password123', fullName: 'Deleted User' });
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ username: user.username, password: 'password123' });
      await editorAgent.delete(`/api/users/${user._id}`);
      expect((await agent.get('/api/reporter/articles')).status).toBe(401);
      expect((await agent.post('/api/reporter/articles').send({ title: 'Invalid access' })).status).toBe(401);
      expect((await agent.get('/workspace')).headers.location).toBe('/login');
    });

    test('demoted editor loses privileges and refreshed /me reports the current role', async () => {
      const user = await User.create({ username: 'demoted_session', password: 'password123', fullName: 'Demoted User', role: 'editor' });
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ username: user.username, password: 'password123' });
      await editorAgent.put(`/api/users/${user._id}`).send({ role: 'reporter' });
      expect((await agent.get('/api/users')).status).toBe(403);
      expect((await agent.get('/editor')).status).toBe(403);
      expect((await agent.get('/api/auth/me')).body.user.role).toBe('reporter');
    });

    test('user inputs reject malformed types and IDs without exposing passwords', async () => {
      expect((await editorAgent.get('/api/users/not-an-id')).status).toBe(400);
      expect((await editorAgent.put('/api/users/not-an-id').send({})).status).toBe(400);
      expect((await editorAgent.delete('/api/users/not-an-id')).status).toBe(400);
      expect((await editorAgent.post('/api/users').send({ username: {}, password: 'password123', fullName: 'Name' })).status).toBe(400);
      expect((await editorAgent.put(`/api/users/${reporterUser._id}`).send({ fullName: 7 })).status).toBe(400);
      const users = await editorAgent.get('/api/users');
      expect(users.status).toBe(200);
      expect(users.body.users.every(user => user.password === undefined)).toBe(true);
    });

    test('missing session secret fails before a session store is created', () => {
      const previous = process.env.SESSION_SECRET;
      delete process.env.SESSION_SECRET;
      try { expect(() => require('../../config/session').createSessionMiddleware()).toThrow(/SESSION_SECRET/); }
      finally { process.env.SESSION_SECRET = previous; }
    });
  });

  describe('Weather Service with 15-Minute Cache (/api/weather)', () => {
    beforeEach(() => {
      weatherController.resetWeatherCache();
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ current: { time: Math.floor(Date.now() / 1000), temperature_2m: 24.2, weather_code: 0 } }) });
    });
    afterEach(() => { global.fetch = originalFetch; });

    test('GET /api/weather returns valid weather payload', async () => {
      const res = await request(app).get('/api/weather');
      expect(res.status).toBe(200);
      expect(res.body.city).toBeDefined();
      expect(typeof res.body.temp).toBe('number');
      expect(res.body.description).toBeDefined();
      expect(res.body.cached).toBe(false);
    });

    test('Subsequent call to /api/weather returns cached payload within 15 minutes', async () => {
      await request(app).get('/api/weather');

      const secondRes = await request(app).get('/api/weather');
      expect(secondRes.status).toBe(200);
      expect(secondRes.body.cached).toBe(true);
      expect(secondRes.body.fetchedAt).toBeDefined();
    });

    test('fetchWeather handles successful Open-Meteo responses', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          current: { time: Math.floor(Date.now() / 1000), temperature_2m: 24.2, weather_code: 0 }
        })
      });

      const data = await weatherController.fetchWeather('Haifa', 'mock_api_key');
      expect(data.city).toBe('Haifa');
      expect(data.temp).toBe(24);
      expect(data.description).toBe('Clear sky');

      global.fetch = originalFetch;
    });

    test('fetchWeather falls back gracefully on fetch error', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      await expect(weatherController.fetchWeather('Jerusalem')).rejects.toThrow('Network error');

      global.fetch = originalFetch;
    });
  });

  describe('Web Pages, Middlewares & Error Handling', () => {
    test('GET /login returns HTML login page', async () => {
      const res = await request(app).get('/login');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Sign In to The Daily Web');
    });

    test('GET /login when authenticated as editor redirects to /editor', async () => {
      const res = await editorAgent.get('/login');
      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/editor');
    });

    test('GET /login when authenticated as reporter redirects to /workspace', async () => {
      const res = await reporterAgent.get('/login');
      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/workspace');
    });

    test('GET /workspace for unauthenticated redirects to /login', async () => {
      const res = await request(app).get('/workspace');
      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/login');
    });

    test('GET /workspace for authenticated reporter succeeds', async () => {
      const res = await reporterAgent.get('/workspace');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Reporter Workspace');
    });

    test('GET /editor for unauthenticated redirects to /login', async () => {
      const res = await request(app).get('/editor');
      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/login');
    });

    test('GET /editor for reporter returns 403 Forbidden HTML error page', async () => {
      const res = await reporterAgent.get('/editor');
      expect(res.status).toBe(403);
      expect(res.text).toContain('Access Denied');
    });

    test('GET /editor for editor succeeds', async () => {
      const res = await editorAgent.get('/editor');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Editor Management Hub');
    });

    test('GET / renders home page', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('The Daily Web');
    });

    test('GET /unknown-route returns 404 HTML error', async () => {
      const res = await request(app).get('/unknown-route');
      expect(res.status).toBe(404);
      expect(res.text).toContain('404 - Page Not Found');
    });

    test('API unknown route returns 404 JSON', async () => {
      const res = await request(app).get('/api/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    test('errorHandler handles Mongoose duplicate key and validation errors correctly', () => {
      const { errorHandler } = require('../../middlewares/errorHandler');

      // 1. Duplicate key error
      const dupError = new Error('Duplicate key');
      dupError.code = 11000;
      dupError.keyValue = { username: 'test' };
      const res1 = { status: jest.fn().mockReturnThis(), json: jest.fn(), render: jest.fn() };
      const req1 = { originalUrl: '/api/test', headers: { accept: 'application/json' } };
      errorHandler(dupError, req1, res1, jest.fn());
      expect(res1.status).toHaveBeenCalledWith(400);
      expect(res1.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('already exists') }));

      // 2. Validation error
      const valError = new Error('Validation error');
      valError.name = 'ValidationError';
      valError.errors = {
        field1: { message: 'field1 is required' }
      };
      const res2 = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      errorHandler(valError, req1, res2, jest.fn());
      expect(res2.status).toHaveBeenCalledWith(400);
      expect(res2.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid input. Check required fields and length limits.' }));

      // 3. Web HTML generic error
      const genericError = new Error('Database unreachable');
      const res3 = { status: jest.fn().mockReturnThis(), render: jest.fn() };
      const req3 = { originalUrl: '/news', path: '/news', headers: {} };
      errorHandler(genericError, req3, res3, jest.fn());
      expect(res3.status).toHaveBeenCalledWith(500);
      expect(res3.render).toHaveBeenCalledWith('pages/error', expect.objectContaining({ message: 'An unexpected internal error occurred.' }));
    });

    test('requireAuth redirects unauthenticated web requests to /login', () => {
      const { requireAuth } = require('../../middlewares/auth');
      const res = { redirect: jest.fn() };
      const req = { originalUrl: '/dashboard', headers: {} };
      requireAuth(req, res, jest.fn());
      expect(res.redirect).toHaveBeenCalledWith('/login');
    });

    test('requireRole passes to next() when user has matching role', () => {
      const { requireRole } = require('../../middlewares/rbac');
      const nextFn = jest.fn();
      requireRole('reporter')({ currentUser: { role: 'reporter' }, headers: {} }, {}, nextFn);
      expect(nextFn).toHaveBeenCalled();
    });

    test('requireRole handles web 403 and api path 403', () => {
      const { requireRole } = require('../../middlewares/rbac');

      // Web forbidden render
      const resWeb403 = { status: jest.fn().mockReturnThis(), render: jest.fn() };
      requireRole('editor')({ currentUser: { role: 'reporter' }, originalUrl: '/editor-hub', headers: {} }, resWeb403, jest.fn());
      expect(resWeb403.status).toHaveBeenCalledWith(403);
      expect(resWeb403.render).toHaveBeenCalledWith('pages/error', expect.objectContaining({ title: 'Access Denied' }));

      // API path forbidden JSON
      const resApiPath = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      requireRole('editor')({ currentUser: { role: 'reporter' }, path: '/api/admin', headers: {} }, resApiPath, jest.fn());
      expect(resApiPath.status).toHaveBeenCalledWith(403);
    });

    test('requireRole handles unauthenticated web and api requests with and without session', () => {
      const { requireRole } = require('../../middlewares/rbac');

      // 1. No session at all, web request -> redirect to /login
      const resWebNoSession = { redirect: jest.fn() };
      requireRole('reporter')({ headers: {} }, resWebNoSession, jest.fn());
      expect(resWebNoSession.redirect).toHaveBeenCalledWith('/login');

      // 2. No session at all, api request -> 401 JSON
      const resApiNoSession = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      requireRole('reporter')({ originalUrl: '/api/test', headers: {} }, resApiNoSession, jest.fn());
      expect(resApiNoSession.status).toHaveBeenCalledWith(401);

      // 3. Session present but no user, web request -> redirect to /login
      const resWebEmptySession = { redirect: jest.fn() };
      requireRole('reporter')({ session: {}, headers: {} }, resWebEmptySession, jest.fn());
      expect(resWebEmptySession.redirect).toHaveBeenCalledWith('/login');

      // 4. Session present but no user, api request -> 401 JSON
      const resApiEmptySession = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      requireRole('reporter')({ session: {}, originalUrl: '/api/test', headers: {} }, resApiEmptySession, jest.fn());
      expect(resApiEmptySession.status).toHaveBeenCalledWith(401);
    });

    test('authController and userController branch edge cases', async () => {
      const { getCurrentUser, login } = require('../../controllers/authController');
      
      // getCurrentUser with session but no user
      const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      getCurrentUser({ session: {} }, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(401);

      // login missing only password
      const resNoPass = await request(app).post('/api/auth/login').send({ username: 'test_rep_1' });
      expect(resNoPass.status).toBe(400);

      // login missing only username
      const resNoUser = await request(app).post('/api/auth/login').send({ password: 'password123' });
      expect(resNoUser.status).toBe(400);

      // login catch block error forwarding
      const nextMock = jest.fn();
      const findSpy = jest.spyOn(User, 'findOne').mockRejectedValueOnce(new Error('Find error'));
      await login({ body: { username: 'test', password: '123' } }, {}, nextMock);
      expect(nextMock).toHaveBeenCalledWith(expect.any(Error));
      findSpy.mockRestore();

      // listUsers with unrecognized role and whitespace search
      const resFilter = await editorAgent.get('/api/users?role=unknown&search=%20%20');
      expect(resFilter.status).toBe(200);

      // createUser validation for missing individual fields
      const resMissingPass = await editorAgent.post('/api/users').send({ username: 'user_x', fullName: 'Full Name' });
      expect(resMissingPass.status).toBe(400);
      const resMissingName = await editorAgent.post('/api/users').send({ username: 'user_y', password: 'password123' });
      expect(resMissingName.status).toBe(400);

      // createUser default role 'reporter'
      const resDef = await editorAgent.post('/api/users').send({ username: 'user_def_role', password: 'password123', fullName: 'Def User' });
      expect(resDef.status).toBe(201);
      expect(resDef.body.user.role).toBe('reporter');

      // updateUser with invalid role (ignored) and empty body
      const resInvalidRole = await editorAgent.put(`/api/users/${resDef.body.user.id}`).send({ role: 'superuser' });
      expect(resInvalidRole.status).toBe(400);

      const resEmptyBody = await editorAgent.put(`/api/users/${resDef.body.user.id}`).send({});
      expect(resEmptyBody.status).toBe(200);
    });

    test('weather provider validation, descriptions and custom coordinates', async () => {
      const originalFetch = global.fetch;
      const makeResponse = (code = 0) => ({ current: { time: Math.floor(Date.now() / 1000), temperature_2m: 22, weather_code: code } });
      try {
        for (const code of [0, 3, 45, 61, 71, 80, 85, 95]) {
          global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => makeResponse(code) });
          expect((await weatherController.fetchWeather()).description).toEqual(expect.any(String));
        }
        global.fetch = jest.fn().mockResolvedValue({ ok: false });
        await expect(weatherController.fetchWeather()).rejects.toThrow('Weather provider unavailable');
        for (const current of [undefined, {}, { time: 1, temperature_2m: '22' }, { time: 1, temperature_2m: 22, weather_code: '0' }, { time: 'invalid', temperature_2m: 22, weather_code: 0 }]) {
          global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ current }) });
          await expect(weatherController.fetchWeather()).rejects.toThrow('Invalid weather response');
        }
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ current: { ...makeResponse().current, time: Math.floor(Date.now() / 1000) + 60 } }) });
        await expect(weatherController.fetchWeather()).rejects.toThrow('out of date');
        process.env.WEATHER_CITY = 'Haifa';
        process.env.WEATHER_LATITUDE = '32.794';
        process.env.WEATHER_LONGITUDE = '34.989';
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => makeResponse() });
        weatherController.resetWeatherCache();
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await weatherController.getWeather({}, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ city: 'Haifa' }));
        expect(global.fetch.mock.calls[0][0]).toContain('latitude=32.794');
      } finally {
        delete process.env.WEATHER_CITY;
        delete process.env.WEATHER_LATITUDE;
        delete process.env.WEATHER_LONGITUDE;
        global.fetch = originalFetch;
        weatherController.resetWeatherCache();
      }
    });

    test('errorHandler all branch variations', () => {
      const { errorHandler } = require('../../middlewares/errorHandler');

      // err.status
      const resStatus = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      errorHandler({ status: 403, message: 'Forbidden access' }, { originalUrl: '/api/secure' }, resStatus, jest.fn());
      expect(resStatus.status).toHaveBeenCalledWith(403);

      // err.statusCode and empty message
      const resStatusCode = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      errorHandler({ statusCode: 422 }, { originalUrl: '/api/data' }, resStatusCode, jest.fn());
      expect(resStatusCode.status).toHaveBeenCalledWith(422);
      expect(resStatusCode.json).toHaveBeenCalledWith({ error: 'An unexpected internal error occurred.' });

      // code 11000 with empty keyValue
      const resDup = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      errorHandler({ code: 11000 }, { originalUrl: '/api/data' }, resDup, jest.fn());
      expect(resDup.json).toHaveBeenCalledWith({ error: 'A record with this field already exists.' });

      // ValidationError with empty errors
      const resVal = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      errorHandler({ name: 'ValidationError' }, { originalUrl: '/api/data' }, resVal, jest.fn());
      expect(resVal.json).toHaveBeenCalledWith({ error: 'Invalid input. Check required fields and length limits.' });

      // Production mode stack suppression
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const resProd = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      errorHandler(new Error('Prod hidden error'), { originalUrl: '/api/data' }, resProd, jest.fn());
      process.env.NODE_ENV = prevEnv;
      expect(resProd.status).toHaveBeenCalledWith(500);

      // req.xhr branch
      const resXhr = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      errorHandler(new Error('XHR fail'), { xhr: true }, resXhr, jest.fn());
      expect(resXhr.json).toHaveBeenCalledWith({ error: 'An unexpected internal error occurred.' });

      // Web error with empty message
      const resWebEmpty = { status: jest.fn().mockReturnThis(), render: jest.fn() };
      errorHandler({}, { originalUrl: '/page', path: '/page', headers: {} }, resWebEmpty, jest.fn());
      expect(resWebEmpty.render).toHaveBeenCalledWith('pages/error', expect.objectContaining({ message: 'An unexpected internal error occurred.' }));
    });
  });
});
