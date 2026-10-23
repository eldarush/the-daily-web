const express = require('express');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const { createSessionMiddleware } = require('./config/session');
const { loadCurrentUser } = require('./middlewares/auth');
const { requireRole } = require('./middlewares/rbac');
const { errorHandler } = require('./middlewares/errorHandler');
const { wantsJson } = require('./middlewares/wantsJson');
const { operationalLogger } = require('./middlewares/operationalLogger');
const Article = require('./models/Article');

const authRoutes = require('./routes/api/authRoutes');
const userRoutes = require('./routes/api/userRoutes');
const weatherRoutes = require('./routes/api/weatherRoutes');
const reporterRoutes = require('./routes/api/reporterRoutes');
const editorRoutes = require('./routes/api/editorRoutes');
const analyticsRoutes = require('./routes/api/analyticsRoutes');
const feedRoutes = require('./routes/api/feedRoutes');
const commentRoutes = require('./routes/api/commentRoutes');
const webRoutes = require('./routes/webRoutes');

const app = express();
app.locals.currentUser = null;
app.locals.path = '';

// Enable only behind one trusted reverse proxy.
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Large reading histories are sent in JSON instead of a long URL.
app.use('/api/articles/search', express.json({ limit: '1mb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
// the browser build of chart.js, straight from node_modules
app.use('/vendor/chart.js', express.static(path.join(__dirname, 'node_modules/chart.js/dist')));

// Order matters: the session must load before loadCurrentUser reads it,
// and both run before any route, so every route knows who is calling.
app.use(createSessionMiddleware());
app.use(operationalLogger);
app.use(loadCurrentUser);

app.use((req, res, next) => {
  res.locals.currentUser = req.currentUser;
  res.locals.path = req.path;
  next();
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/reporter', reporterRoutes);
app.use('/api/editor', editorRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/articles', feedRoutes);
app.use('/api', commentRoutes);

// Web routes
app.get('/login', (req, res) => {
  // req.currentUser is the user loadCurrentUser just re-read from MongoDB.
  if (req.currentUser) {
    if (req.currentUser.role === 'editor') return res.redirect('/editor');
    return res.redirect('/workspace');
  }
  res.render('pages/login', {
    title: 'Sign In - The Daily Web',
    error: null
  });
});

app.use('/', webRoutes);

// requireRole has already sent guests to /login and other roles to a 403 page.
app.get('/workspace', requireRole('reporter'), (req, res) => {
  res.render('pages/workspace', {
    title: 'Reporter Workspace',
    user: req.currentUser,
    categories: Article.ARTICLE_CATEGORIES
  });
});

app.get('/editor', requireRole('editor'), (req, res) => {
  res.render('pages/editor', {
    title: 'Editor Management Hub',
    user: req.currentUser,
    categories: Article.ARTICLE_CATEGORIES,
    statuses: Article.ARTICLE_STATUSES
  });
});

// Render the chart controls; the browser fetches data for the selected article.
app.get('/editor/analytics', requireRole('editor'), (req, res) => {
  res.render('pages/analytics', {
    title: 'Impact Analytics',
    user: req.currentUser
  });
});

// 404 handler
app.use((req, res, next) => {
  if (wantsJson(req)) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.status(404).render('pages/error', {
    title: '404 - Page Not Found',
    message: 'The page you requested could not be found.'
  });
});

app.use(errorHandler);

module.exports = app;
