const mongoose = require('mongoose');
const { writeLog } = require('./logger');

/** Reuse the open Mongoose connection; server.js waits for this before listening. */
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
      writeLog('database.connected', {});
    });

    mongoose.connection.on('error', (err) => {
      writeLog('database.error', { level: 'error', errorType: err.name || 'Error' });
    });

    mongoose.connection.on('disconnected', () => {
      writeLog('database.disconnected', { level: 'warn' });
    });

    return conn;
  } catch (err) {
    writeLog('database.connect.failed', { level: 'error', errorType: err.name || 'Error' });
    throw err;
  }
}

async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
}

module.exports = { connectDB, disconnectDB };
