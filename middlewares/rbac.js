function requireRole(role) {
  return function(req, res, next) {
    const isApi = req.originalUrl?.startsWith('/api') || req.path?.startsWith('/api') || req.xhr || req.headers?.accept?.includes('application/json');

    if (!req.session || !req.session.user) {
      if (isApi) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      return res.redirect('/login');
    }

    if (req.session.user.role !== role) {
      if (isApi) {
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
