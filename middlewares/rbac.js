// Role-based access control. Routers use it once, e.g. router.use(requireRole('editor')),
// so every route in that router is protected.
//   401 = not signed in (who are you?)   403 = signed in, but the wrong role (not allowed)
// The role comes from req.currentUser, which loadCurrentUser just re-read from MongoDB.
const { wantsJson } = require('./wantsJson');
const { requireAuth } = require('./auth');

function requireRole(role) {
  return function(req, res, next) {
    // guests get exactly what requireAuth gives them: 401 JSON, or a redirect to /login
    if (!req.currentUser) return requireAuth(req, res, next);

    if (req.currentUser.role !== role) {
      if (wantsJson(req)) {
        return res.status(403).json({ error: `Forbidden: Requires '${role}' role` });
      }
      return res.status(403).render('pages/error', {
        title: 'Access Denied',
        message: `You do not have permission to access this area. Requires '${role}' role.`
      });
    }

    next();
  };
}

module.exports = { requireRole };
