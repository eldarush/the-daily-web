const fs = require('fs');
const path = require('path');

// Emit every event to the console; retain only warning/error records on disk.
// Callers supply metadata only. Rotation and retention belong to deployment.
function writeLog(event, fields) {
  const level = fields.level === 'error' || fields.status >= 500 ? 'error'
    : fields.level === 'warn' || fields.status >= 400 ? 'warn' : 'info';
  const entry = JSON.stringify({
    time: new Date().toISOString(), level, event,
    area: fields.area, method: fields.method, route: fields.route,
    status: fields.status, actor: fields.actor, errorType: fields.errorType
  });
  console[level](entry);
  if (level === 'info') return;

  try {
    const directory = process.env.LOG_DIRECTORY || path.join(__dirname, '..', 'logs');
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(path.join(directory, 'operations.jsonl'), entry + '\n');
  } catch {
    // Logging must not turn a completed database operation into a failed request.
    console.error('[Log] Could not persist operational event');
  }
}

module.exports = { writeLog };
