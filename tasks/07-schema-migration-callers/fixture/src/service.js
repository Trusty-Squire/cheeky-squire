const { migrate } = require("./migrate.js");

// Render a user as a display string.
function createUser(input) {
  const u = migrate(input);
  return `${u.name}`;
}
module.exports = { createUser };
