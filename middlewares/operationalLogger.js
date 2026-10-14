const { writeLog } = require('../config/logger');

function operationalLogger(req, res, next) {
  const area = req.path.split('/')[2];
  if (['POST', 'PUT', 'DELETE'].includes(req.method) &&
      ['auth', 'users', 'reporter', 'editor', 'comments', 'analytics'].includes(area)) {
    // Log the final outcome using route templates, without request bodies or query values.
    res.once('finish', () => writeLog('api.operation', {
      area, method: req.method, route: req.route?.path || '(unmatched)', status: res.statusCode,
      actor: req.currentUser?.id || req.session?.user?.id || null
    }));
  }
  next();
}

module.exports = { operationalLogger };
