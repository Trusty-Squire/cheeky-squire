// Gate for the `config` node. Exits 0 only if src/config.json parses and
// has factor === 2. Lives outside the node blast_radius.
const fs = require("node:fs");
const path = require("node:path");
try {
  const raw = fs.readFileSync(path.join(__dirname, "..", "src", "config.json"), "utf8");
  const cfg = JSON.parse(raw);
  process.exit(cfg && cfg.factor === 2 ? 0 : 1);
} catch {
  process.exit(1);
}
