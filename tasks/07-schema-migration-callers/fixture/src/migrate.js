// Normalize an arbitrary input record into a full user record.
function migrate(rec) {
  return { name: rec.name || "", age: rec.age || 0 };
}
module.exports = { migrate };
