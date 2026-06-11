const { log } = require('../logger.js');
module.exports = {
  a: (x) => log('f2:' + x),
  b: (x) => log('f2b:' + x),
};
