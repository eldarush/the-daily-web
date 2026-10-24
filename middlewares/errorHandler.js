const { writeLog } = require('../config/logger');
const { wantsJson } = require('./wantsJson');

function errorHandler(err, req, res, next) {
  // Do not attempt a second JSON/page response after headers have been sent;
  // Express must finish handling that already-started response.
  if (res.headersSent) return next(err);
  let statusCode = err.statusCode || err.status || 500;
  let message = 'An unexpected internal error occurred.';

  if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Invalid JSON body.';
  } else if (err.type === 'entity.too.large') {
    statusCode = 413;
    message = 'Request body is too large.';
  } else if (err.code === 11000) {
    statusCode = 400;
    message = 'A record with this field already exists.';
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Invalid input. Check required fields and length limits.';
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid resource ID.';
  } else if (statusCode >= 400 && statusCode < 500) {
    message = err.message || message;
  } else {
    statusCode = 500;
    // Do not log request bodies, query values, credentials, or exception messages.
    console.error(`[${new Date().toISOString()}] Request failed`, { method: req.method, errorType: err.name || 'Error' });
    writeLog('request.error', { method: req.method, errorType: err.name || 'Error', status: statusCode });
  }

  if (wantsJson(req)) {
    return res.status(statusCode).json({ error: message });
  }
  return res.status(statusCode).render('pages/error', { title: 'Error', message });
}

module.exports = { errorHandler };
