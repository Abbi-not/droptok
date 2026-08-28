const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { SECRET } = require('../middleware/auth');

const router = express.Router();

router.post('/signup', (req, res) => {
  const { name, phone, password, role = 'customer', lat, lng } = req.body;
  if (!name || !phone || !password) {
    return res.status(400).json({ error: 'name, phone, and password are required' });
  }
  if (!['customer', 'restaurant_owner', 'rider'].includes(role)) {
    return res.status(400).json({ error: 'role must be customer, restaurant_owner, or rider' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (existing) return res.status(409).json({ error: 'Phone number already registered' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    `INSERT INTO users (name, phone, password_hash, role, lat, lng) VALUES (?,?,?,?,?,?)`
  ).run(name, phone, hash, role, lat ?? 9.03, lng ?? 38.74);

  const user = db.prepare('SELECT id, name, phone, role, lat, lng FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET, { expiresIn: '30d' });
  res.status(201).json({ token, user });
});

router.post('/login', (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'phone and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid phone or password' });
  }
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET, { expiresIn: '30d' });
  delete user.password_hash;
  res.json({ token, user });
});

module.exports = router;
