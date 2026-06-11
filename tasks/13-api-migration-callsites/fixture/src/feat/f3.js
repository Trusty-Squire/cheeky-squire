const { log } = require('../logger.js');
module.exports = {
  a: (x) => log('f3:' + x),
  b: (x) => log('f3b:' + x),
};
