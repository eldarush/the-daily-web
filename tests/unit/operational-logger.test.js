const fs = require('fs');
const { EventEmitter } = require('events');
const { operationalLogger } = require('../../middlewares/operationalLogger');
const { writeLog } = require('../../config/logger');

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
  jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

function requestLog(req, status) {
  const res = new EventEmitter();
  res.statusCode = status;
  const next = jest.fn();
  operationalLogger(req, res, next);
  res.emit('finish');
  res.emit('close');
  expect(next).toHaveBeenCalledTimes(1);
}

test('every routine request emits metadata to console without creating a log file', () => {
  for (const req of [
    { method: 'PUT', path: '/api/editor/articles/id', route: { path: '/articles/:id' }, currentUser: { id: 'editor-id' } },
    { method: 'POST', path: '/api/auth/login', route: { path: '/login' }, session: { user: { id: 'signed-in-id' } } },
    { method: 'GET', path: '/api/articles', route: { path: '/' } },
    { method: 'POST', path: '/api/articles/search', route: { path: '/search' } },
    { method: 'GET', path: '/css/layout.css' },
    { method: 'GET', path: '/api/private-path-value', originalUrl: '/api/private-path-value?token=secret', body: { password: 'secret' }, headers: { cookie: 'secret' } }
  ]) requestLog(req, 200);
  requestLog({ method: 'GET', path: '/workspace' }, 302);

  expect(console.info).toHaveBeenCalledTimes(7);
  expect(fs.mkdirSync).not.toHaveBeenCalled();
  expect(fs.appendFileSync).not.toHaveBeenCalled();
  const entries = console.info.mock.calls.map(call => JSON.parse(call[0]));
  expect(entries.slice(0, 3).map(entry => entry.actor)).toEqual(['editor-id', 'signed-in-id', null]);
  expect(entries.every(entry => entry.level === 'info' && entry.event === 'http.request')).toBe(true);
  expect(entries[4]).toEqual(expect.objectContaining({ area: 'web', route: '(unmatched)' }));
  expect(JSON.stringify(entries)).not.toMatch(/private-path-value|password|cookie|secret/);
});

test.each([400, 401, 403, 404, 429, 500, 503])('status %i emits and persists the important or critical outcome once', status => {
  requestLog({ method: 'GET', path: '/api/users/private-id', route: { path: '/:id' } }, status);
  const level = status >= 500 ? 'error' : 'warn';
  expect(console[level]).toHaveBeenCalledTimes(1);
  expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
  const entry = JSON.parse(fs.appendFileSync.mock.calls[0][1]);
  expect(entry).toEqual(expect.objectContaining({ event: 'http.request', level, area: 'users', route: '/:id', status, actor: null }));
});

test('a response closed before finish is one important event, not a successful response', () => {
  const res = new EventEmitter();
  res.statusCode = 200;
  operationalLogger({ method: 'GET', path: '/api/articles' }, res, jest.fn());
  res.emit('close');
  res.emit('finish');
  expect(console.info).not.toHaveBeenCalled();
  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fs.appendFileSync.mock.calls[0][1]).status).toBe(499);
});

test('unexpected event fields never reach console or file records', () => {
  writeLog('request.error', { status: 500, method: 'GET', errorType: 'Error', password: 'private-password', message: 'private-exception', body: { token: 'private-token' } });
  const logged = console.error.mock.calls[0][0];
  expect(logged).not.toMatch(/private-|password|message|body/);
  expect(fs.appendFileSync.mock.calls[0][1]).toBe(logged + '\n');
});

test('a failed log destination is reported without exposing fields or crashing the request', () => {
  fs.mkdirSync.mockImplementation(() => { throw new Error('Private path'); });
  expect(() => writeLog('test', { status: 500, private: 'Do not expose' })).not.toThrow();
  expect(console.error).toHaveBeenLastCalledWith('[Log] Could not persist operational event');
  expect(JSON.stringify(console.error.mock.calls)).not.toMatch(/Private path|Do not expose/);
});

test('service events can be important or critical without inventing HTTP statuses', () => {
  writeLog('database.connected', {});
  writeLog('database.disconnected', { level: 'warn' });
  writeLog('database.error', { level: 'error', errorType: 'MongoError' });
  expect(console.info).toHaveBeenCalledTimes(1);
  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(console.error).toHaveBeenCalledTimes(1);
  const saved = fs.appendFileSync.mock.calls.map(call => JSON.parse(call[1]));
  expect(saved.map(entry => entry.level)).toEqual(['warn', 'error']);
  expect(saved.every(entry => entry.status === undefined)).toBe(true);
});

test('a failed readership write without an error name is retained as a critical event', async () => {
  const mongoose = require('mongoose');
  jest.spyOn(require('../../models/ViewAnalytics'), 'findOneAndUpdate').mockRejectedValue({});
  jest.spyOn(require('../../models/Article'), 'findByIdAndUpdate').mockResolvedValue({});
  await require('../../controllers/analyticsController').recordView(new mongoose.Types.ObjectId().toString());
  expect(console.error.mock.calls.some(call => {
    const entry = JSON.parse(call[0]);
    return entry.event === 'analytics.record.failed' && entry.level === 'error' && entry.errorType === 'Error';
  })).toBe(true);
  expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
});

test('a weather-provider failure without an error name is retained and returns unavailable', async () => {
  const weather = require('../../controllers/weatherController');
  weather.resetWeatherCache();
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockRejectedValue({});
  try {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await weather.getWeather({}, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(JSON.parse(console.warn.mock.calls[0][0])).toEqual(expect.objectContaining({
      event: 'weather.refresh.failed', level: 'warn', errorType: 'Error'
    }));
    expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
  } finally {
    global.fetch = originalFetch;
    weather.resetWeatherCache();
  }
});

test('an unnamed error after headers were sent is critical and still forwarded without a second response', () => {
  const err = {};
  const next = jest.fn();
  require('../../middlewares/errorHandler').errorHandler(err, { method: 'GET' }, { headersSent: true }, next);
  expect(next).toHaveBeenCalledWith(err);
  expect(JSON.parse(console.error.mock.calls[0][0])).toEqual(expect.objectContaining({
    event: 'request.error', level: 'error', errorType: 'Error'
  }));
  expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
});
