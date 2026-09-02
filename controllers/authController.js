const User = require('../models/User');

/**
 * Handles user authentication (login) and session initialization.
 */
async function login(req, res, next) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = await User.findOne({ username: username.trim() });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    req.session.user = {
      id: user._id.toString(),
      username: user.username,
      fullName: user.fullName,
      role: user.role
    };

    return res.status(200).json({
      message: 'Login successful',
      user: user.toSafeObject()
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Destroys current session and clears the session cookie.
 */
function logout(req, res, next) {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('connect.sid');
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
  });
}

/**
 * Returns current authenticated session user.
 */
function getCurrentUser(req, res) {
  if (req.session && req.session.user) {
    return res.status(200).json({ user: req.session.user });
  }
  return res.status(401).json({ error: 'Not authenticated' });
}

module.exports = {
  login,
  logout,
  getCurrentUser
};
