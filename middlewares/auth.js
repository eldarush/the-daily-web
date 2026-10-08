const User = require('../models/User');

async function loadCurrentUser(req, res, next) {
  req.currentUser = null;
  if (!req.session?.user) return next();
  try {
    const id = req.session.user.id;
    const user = typeof id === 'string' && /^[a-f\d]{24}$/i.test(id)
      ? await User.findById(id).select('username fullName role').lean() : null;
    if (!user) {
      delete req.session.user;
      return next();
    }
    req.currentUser = { id: user._id.toString(), username: user.username, fullName: user.fullName, role: user.role };
    req.session.user = req.currentUser;
    next();
  } catch (err) { next(err); }
}

function requireAuth(req, res, next) {
  if (req.currentUser) {
    return next();
  }

  const isApi = req.originalUrl?.startsWith('/api') || req.path?.startsWith('/api') || req.xhr || req.headers?.accept?.includes('application/json');

  if (isApi) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  return res.redirect('/login');
}

module.exports = { requireAuth, loadCurrentUser };
