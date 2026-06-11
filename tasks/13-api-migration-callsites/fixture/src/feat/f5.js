const { log } = require('../logger.js');
module.exports = {
  a: (x) => log('f5:' + x),
  b: (x) => log('f5b:' + x),
};
