function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;
  const timestamp = new Date().toISOString();
  
  console.error(`[${timestamp}] [ERROR] ${req.method} ${req.originalUrl}:`, err.message);
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    console.error(err.stack);
  }

  // Handle Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(400).json({ error: `A record with this ${field} already exists.` });
  }

  // Handle Mongoose validation errors
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors || {}).map(e => e.message);
    return res.status(400).json({ error: messages.join(', ') });
  }

  if (req.xhr || req.path?.startsWith('/api') || req.originalUrl?.startsWith('/api') || req.headers?.accept?.includes('application/json')) {
    return res.status(statusCode).json({
      error: err.message || 'An unexpected internal error occurred.'
    });
  }

  res.status(statusCode).render('pages/error', {
    title: 'Error',
    message: err.message || 'An unexpected error occurred.'
  });
}

module.exports = { errorHandler };
