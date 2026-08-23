const User = require('../models/User');

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const listUsers = wrap(async (req, res) => {
  const { search, role } = req.query;
  const query = {};

  if (role && ['reporter', 'editor'].includes(role)) {
    query.role = role;
  }

  if (search && search.trim()) {
    query.$or = [
      { username: { $regex: search.trim(), $options: 'i' } },
      { fullName: { $regex: search.trim(), $options: 'i' } }
    ];
  }

  const users = await User.find(query).select('-password').sort({ createdAt: -1 });
  return res.status(200).json({ users });
});

const getUserById = wrap(async (req, res) => {
  const user = await User.findById(req.params.id).select('-password');
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.status(200).json({ user });
});

const createUser = wrap(async (req, res) => {
  const { username, password, fullName, role } = req.body;

  if (!username || !password || !fullName) {
    return res.status(400).json({ error: 'Username, password, and full name are required.' });
  }

  const existing = await User.findOne({ username: username.trim() });
  if (existing) {
    return res.status(400).json({ error: 'Username already in use.' });
  }

  const user = new User({
    username: username.trim(),
    password,
    fullName: fullName.trim(),
    role: role || 'reporter'
  });

  await user.save();
  return res.status(201).json({ message: 'User created successfully', user: user.toSafeObject() });
});

const updateUser = wrap(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const { fullName, role, password } = req.body;
  if (fullName) user.fullName = fullName.trim();
  if (role && ['reporter', 'editor'].includes(role)) user.role = role;
  if (password) user.password = password;

  await user.save();
  return res.status(200).json({ message: 'User updated successfully', user: user.toSafeObject() });
});

const deleteUser = wrap(async (req, res) => {
  if (req.session.user && req.session.user.id === req.params.id) {
    return res.status(400).json({ error: 'Cannot delete your own account while logged in.' });
  }

  const deleted = await User.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.status(200).json({ message: 'User deleted successfully' });
});

module.exports = {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser
};
