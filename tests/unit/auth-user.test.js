const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;
let app;
let request;
let User;
let resetWeatherCache;

describe('Eldar Module 1: Core Auth, User CRUD & Weather Service', () => {
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

    // Connect mongoose
    await mongoose.connect(uri);

    // Require app and dependencies after setting process.env.MONGODB_URI
    app = require('../../app');
    request = require('supertest');
    User = require('../../models/User');
    resetWeatherCache = require('../../controllers/weatherController').resetWeatherCache;

    // Seed test users
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

      // Update non-existent user
      const updateNonExistent = await editorAgent.put(`/api/users/${new mongoose.Types.ObjectId()}`).send({ fullName: 'Nobody' });
      expect(updateNonExistent.status).toBe(404);
    });
  });

  describe('Weather Service with 15-Minute Cache (/api/weather)', () => {
    beforeEach(() => {
      resetWeatherCache();
    });

    test('GET /api/weather returns valid weather payload', async () => {
      const res = await request(app).get('/api/weather');
      expect(res.status).toBe(200);
      expect(res.body.city).toBeDefined();
      expect(typeof res.body.temp).toBe('number');
      expect(res.body.description).toBeDefined();
      expect(res.body.cached).toBe(false);
    });

    test('Subsequent call to /api/weather returns cached payload within 15 minutes', async () => {
      // First call: fetches / initializes cache
      await request(app).get('/api/weather');

      // Second call immediately after: must return cached: true
      const secondRes = await request(app).get('/api/weather');
      expect(secondRes.status).toBe(200);
      expect(secondRes.body.cached).toBe(true);
      expect(typeof secondRes.body.cacheAgeSeconds).toBe('number');
    });
  });

  describe('Web Pages & Error Handling', () => {
    test('GET /login returns HTML login page', async () => {
      const res = await request(app).get('/login');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Sign In to The Daily Web');
    });

    test('GET /login when authenticated redirects to appropriate area', async () => {
      const res = await editorAgent.get('/login');
      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/editor');
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

    test('GET /editor for reporter returns 403 Forbidden', async () => {
      const res = await reporterAgent.get('/editor');
      expect(res.status).toBe(403);
    });

    test('GET /editor for editor succeeds', async () => {
      const res = await editorAgent.get('/editor');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Editor Management Hub');
    });

    test('GET /unknown-route returns 404', async () => {
      const res = await request(app).get('/unknown-route');
      expect(res.status).toBe(404);
    });

    test('API unknown route returns 404 JSON', async () => {
      const res = await request(app).get('/api/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    test('errorHandler formats duplicate key and validation errors', () => {
      const { errorHandler } = require('../../middlewares/errorHandler');
      
      // Duplicate key error
      const dupError = new Error('Duplicate');
      dupError.code = 11000;
      dupError.keyValue = { username: 'test' };
      const res1 = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        render: jest.fn()
      };
      const req1 = { originalUrl: '/api/test', path: '/test', headers: { accept: 'application/json' } };
      errorHandler(dupError, req1, res1, jest.fn());
      expect(res1.status).toHaveBeenCalledWith(400);
      expect(res1.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('already exists') }));

      // Validation error
      const valError = new Error('Validation');
      valError.name = 'ValidationError';
      valError.errors = { field1: { message: 'field1 is required' } };
      const res2 = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      errorHandler(valError, req1, res2, jest.fn());
      expect(res2.status).toHaveBeenCalledWith(400);

      // Web HTML error
      const webError = new Error('Server Crash');
      const res3 = {
        status: jest.fn().mockReturnThis(),
        render: jest.fn()
      };
      const req3 = { originalUrl: '/some-page', path: '/some-page', headers: {} };
      errorHandler(webError, req3, res3, jest.fn());
      expect(res3.status).toHaveBeenCalledWith(500);
      expect(res3.render).toHaveBeenCalledWith('pages/error', expect.objectContaining({ message: 'Server Crash' }));
    });
  });
});
