const session = require('express-session');
const MongoStore = require('connect-mongo');

let storeInstance = null;

function createSessionMiddleware() {
  const mongoUrl = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/the_daily_web';
  const secret = process.env.SESSION_SECRET;
  if (typeof secret !== 'string' || !secret.trim() || (process.env.NODE_ENV === 'production' && secret.trim().length < 32)) {
    throw new Error('SESSION_SECRET is required and must contain at least 32 characters in production.');
  }

  storeInstance = MongoStore.create({
    mongoUrl: mongoUrl,
    collectionName: 'sessions',
    ttl: 14 * 24 * 60 * 60,
    autoRemove: 'native'
  });

  return session({
    secret: secret,
    resave: false,
    saveUninitialized: false,
    store: storeInstance,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    }
  });
}

function getSessionStore() {
  return storeInstance;
}

module.exports = { createSessionMiddleware, getSessionStore };
