const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function ownsRestaurant(restaurantId, userId) {
  const r = db.prepare('SELECT owner_id FROM restaurants WHERE id = ?').get(restaurantId);
  return r && r.owner_id === userId;
}

// Public: list / view restaurants
router.get('/restaurants', (req, res) => {
  res.json(db.prepare('SELECT * FROM restaurants').all());
});

router.get('/restaurants/:id', (req, res) => {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
  const products = db.prepare('SELECT * FROM products WHERE restaurant_id = ? AND active = 1').all(req.params.id);
  const videos = db.prepare('SELECT * FROM videos WHERE restaurant_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ ...restaurant, products, videos });
});

// Create restaurant (owner)
router.post('/restaurants', requireAuth, requireRole('restaurant_owner', 'admin'), (req, res) => {
  const { name, bio, avatar_emoji, lat, lng } = req.body;
  if (!name || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'name, lat, lng are required' });
  }
  const info = db.prepare(
    `INSERT INTO restaurants (owner_id, name, bio, avatar_emoji, lat, lng) VALUES (?,?,?,?,?,?)`
  ).run(req.user.id, name, bio || '', avatar_emoji || '🍽️', lat, lng);
  res.status(201).json(db.prepare('SELECT * FROM restaurants WHERE id = ?').get(info.lastInsertRowid));
});

// Owner's own restaurants
router.get('/my/restaurants', requireAuth, requireRole('restaurant_owner', 'admin'), (req, res) => {
  res.json(db.prepare('SELECT * FROM restaurants WHERE owner_id = ?').all(req.user.id));
});

// Add product / menu item
router.post('/restaurants/:id/products', requireAuth, requireRole('restaurant_owner', 'admin'), (req, res) => {
  if (!ownsRestaurant(req.params.id, req.user.id) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'You do not own this restaurant' });
  }
  const { name, price_etb, description } = req.body;
  if (!name || price_etb === undefined) return res.status(400).json({ error: 'name and price_etb are required' });
  const info = db.prepare(
    `INSERT INTO products (restaurant_id, name, price_etb, description) VALUES (?,?,?,?)`
  ).run(req.params.id, name, price_etb, description || '');
  res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
});

// Upload a video (metadata) and attach a product — the shoppable-video core feature
router.post('/restaurants/:id/videos', requireAuth, requireRole('restaurant_owner', 'admin'), (req, res) => {
  if (!ownsRestaurant(req.params.id, req.user.id) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'You do not own this restaurant' });
  }
  const { caption, thumbnail_emoji, product_id, is_challenge, challenge_tag, sponsored, discount_pct, video_url } = req.body;
  if (product_id) {
    const p = db.prepare('SELECT id FROM products WHERE id = ? AND restaurant_id = ?').get(product_id, req.params.id);
    if (!p) return res.status(400).json({ error: 'product_id does not belong to this restaurant' });
  }
  const info = db.prepare(
    `INSERT INTO videos (restaurant_id, user_id, product_id, caption, thumbnail_emoji, video_url, is_challenge, challenge_tag, sponsored, discount_pct)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    req.params.id, req.user.id, product_id || null, caption || '', thumbnail_emoji || '🎥', video_url || null,
    is_challenge ? 1 : 0, challenge_tag || null, sponsored ? 1 : 0, discount_pct || 0
  );
  res.status(201).json(db.prepare('SELECT * FROM videos WHERE id = ?').get(info.lastInsertRowid));
});

// Restaurant's incoming orders
router.get('/restaurants/:id/orders', requireAuth, requireRole('restaurant_owner', 'admin'), (req, res) => {
  if (!ownsRestaurant(req.params.id, req.user.id) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'You do not own this restaurant' });
  }
  const orders = db.prepare('SELECT * FROM orders WHERE restaurant_id = ? ORDER BY created_at DESC').all(req.params.id);
  const withItems = orders.map((o) => ({
    ...o,
    items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id),
  }));
  res.json(withItems);
});

// Restaurant updates order status (accepted -> preparing -> picked_up handoff)
router.patch('/restaurants/:restId/orders/:orderId/status', requireAuth, requireRole('restaurant_owner', 'admin'), (req, res) => {
  if (!ownsRestaurant(req.params.restId, req.user.id) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'You do not own this restaurant' });
  }
  const { status } = req.body;
  const allowed = ['accepted', 'preparing', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND restaurant_id = ?').get(req.params.orderId, req.params.restId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, order.id);
  res.json(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id));
});

module.exports = router;
