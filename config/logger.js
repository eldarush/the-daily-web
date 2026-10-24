const fs = require('fs');
const path = require('path');

// Best-effort local JSONL persistence. The synchronous writes briefly occupy the
// request thread; rotation/retention belong to deployment, not this helper.
function writeLog(event, fields) {
  try {
    const directory = process.env.LOG_DIRECTORY || path.join(__dirname, '..', 'logs');
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(path.join(directory, 'operations.jsonl'), JSON.stringify({ time: new Date().toISOString(), event, ...fields }) + '\n');
  } catch {
    // Logging must not turn a completed database operation into a failed request.
    console.error('[Log] Could not persist operational event');
  }
}

module.exports = { writeLog };
