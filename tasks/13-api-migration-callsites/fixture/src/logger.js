// Logging API. CURRENT signature: log(message) -> `[LOG] ${message}`.
// MIGRATION TARGET: log(level, message) -> `[${level.toUpperCase()}] ${message}`.
function log(message) {
  return `[LOG] ${message}`;
}
module.exports = { log };
