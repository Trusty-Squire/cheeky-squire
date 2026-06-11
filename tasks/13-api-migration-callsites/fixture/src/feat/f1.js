const { log } = require('../logger.js');
module.exports = {
  a: (x) => log('f1:' + x),
  b: (x) => log('f1b:' + x),
};
