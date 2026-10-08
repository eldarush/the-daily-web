const User = require('../models/User');

const validId = id => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
const validString = value => typeof value === 'string' && value.trim().length > 0;
const validRole = value => ['reporter', 'editor'].includes(value);

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const listUsers = wrap(async (req, res) => {
  const { search, role } = req.query;
  const query = {};
  if ((search !== undefined && typeof search !== 'string') || (role !== undefined && typeof role !== 'string')) {
    return res.status(400).json({ error: 'Search and role must be strings.' });
  }

  if (role && ['reporter', 'editor'].includes(role)) {
    query.role = role;
  }

  if (search && search.trim()) {
    query.$or = [
      { username: { $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { fullName: { $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
    ];
  }

  const users = await User.find(query).select('-password').sort({ createdAt: -1 });
  return res.status(200).json({ users });
});

const getUserById = wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid user ID.' });
  const user = await User.findById(req.params.id).select('-password');
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.status(200).json({ user });
});

const createUser = wrap(async (req, res) => {
  const { username, password, fullName, role } = req.body || {};

  if (!validString(username) || username.trim().length < 3 || !validString(password) || password.length < 6 || !validString(fullName) || (role !== undefined && !validRole(role))) {
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
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid user ID.' });
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const { fullName, role, password } = req.body || {};
  if ((fullName !== undefined && !validString(fullName)) || (role !== undefined && !validRole(role)) || (password !== undefined && (!validString(password) || password.length < 6))) {
    return res.status(400).json({ error: 'Invalid full name, role, or password.' });
  }
  if (fullName !== undefined) user.fullName = fullName.trim();
  if (role !== undefined) user.role = role;
  if (password !== undefined) user.password = password;

  await user.save();
  return res.status(200).json({ message: 'User updated successfully', user: user.toSafeObject() });
});

const deleteUser = wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid user ID.' });
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
