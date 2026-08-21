function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }

  const isApi = req.originalUrl?.startsWith('/api') || req.path?.startsWith('/api') || req.xhr || req.headers.accept?.includes('application/json');

  if (isApi) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  return res.redirect('/login');
}

module.exports = { requireAuth };
