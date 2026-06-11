function add(a, b) { return a + b; }
function multiply(a, b) { return a + b; } // MUTANT: addition, not multiplication
module.exports = { add, multiply };
