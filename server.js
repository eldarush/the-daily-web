const app = require('./app');
const { writeLog } = require('./config/logger');
const { connectDB, disconnectDB } = require('./config/db');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Startup waits for the main database before accepting HTTP requests.
    await connectDB();
    const server = app.listen(PORT, () => {
      console.log(`[Server] The Daily Web running on http://localhost:${PORT}`);
    });

    const shutdown = async () => {
      console.log('\n[Server] Gracefully shutting down...');
      server.close(async () => {
        await disconnectDB();
        console.log('[Server] Closed all connections. Exiting process.');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    writeLog('server.start.failed', { level: 'error', errorType: err.name || 'Error' });
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
