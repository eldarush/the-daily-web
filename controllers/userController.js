const User = require('../models/User');

/**
 * Lists or searches users (CRUD: Read).
 */
async function listUsers(req, res, next) {
  try {
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
  } catch (error) {
    next(error);
  }
}

/**
 * Gets single user by ID (CRUD: Read).
 */
async function getUserById(req, res, next) {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
}

/**
 * Creates new user (CRUD: Create).
 */
async function createUser(req, res, next) {
  try {
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
  } catch (error) {
    next(error);
  }
}

/**
 * Updates user (CRUD: Update).
 */
async function updateUser(req, res, next) {
  try {
    const { fullName, role, password } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (fullName) user.fullName = fullName.trim();
    if (role && ['reporter', 'editor'].includes(role)) user.role = role;
    if (password) user.password = password; // pre-save will re-hash

    await user.save();
    return res.status(200).json({ message: 'User updated successfully', user: user.toSafeObject() });
  } catch (error) {
    next(error);
  }
}

/**
 * Deletes user (CRUD: Delete).
 */
async function deleteUser(req, res, next) {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser
};
