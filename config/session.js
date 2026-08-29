const session = require('express-session');
const MongoStore = require('connect-mongo');

/**
 * Creates express-session middleware backed by MongoDB store.
 * Ensures sessions persist across server restarts.
 * @returns {import('express').RequestHandler}
 */
function createSessionMiddleware() {
  const mongoUrl = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/the_daily_web';
  const secret = process.env.SESSION_SECRET || 'the-daily-web-default-secret';

  return session({
    secret: secret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: mongoUrl,
      collectionName: 'sessions',
      ttl: 14 * 24 * 60 * 60, // 14 days
      autoRemove: 'native'
    }),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax'
    }
  });
}

module.exports = { createSessionMiddleware };
