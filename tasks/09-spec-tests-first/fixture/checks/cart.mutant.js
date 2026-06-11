function total(items) {
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  return subtotal >= 100 ? subtotal * 0.9 : subtotal; // MUTANT: >= instead of >, breaks the exactly-100 boundary
}
module.exports = { total };
