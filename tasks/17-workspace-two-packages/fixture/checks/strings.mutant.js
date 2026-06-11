// MUTANT of packages/core/src/strings.js: slugify keeps spaces instead of
// converting them to '-'. A real test of slugify must catch this.
function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, ""); // MUTANT: drops spaces entirely, never emits '-'
}
function titleCase(s) {
  return String(s)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
module.exports = { slugify, titleCase };
