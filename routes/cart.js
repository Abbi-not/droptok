const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function hydrateCart(userId) {
  const rows = db.prepare(
    `SELECT ci.id as cart_item_id, ci.quantity, p.id as product_id, p.name, p.price_etb, p.restaurant_id
     FROM cart_items ci JOIN products p ON p.id = ci.product_id
     WHERE ci.user_id = ?`
  ).all(userId);
  const subtotal = rows.reduce((sum, r) => sum + r.price_etb * r.quantity, 0);
  return { items: rows, subtotal_etb: subtotal };
}

router.get('/cart', requireAuth, (req, res) => {
  res.json(hydrateCart(req.user.id));
});

router.post('/cart/add', requireAuth, (req, res) => {
  const { product_id, quantity = 1 } = req.body;
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  // Enforce single-restaurant cart (common for food delivery apps)
  const existingItems = db.prepare(
    `SELECT p.restaurant_id FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.user_id = ? LIMIT 1`
  ).get(req.user.id);
  if (existingItems && existingItems.restaurant_id !== product.restaurant_id) {
    return res.status(409).json({ error: 'Your cart has items from another restaurant. Clear cart first.', code: 'DIFFERENT_RESTAURANT' });
  }

  const existing = db.prepare('SELECT * FROM cart_items WHERE user_id = ? AND product_id = ?').get(req.user.id, product_id);
  if (existing) {
    db.prepare('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?').run(quantity, existing.id);
  } else {
    db.prepare('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?,?,?)').run(req.user.id, product_id, quantity);
  }
  res.status(201).json(hydrateCart(req.user.id));
});

router.patch('/cart/:itemId', requireAuth, (req, res) => {
  const { quantity } = req.body;
  const item = db.prepare('SELECT * FROM cart_items WHERE id = ? AND user_id = ?').get(req.params.itemId, req.user.id);
  if (!item) return res.status(404).json({ error: 'Cart item not found' });
  if (quantity <= 0) {
    db.prepare('DELETE FROM cart_items WHERE id = ?').run(item.id);
  } else {
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(quantity, item.id);
  }
  res.json(hydrateCart(req.user.id));
});

router.delete('/cart/:itemId', requireAuth, (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE id = ? AND user_id = ?').run(req.params.itemId, req.user.id);
  res.json(hydrateCart(req.user.id));
});

router.delete('/cart', requireAuth, (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
  res.json({ items: [], subtotal_etb: 0 });
});

module.exports = router;
