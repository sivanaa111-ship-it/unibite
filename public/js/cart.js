// Cart persisted in localStorage. A cart holds items from ONE restaurant at a time.
const KEY = 'unibite_cart';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const write = (c) => localStorage.setItem(KEY, JSON.stringify(c));

export function getCart() { return read() || { restaurantId: null, restaurantName: '', items: [] }; }
export function cartCount() { return getCart().items.reduce((s, i) => s + i.quantity, 0); }
export function cartTotal() { return getCart().items.reduce((s, i) => s + i.quantity * i.price, 0); }
export function clearCart() { localStorage.removeItem(KEY); }

/** Returns false if the cart belongs to a different restaurant (caller asks to replace). */
export function canAdd(restaurantId) {
  const c = getCart();
  return !c.restaurantId || c.restaurantId === restaurantId || !c.items.length;
}
export function setQty(restaurant, product, qty) {
  let c = getCart();
  if (c.restaurantId !== restaurant.id) c = { restaurantId: restaurant.id, restaurantName: restaurant.name, items: [] };
  const existing = c.items.find((i) => i.product_id === product.id);
  if (qty <= 0) c.items = c.items.filter((i) => i.product_id !== product.id);
  else if (existing) existing.quantity = Math.min(qty, 20);
  else c.items.push({ product_id: product.id, name: product.name, price: product.price, quantity: Math.min(qty, 20) });
  if (!c.items.length) return clearCart();
  write(c);
}
export function qtyOf(productId) { return getCart().items.find((i) => i.product_id === productId)?.quantity || 0; }
