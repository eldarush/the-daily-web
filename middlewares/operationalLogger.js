const { writeLog } = require('../config/logger');

function operationalLogger(req, res, next) {
  const feature = req.path.split('/')[2];
  const area = ['auth', 'users', 'reporter', 'editor', 'comments', 'analytics', 'articles', 'weather'].includes(feature)
    ? feature : 'web';
  let logged = false;
  const record = status => {
    if (logged) return;
    logged = true;
    // Read identity and the matched route at completion; never record raw URLs,
    // query values, bodies or cookies. Unknown/static paths use a fixed label.
    writeLog('http.request', {
      area, method: req.method, route: req.route?.path || '(unmatched)', status,
      actor: req.currentUser?.id || req.session?.user?.id || null
    });
  };
  res.once('finish', () => record(res.statusCode));
  // A closed response without finish is an unusual, incomplete request. The
  // internal 499 log status does not attempt to send a response to the client.
  res.once('close', () => record(499));
  next();
}

module.exports = { operationalLogger };
