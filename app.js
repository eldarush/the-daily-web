const express = require('express');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const { createSessionMiddleware } = require('./config/session');
const { errorHandler } = require('./middlewares/errorHandler');

const authRoutes = require('./routes/api/authRoutes');
const userRoutes = require('./routes/api/userRoutes');
const weatherRoutes = require('./routes/api/weatherRoutes');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(createSessionMiddleware());

app.use((req, res, next) => {
  res.locals.currentUser = (req.session && req.session.user) ? req.session.user : null;
  res.locals.path = req.path;
  next();
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/weather', weatherRoutes);

// Web routes
app.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    if (req.session.user.role === 'editor') return res.redirect('/editor');
    return res.redirect('/workspace');
  }
  res.render('pages/login', {
    title: 'Sign In - The Daily Web',
    error: null
  });
});

app.get('/', (req, res) => {
  res.render('pages/home', {
    title: 'The Daily Web - Home',
    articles: []
  });
});

app.get('/workspace', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  res.render('pages/workspace', {
    title: 'Reporter Workspace',
    user: req.session.user
  });
});

app.get('/editor', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  if (req.session.user.role !== 'editor') {
    return res.status(403).render('pages/error', {
      title: 'Access Denied',
      message: 'Editor privileges required to view the editor hub.'
    });
  }
  res.render('pages/editor', {
    title: 'Editor Management Hub',
    user: req.session.user
  });
});

// 404 handler
app.use((req, res, next) => {
  if (req.xhr || req.path.startsWith('/api') || req.headers.accept?.includes('application/json')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.status(404).render('pages/error', {
    title: '404 - Page Not Found',
    message: 'The page you requested could not be found.'
  });
});

app.use(errorHandler);

module.exports = app;
