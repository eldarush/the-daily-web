const User = require('../models/User');

// POST /api/auth/login
async function login(req, res, next) {
  try {
    const { username, password } = req.body || {};

    // Type checks also block NoSQL injection such as { "username": { "$ne": null } }.
    if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password.trim()) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = await User.findOne({ username: username.trim() });
    // bcrypt.compare runs inside comparePassword. The same message for "no such user"
    // and "wrong password" so an attacker cannot learn which usernames exist.
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Logging in = saving the user's id and role in the server-side session.
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
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/logout: deletes the session from MongoDB and clears the cookie.
function logout(req, res, next) {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('connect.sid');
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
  });
}

function getCurrentUser(req, res) {
  if (req.currentUser) {
    return res.status(200).json({ user: req.currentUser });
  }
  return res.status(401).json({ error: 'Not authenticated' });
}

module.exports = {
  login,
  logout,
  getCurrentUser
};
