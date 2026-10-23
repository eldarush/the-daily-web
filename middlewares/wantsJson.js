// True when the caller expects JSON (an API call or Ajax) rather than an HTML page.
// Guards and error handlers use it to answer with JSON, or with a redirect or a page.
function wantsJson(req) {
  return Boolean(req.originalUrl?.startsWith('/api') || req.path?.startsWith('/api') || req.xhr ||
    req.headers?.accept?.includes('application/json'));
}

module.exports = { wantsJson };
