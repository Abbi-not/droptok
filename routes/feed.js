const express = require('express');
const db = require('../db');
const { optionalAuth, requireAuth } = require('../middleware/auth');

const router = express.Router();

function distanceKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v === null || v === undefined)) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hydrateVideo(v, userLat, userLng) {
  const restaurant = db.prepare('SELECT id, name, avatar_emoji, lat, lng, rating FROM restaurants WHERE id = ?').get(v.restaurant_id);
  const product = v.product_id
    ? db.prepare('SELECT id, name, price_etb, description FROM products WHERE id = ?').get(v.product_id)
    : null;
  const posterUser = v.user_id ? db.prepare('SELECT id, name FROM users WHERE id = ?').get(v.user_id) : null;
  const dist = restaurant ? distanceKm(userLat, userLng, restaurant.lat, restaurant.lng) : null;
  return {
    id: v.id,
    caption: v.caption,
    thumbnail_emoji: v.thumbnail_emoji,
    is_challenge: !!v.is_challenge,
    challenge_tag: v.challenge_tag,
    sponsored: !!v.sponsored,
    discount_pct: v.discount_pct,
    likes_count: v.likes_count,
    created_at: v.created_at,
    restaurant,
    product,
    posted_by_customer: posterUser && restaurant && posterUser.id !== restaurant.owner_id ? posterUser : null,
    distance_km: dist !== null ? Math.round(dist * 10) / 10 : null,
  };
}

// GET /api/feed?lat=&lng= — main vertical feed (sponsored boosted, then by recency)
router.get('/feed', optionalAuth, (req, res) => {
  const lat = req.query.lat ? parseFloat(req.query.lat) : req.user ? db.prepare('SELECT lat FROM users WHERE id=?').get(req.user.id)?.lat : null;
  const lng = req.query.lng ? parseFloat(req.query.lng) : req.user ? db.prepare('SELECT lng FROM users WHERE id=?').get(req.user.id)?.lng : null;

  const videos = db.prepare('SELECT * FROM videos ORDER BY sponsored DESC, created_at DESC').all();
  res.json(videos.map((v) => hydrateVideo(v, lat, lng)));
});

// GET /api/nearby?lat=&lng= — "Nearby Now": what's popping close by, sorted by distance
router.get('/nearby', optionalAuth, (req, res) => {
  const lat = req.query.lat ? parseFloat(req.query.lat) : 9.03;
  const lng = req.query.lng ? parseFloat(req.query.lng) : 38.74;

  const videos = db.prepare('SELECT * FROM videos ORDER BY created_at DESC').all();
  const hydrated = videos
    .map((v) => hydrateVideo(v, lat, lng))
    .filter((v) => v.distance_km !== null)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 20);
  res.json(hydrated);
});

router.post('/videos/:id/like', requireAuth, (req, res) => {
  const videoId = req.params.id;
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const existing = db.prepare('SELECT id FROM likes WHERE video_id=? AND user_id=?').get(videoId, req.user.id);
  if (existing) {
    db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id);
    db.prepare('UPDATE videos SET likes_count = likes_count - 1 WHERE id = ?').run(videoId);
    return res.json({ liked: false });
  }
  db.prepare('INSERT INTO likes (video_id, user_id) VALUES (?,?)').run(videoId, req.user.id);
  db.prepare('UPDATE videos SET likes_count = likes_count + 1 WHERE id = ?').run(videoId);
  res.json({ liked: true });
});

router.get('/videos/:id/comments', (req, res) => {
  const comments = db.prepare(
    `SELECT c.id, c.text, c.rating, c.created_at, u.name as user_name
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.video_id = ? ORDER BY c.created_at DESC`
  ).all(req.params.id);
  res.json(comments);
});

router.post('/videos/:id/comments', requireAuth, (req, res) => {
  const { text, rating } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  const video = db.prepare('SELECT id FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const info = db.prepare(
    'INSERT INTO comments (video_id, user_id, text, rating) VALUES (?,?,?,?)'
  ).run(req.params.id, req.user.id, text, rating ?? null);
  res.status(201).json({ id: info.lastInsertRowid });
});

module.exports = router;
