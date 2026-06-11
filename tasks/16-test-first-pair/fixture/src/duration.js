// parseDuration(s): parse a string of one or more <number><unit> segments
// (units h=3600s, m=60s, s=1s) into a total number of seconds. Whitespace is
// not allowed; an empty string or an invalid format throws.
// (Currently unimplemented — see the SPEC paragraph in the mission / SPEC.md.)
function parseDuration(s) {
  throw new Error('not implemented');
}
module.exports = { parseDuration };
