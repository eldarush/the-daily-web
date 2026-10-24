const session = require('express-session');
const MongoStore = require('connect-mongo');

let storeInstance = null;

// Builds the session middleware. A session is server-side data (who is logged in);
// the browser only holds a signed cookie (connect.sid) with the session id.
function createSessionMiddleware() {
  // Secrets come from .env (never committed; see .gitignore and .env.example).
  const mongoUrl = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/the_daily_web';
  // Sign the session ID cookie to detect client-side tampering.
  const secret = process.env.SESSION_SECRET;
  // Refuse to start without a secret; production also requires a long one (32+ chars).
  if (typeof secret !== 'string' || !secret.trim() || (process.env.NODE_ENV === 'production' && secret.trim().length < 32)) {
    throw new Error('SESSION_SECRET is required and must contain at least 32 characters in production.');
  }

  // Sessions are stored in MongoDB ('sessions' collection), so logins survive a server restart.
  // MongoDB deletes expired sessions itself through a TTL index ('native').
  storeInstance = MongoStore.create({
    mongoUrl: mongoUrl,
    collectionName: 'sessions',
    ttl: 14 * 24 * 60 * 60,
    autoRemove: 'native'
  });

  // Store expiration and browser retention are different settings: the cookie
  // below lasts one day. A restart can reuse a valid Mongo-backed session only
  // while the browser retains its ID and the signing secret remains unchanged.
  return session({
    secret: secret,
    resave: false,
    // No session (and no cookie) is created until we store something in it, e.g. at login.
    saveUninitialized: false,
    store: storeInstance,
    cookie: {
      httpOnly: true, // JavaScript in the page cannot read the cookie (protects against XSS theft)
      secure: process.env.NODE_ENV === 'production', // HTTPS-only cookie in production
      maxAge: 24 * 60 * 60 * 1000, // the cookie lasts one day
      sameSite: 'lax' // not sent on cross-site POSTs (basic CSRF protection)
    }
  });
}

function getSessionStore() {
  return storeInstance;
}

module.exports = { createSessionMiddleware, getSessionStore };
