const User = require('../models/User');
const { wantsJson } = require('./wantsJson');

// Runs on every request (registered in app.js). If the session has a user, reload that
// user from MongoDB, so a changed role or a deleted account takes effect immediately
// instead of trusting what was saved in the session at login.
async function loadCurrentUser(req, res, next) {
  req.currentUser = null;
  if (!req.session?.user) return next();
  try {
    const id = req.session.user.id;
    // Only valid ObjectIds reach the database; .select() never loads the password hash.
    const user = typeof id === 'string' && /^[a-f\d]{24}$/i.test(id)
      ? await User.findById(id).select('username fullName role').lean() : null;
    // Account was deleted: drop it from the session and continue as a guest.
    if (!user) {
      delete req.session.user;
      return next();
    }
    req.currentUser = { id: user._id.toString(), username: user.username, fullName: user.fullName, role: user.role };
    req.session.user = req.currentUser;
    next();
  } catch (err) { next(err); }
}

// Allows any signed-in user. Guests get 401 JSON on API calls, or a redirect to /login on pages.
function requireAuth(req, res, next) {
  if (req.currentUser) {
    return next();
  }

  if (wantsJson(req)) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  return res.redirect('/login');
}

module.exports = { requireAuth, loadCurrentUser };
