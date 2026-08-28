const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const DELIVERY_FEE_ETB = 39;
const COMMISSION_RATE = 0.12; // platform takes 12% of subtotal from restaurant

function createOrderFromItems(customerId, restaurantId, items, sourceVideoId = null) {
  const subtotal = items.reduce((sum, i) => sum + i.price_etb * i.quantity, 0);
  const commission = Math.round(subtotal * COMMISSION_RATE);
  const total = subtotal + DELIVERY_FEE_ETB;
  const customer = db.prepare('SELECT lat, lng FROM users WHERE id = ?').get(customerId);

  const orderInfo = db.prepare(
    `INSERT INTO orders (customer_id, restaurant_id, status, subtotal_etb, delivery_fee_etb, commission_etb, total_etb, source_video_id, delivery_lat, delivery_lng)
     VALUES (?,?, 'placed', ?, ?, ?, ?, ?, ?, ?)`
  ).run(customerId, restaurantId, subtotal, DELIVERY_FEE_ETB, commission, total, sourceVideoId, customer?.lat, customer?.lng);

  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, name_snapshot, price_snapshot, quantity) VALUES (?,?,?,?,?)`
  );
  for (const i of items) {
    insertItem.run(orderInfo.lastInsertRowid, i.product_id, i.name, i.price_etb, i.quantity);
  }
  return orderInfo.lastInsertRowid;
}

// Checkout everything currently in the cart
router.post('/orders/checkout', requireAuth, (req, res) => {
  const cartRows = db.prepare(
    `SELECT ci.quantity, p.id as product_id, p.name, p.price_etb, p.restaurant_id
     FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.user_id = ?`
  ).all(req.user.id);

  if (cartRows.length === 0) return res.status(400).json({ error: 'Cart is empty' });

  const restaurantId = cartRows[0].restaurant_id;
  const orderId = createOrderFromItems(req.user.id, restaurantId, cartRows);
  db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);

  res.status(201).json(getFullOrder(orderId));
});

// "ORDER THIS" — one-tap order of the exact product shown in a video
router.post('/videos/:id/order-this', requireAuth, (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  if (!video.product_id) return res.status(400).json({ error: 'This video has no orderable product' });

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(video.product_id);
  const quantity = (req.body && req.body.quantity) || 1;
  const orderId = createOrderFromItems(
    req.user.id,
    video.restaurant_id,
    [{ product_id: product.id, name: product.name, price_etb: product.price_etb, quantity }],
    video.id
  );
  res.status(201).json(getFullOrder(orderId));
});

function getFullOrder(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  const restaurant = db.prepare('SELECT id, name, avatar_emoji, lat, lng FROM restaurants WHERE id = ?').get(order.restaurant_id);
  const rider = order.rider_id ? db.prepare('SELECT id, name, phone FROM users WHERE id = ?').get(order.rider_id) : null;
  return { ...order, items, restaurant, rider };
}

router.get('/orders/:id', requireAuth, (req, res) => {
  const order = getFullOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const isOwner = order.customer_id === req.user.id;
  const isRider = order.rider_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isRider && !isAdmin) return res.status(403).json({ error: 'Not authorized to view this order' });
  res.json(order);
});

// My orders (as a customer)
router.get('/my/orders', requireAuth, (req, res) => {
  const orders = db.prepare('SELECT id FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(orders.map((o) => getFullOrder(o.id)));
});

router.post('/orders/:id/cancel', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.customer_id !== req.user.id) return res.status(403).json({ error: 'Not your order' });
  if (!['placed', 'accepted'].includes(order.status)) {
    return res.status(400).json({ error: `Cannot cancel an order that is already ${order.status}` });
  }
  db.prepare(`UPDATE orders SET status='cancelled', updated_at=datetime('now') WHERE id = ?`).run(order.id);
  res.json(getFullOrder(order.id));
});

module.exports = router;
