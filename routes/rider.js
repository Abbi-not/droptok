const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function getFullOrder(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  const restaurant = db.prepare('SELECT id, name, avatar_emoji, lat, lng FROM restaurants WHERE id = ?').get(order.restaurant_id);
  const customer = db.prepare('SELECT id, name, phone FROM users WHERE id = ?').get(order.customer_id);
  return { ...order, items, restaurant, customer };
}

// Orders ready to be picked up (accepted by restaurant, not yet claimed by a rider)
router.get('/rider/available-orders', requireAuth, requireRole('rider'), (req, res) => {
  const orders = db.prepare(
    `SELECT id FROM orders WHERE status IN ('accepted','preparing') AND rider_id IS NULL ORDER BY created_at ASC`
  ).all();
  res.json(orders.map((o) => getFullOrder(o.id)));
});

router.post('/rider/orders/:id/accept', requireAuth, requireRole('rider'), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.rider_id) return res.status(409).json({ error: 'Order already claimed by another rider' });
  if (!['accepted', 'preparing'].includes(order.status)) {
    return res.status(400).json({ error: 'Order is not ready for pickup yet' });
  }
  db.prepare(`UPDATE orders SET rider_id = ?, updated_at = datetime('now') WHERE id = ?`).run(req.user.id, order.id);
  res.json(getFullOrder(order.id));
});

router.patch('/rider/orders/:id/status', requireAuth, requireRole('rider'), (req, res) => {
  const { status } = req.body;
  const allowed = ['picked_up', 'delivering', 'delivered'];
  if (!allowed.includes(status)) return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.rider_id !== req.user.id) return res.status(403).json({ error: 'This order is not assigned to you' });

  db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, order.id);
  res.json(getFullOrder(order.id));
});

// My deliveries + simple earnings summary (flat delivery fee per completed order, demo economics)
router.get('/rider/earnings', requireAuth, requireRole('rider'), (req, res) => {
  const delivered = db.prepare(`SELECT * FROM orders WHERE rider_id = ? AND status = 'delivered'`).all(req.user.id);
  const inProgress = db.prepare(`SELECT * FROM orders WHERE rider_id = ? AND status IN ('picked_up','delivering')`).all(req.user.id);
  const totalEarned = delivered.reduce((sum, o) => sum + o.delivery_fee_etb * 0.8, 0); // rider keeps 80% of delivery fee
  res.json({
    completed_deliveries: delivered.length,
    total_earned_etb: Math.round(totalEarned),
    in_progress: inProgress.map((o) => getFullOrder(o.id)),
  });
});

module.exports = router;
