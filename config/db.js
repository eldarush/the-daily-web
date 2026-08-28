const mongoose = require('mongoose');

/**
 * Connects to MongoDB with connection pooling and retry event listeners.
 * @returns {Promise<typeof mongoose>}
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/the_daily_web';
  
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000
    });

    mongoose.connection.on('connected', () => {
      console.log(`[MongoDB] Connected successfully to ${mongoose.connection.name}`);
    });

    mongoose.connection.on('error', (err) => {
      console.error('[MongoDB] Connection error:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('[MongoDB] Disconnected from database');
    });

    return conn;
  } catch (error) {
    console.error('[MongoDB] Initial connection error:', error.message);
    throw error;
  }
}

/**
 * Closes MongoDB connection cleanly.
 */
async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
}

module.exports = { connectDB, disconnectDB };
