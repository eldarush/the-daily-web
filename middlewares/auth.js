/**
 * Middleware ensuring user is authenticated via active session.
 * Rejects unauthenticated requests with HTTP 401 (API) or redirects to /login (Web).
 * @param {import('express').Request} req - Express request.
 * @param {import('express').Response} res - Express response.
 * @param {import('express').NextFunction} next - Express next callback.
 * @returns {void}
 */
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
