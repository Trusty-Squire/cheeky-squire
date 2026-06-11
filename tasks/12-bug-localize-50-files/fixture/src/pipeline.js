// Five of the ~50 util modules form an active pipeline; the rest are decoys.
const u07 = require("./util/u07.js"); // + 3
const u13 = require("./util/u13.js"); // * 2
const u21 = require("./util/u21.js"); // - 1
const u34 = require("./util/u34.js"); // square
const u42 = require("./util/u42.js"); // + 10

// run(n) = u42(u34(u21(u13(u07(n)))))  ==  (((n+3)*2 - 1)^2) + 10
module.exports = { run: (n) => u42(u34(u21(u13(u07(n))))) };
