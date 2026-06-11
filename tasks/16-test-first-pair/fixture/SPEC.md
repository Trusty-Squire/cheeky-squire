# SPEC — parseDuration

`parseDuration(s)` takes a string of one or more `<number><unit>` segments and
returns the total number of seconds as an integer.

Units:

- `h` — hours, 3600 seconds each
- `m` — minutes, 60 seconds each
- `s` — seconds, 1 second each

Each segment is a run of one or more digits immediately followed by exactly one
unit letter. Segments are concatenated with no separators. Whitespace is NOT
allowed anywhere in the string.

Examples:

- `'1h30m'` → 5400
- `'90m'` → 5400
- `'2h'` → 7200
- `'45s'` → 45
- `'1h1m1s'` → 3661

An empty string, or any string that is not a valid sequence of `<number><unit>`
segments (e.g. a bad unit, a number with no unit, whitespace, or other junk),
MUST throw.
