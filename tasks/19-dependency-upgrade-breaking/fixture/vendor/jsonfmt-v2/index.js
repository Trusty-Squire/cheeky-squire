// Vendored dependency "jsonfmt" — v2 API (UPGRADE TARGET).
// BREAKING CHANGE: format now requires a second `opts` argument with a
// boolean `pretty`. Calling format(obj) the old (single-arg) way throws.
module.exports = {
  version: '2.0.0',
  format: (obj, opts) => {
    if (!opts || typeof opts.pretty !== 'boolean') {
      throw new Error('opts.pretty required');
    }
    return JSON.stringify(obj, null, opts.pretty ? 2 : 0);
  },
};
