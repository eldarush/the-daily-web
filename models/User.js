const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

/**
 * User schema definition.
 * Enforces role assignment (reporter, editor) and unique username.
 */
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters']
  },
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true
  },
  role: {
    type: String,
    enum: ['reporter', 'editor'],
    default: 'reporter',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

/**
 * Pre-save middleware: Hashes the password securely with bcrypt (salt 12).
 */
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

/**
 * Verifies candidate password against stored bcrypt hash.
 * @param {string} candidatePassword - Plaintext password to test.
 * @returns {Promise<boolean>} True if matching, false otherwise.
 */
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * Serializes user document into a safe representation without password hash.
 * @returns {{ id: any, username: string, fullName: string, role: string, createdAt: Date }}
 */
userSchema.methods.toSafeObject = function() {
  return {
    id: this._id,
    username: this.username,
    fullName: this.fullName,
    role: this.role,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model('User', userSchema);
