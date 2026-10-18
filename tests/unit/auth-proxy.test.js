const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  MONGODB_URI: process.env.MONGODB_URI,
  SESSION_SECRET: process.env.SESSION_SECRET,
  TRUST_PROXY: process.env.TRUST_PROXY
};

describe.each([
  ['trusted HTTPS proxy', '1', 'https', true],
  ['untrusted forwarding header', undefined, 'https', false],
  ['invalid proxy setting', 'true', 'https', false],
  ['plain HTTP', '1', undefined, false]
])('Production login through %s', (label, trustProxy, protocol, expectsCookie) => {
  let mongo;
  let mongoose;
  let app;
  let store;

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock('dotenv', () => ({ config: jest.fn() }));
    mongo = await MongoMemoryServer.create();
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = mongo.getUri();
    process.env.SESSION_SECRET = 'isolated-proxy-test-secret-at-least-32-characters';
    if (trustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = trustProxy;

    mongoose = require('mongoose');
    await mongoose.connect(process.env.MONGODB_URI);
    app = require('../../app');
    store = require('../../config/session').getSessionStore();
    await require('../../models/User').create({
      username: 'proxy_reporter', password: 'password123',
      fullName: 'Proxy Reporter', role: 'reporter'
    });
  });

  afterAll(async () => {
    if (store) await store.close();
    if (mongoose) await mongoose.disconnect();
    if (mongo) await mongo.stop();
    jest.dontMock('dotenv');
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('issues a secure session cookie only for trusted HTTPS', async () => {
    let pending = request(app).post('/api/auth/login');
    if (protocol) pending = pending.set('X-Forwarded-Proto', protocol);
    const login = await pending.send({ username: 'proxy_reporter', password: 'password123' });
    expect(login.status).toBe(200);

    if (!expectsCookie) {
      expect(login.headers['set-cookie']).toBeUndefined();
      return;
    }

    expect(login.headers['set-cookie']).toBeDefined();
    const cookie = login.headers['set-cookie'][0];
    expect(cookie).toContain('; Secure');
    expect(cookie).toContain('; HttpOnly');
    const me = await request(app).get('/api/auth/me')
      .set('X-Forwarded-Proto', 'https').set('Cookie', cookie.split(';')[0]);
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('proxy_reporter');
  });
});
