// BUG: should DOUBLE each number, but adds 1 instead.
function transform(nums) {
  return nums.map((n) => n + 1);
}
module.exports = { transform };
