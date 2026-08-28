const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
// Scoped to this router's own mount path only (/api/admin) so it never
// shadows unrelated /api/* routes registered in other route files.
router.use(requireAuth, requireRole('admin'));

router.get('/users', (req, res) => {
  res.json(db.prepare('SELECT id, name, phone, role, lat, lng, created_at FROM users ORDER BY created_at DESC').all());
});

router.get('/restaurants', (req, res) => {
  res.json(db.prepare('SELECT * FROM restaurants ORDER BY created_at DESC').all());
});

router.get('/riders', (req, res) => {
  res.json(db.prepare(`SELECT id, name, phone, created_at FROM users WHERE role = 'rider' ORDER BY created_at DESC`).all());
});

router.get('/orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  res.json(orders.map((o) => ({ ...o, items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id) })));
});

// Simple platform reports: revenue breakdown
router.get('/reports', (req, res) => {
  const totals = db.prepare(
    `SELECT
      COUNT(*) as total_orders,
      COALESCE(SUM(subtotal_etb),0) as gmv_etb,
      COALESCE(SUM(commission_etb),0) as commission_revenue_etb,
      COALESCE(SUM(delivery_fee_etb),0) as delivery_revenue_etb,
      COALESCE(SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END),0) as delivered_orders,
      COALESCE(SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END),0) as cancelled_orders
     FROM orders`
  ).get();
  const topRestaurants = db.prepare(
    `SELECT r.name, COUNT(o.id) as order_count, COALESCE(SUM(o.subtotal_etb),0) as revenue_etb
     FROM restaurants r LEFT JOIN orders o ON o.restaurant_id = r.id
     GROUP BY r.id ORDER BY revenue_etb DESC`
  ).all();
  res.json({
    ...totals,
    platform_revenue_etb: totals.commission_revenue_etb + Math.round(totals.delivery_revenue_etb * 0.2),
    top_restaurants: topRestaurants,
  });
});

module.exports = router;
