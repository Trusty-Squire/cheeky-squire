// Parse CLI args. Supports --name <value>.
function parseArgs(argv) {
  const out = { name: "world" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--name") out.name = argv[++i];
  }
  return out;
}
module.exports = { parseArgs };
