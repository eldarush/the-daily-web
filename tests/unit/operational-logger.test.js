const fs = require('fs');
const { EventEmitter } = require('events');
const { operationalLogger } = require('../../middlewares/operationalLogger');
const { writeLog } = require('../../config/logger');
afterEach(() => jest.restoreAllMocks());

test('operational logs cover authorized, rejected and unmatched mutations without payloads', () => {
  jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
  const append = jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
  for (const req of [
    { method: 'PUT', path: '/api/editor/articles/id', route: { path: '/articles/:id' }, currentUser: { id: 'editor-id' } },
    { method: 'POST', path: '/api/auth/login', route: { path: '/login' }, session: { user: { id: 'signed-in-id' } } },
    { method: 'DELETE', path: '/api/users/missing' }
  ]) {
    const res = new EventEmitter(); res.statusCode = 403;
    const next = jest.fn();
    operationalLogger(req, res, next); res.emit('finish');
    expect(next).toHaveBeenCalledTimes(1);
  }
  const entries = append.mock.calls.map(call => JSON.parse(call[1]));
  expect(entries.map(e => e.actor)).toEqual(['editor-id', 'signed-in-id', null]);
  expect(entries[2].route).toBe('(unmatched)');
  expect(entries.every(e => e.status === 403)).toBe(true);
});
test('public reads and feed searches do not create per-reader operational records', () => {
  const append = jest.spyOn(fs, 'appendFileSync');
  for (const req of [{ method: 'GET', path: '/api/editor/articles' }, { method: 'POST', path: '/api/articles/search' }]) {
    const res = new EventEmitter();
    operationalLogger(req, res, jest.fn()); res.emit('finish');
  }
  expect(append).not.toHaveBeenCalled();
});
test('a failed log destination is reported without exposing event fields or crashing the request', () => {
  jest.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw new Error('Private path'); });
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => writeLog('test', { private: 'Do not expose' })).not.toThrow();
  expect(log).toHaveBeenCalledWith('[Log] Could not persist operational event');
});
