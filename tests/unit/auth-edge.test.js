const User = require('../../models/User');
const { loadCurrentUser } = require('../../middlewares/auth');
const { errorHandler } = require('../../middlewares/errorHandler');
const authController = require('../../controllers/authController');
const userController = require('../../controllers/userController');

const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn(), render: jest.fn() });
const flush = () => new Promise(resolve => setImmediate(resolve));

afterEach(() => jest.restoreAllMocks());

describe('Authentication boundary cases', () => {
  test('malformed stored identities are removed without a database query', async () => {
    const lookup = jest.spyOn(User, 'findById');
    for (const id of ['bad-id', { value: '012345678901234567890123' }, undefined]) {
      const req = { session: { user: { id, role: 'editor' } } };
      const next = jest.fn();
      await loadCurrentUser(req, {}, next);
      expect(req.currentUser).toBeNull();
      expect(req.session.user).toBeUndefined();
      expect(next).toHaveBeenCalledWith();
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  test('public guests do not query users and lookup failures reach shared error handling', async () => {
    const failure = new Error('Database credentials must stay private');
    const lookup = jest.spyOn(User, 'findById').mockImplementation(() => { throw failure; });
    const guestNext = jest.fn();
    await loadCurrentUser({ session: {} }, {}, guestNext);
    expect(lookup).not.toHaveBeenCalled();
    const next = jest.fn();
    await loadCurrentUser({ session: { user: { id: '012345678901234567890123' } } }, {}, next);
    expect(next).toHaveBeenCalledWith(failure);
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = response();
    errorHandler(failure, { method: 'GET', originalUrl: '/api/auth/me' }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'An unexpected internal error occurred.' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('credentials');
  });

  test('absent request bodies produce client errors rather than destructuring exceptions', async () => {
    const loginRes = response();
    await authController.login({}, loginRes, jest.fn());
    expect(loginRes.status).toHaveBeenCalledWith(400);
    const createRes = response();
    userController.createUser({}, createRes, jest.fn());
    await flush();
    expect(createRes.status).toHaveBeenCalledWith(400);
    const user = { save: jest.fn().mockResolvedValue(), toSafeObject: () => ({ id: '012345678901234567890123' }) };
    jest.spyOn(User, 'findById').mockResolvedValue(user);
    const updateRes = response();
    userController.updateUser({ params: { id: '012345678901234567890123' } }, updateRes, jest.fn());
    await flush();
    expect(updateRes.status).toHaveBeenCalledWith(200);
  });

  test('array and object user filters return validation errors without searching', async () => {
    const lookup = jest.spyOn(User, 'find');
    for (const query of [{ search: ['name'] }, { role: { value: 'editor' } }]) {
      const res = response();
      userController.listUsers({ query }, res, jest.fn());
      await flush();
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('Shared error response boundaries', () => {
  test('already sent responses forward errors without trying to send twice', () => {
    const err = new Error('Stream failure');
    const next = jest.fn();
    const res = { headersSent: true };
    errorHandler(err, {}, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  test.each([
    [{ type: 'entity.too.large', message: 'raw body' }, 413, 'Request body is too large.'],
    [{ name: 'CastError', message: 'private invalid value' }, 400, 'Invalid resource ID.']
  ])('parser and database input failures have safe client responses', (err, status, message) => {
    const res = response();
    errorHandler(err, { originalUrl: '/api/test' }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith({ error: message });
  });
});

 describe('Session configuration validation', () => {
  test('missing, blank, and short production secrets fail before opening a store', () => {
    const previousSecret = process.env.SESSION_SECRET;
    const previousEnv = process.env.NODE_ENV;
    try {
      const { createSessionMiddleware } = require('../../config/session');
      for (const secret of [undefined, '', '   ']) {
        if (secret === undefined) delete process.env.SESSION_SECRET;
        else process.env.SESSION_SECRET = secret;
        expect(() => createSessionMiddleware()).toThrow(/SESSION_SECRET/);
      }
      process.env.NODE_ENV = 'production';
      process.env.SESSION_SECRET = 'too-short';
      expect(() => createSessionMiddleware()).toThrow(/32 characters/);
    } finally {
      if (previousSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previousSecret;
      process.env.NODE_ENV = previousEnv;
    }
  });
});
