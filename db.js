const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

// On most hosts the app's own directory is fine for SQLite. On platforms with
// an attached persistent disk (e.g. Render), set DB_PATH to the disk's mount
// path (e.g. /var/data/droptok.db) so data survives deploys/restarts.
const dbPath = process.env.DB_PATH || path.join(__dirname, 'droptok.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('customer','restaurant_owner','rider','admin')) DEFAULT 'customer',
  lat REAL DEFAULT 9.03,
  lng REAL DEFAULT 38.74,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS restaurants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  bio TEXT,
  avatar_emoji TEXT DEFAULT '🍽️',
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  rating REAL DEFAULT 4.5,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL,
  price_etb REAL NOT NULL,
  description TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER REFERENCES restaurants(id),
  user_id INTEGER REFERENCES users(id),
  product_id INTEGER REFERENCES products(id),
  caption TEXT,
  thumbnail_emoji TEXT DEFAULT '🎥',
  video_url TEXT,
  is_challenge INTEGER DEFAULT 0,
  challenge_tag TEXT,
  sponsored INTEGER DEFAULT 0,
  discount_pct INTEGER DEFAULT 0,
  likes_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  UNIQUE(video_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  rating INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  rider_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'placed'
    CHECK(status IN ('placed','accepted','preparing','picked_up','delivering','delivered','cancelled')),
  subtotal_etb REAL NOT NULL,
  delivery_fee_etb REAL NOT NULL DEFAULT 39,
  commission_etb REAL NOT NULL DEFAULT 0,
  total_etb REAL NOT NULL,
  source_video_id INTEGER REFERENCES videos(id),
  delivery_lat REAL,
  delivery_lng REAL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  name_snapshot TEXT NOT NULL,
  price_snapshot REAL NOT NULL,
  quantity INTEGER NOT NULL
);
`);

// ---------- Seed data (only if empty) ----------
const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (userCount === 0) {
  const hash = (pw) => bcrypt.hashSync(pw, 10);

  const insertUser = db.prepare(`INSERT INTO users (name, phone, password_hash, role, lat, lng) VALUES (?,?,?,?,?,?)`);
  const admin = insertUser.run('Admin', '0900000000', hash('admin123'), 'admin', 9.03, 38.74);
  const cust1 = insertUser.run('Bethel Girma', '0911111111', hash('pass123'), 'customer', 9.03, 38.74);
  const cust2 = insertUser.run('Nardos Alemu', '0922222222', hash('pass123'), 'customer', 9.02, 38.75);
  const owner1 = insertUser.run('Yonas (Burger Lab)', '0933333333', hash('pass123'), 'restaurant_owner', 9.031, 38.741);
  const owner2 = insertUser.run('Selam (Chicken Spot)', '0944444444', hash('pass123'), 'restaurant_owner', 9.028, 38.745);
  const owner3 = insertUser.run('Mekdes (Pizza House)', '0955555555', hash('pass123'), 'restaurant_owner', 9.035, 38.738);
  const rider1 = insertUser.run('Dawit (Rider)', '0966666666', hash('pass123'), 'rider', 9.03, 38.74);

  const insertRest = db.prepare(`INSERT INTO restaurants (owner_id, name, bio, avatar_emoji, lat, lng, rating) VALUES (?,?,?,?,?,?,?)`);
  const r1 = insertRest.run(owner1.lastInsertRowid, 'Burger Lab', 'Smash burgers made fresh, every order.', '🍔', 9.031, 38.741, 4.8);
  const r2 = insertRest.run(owner2.lastInsertRowid, 'Chicken Spot', 'Best fried chicken in Hawassa 🔥', '🍗', 9.028, 38.745, 4.9);
  const r3 = insertRest.run(owner3.lastInsertRowid, 'Pizza House', 'XL pizzas, fast delivery.', '🍕', 9.035, 38.738, 4.6);
  const r4 = insertRest.run(owner1.lastInsertRowid, 'Juice House', 'Fresh juice & smoothies.', '🥤', 9.033, 38.736, 4.7);

  const insertProd = db.prepare(`INSERT INTO products (restaurant_id, name, price_etb, description) VALUES (?,?,?,?)`);
  const p1 = insertProd.run(r1.lastInsertRowid, 'Double Smash Burger', 350, 'Two smashed patties, cheese, special sauce.');
  const p2 = insertProd.run(r1.lastInsertRowid, 'Classic Cheeseburger', 250, 'Single patty, cheddar, pickles.');
  const p3 = insertProd.run(r2.lastInsertRowid, 'Crispy Chicken Combo', 280, 'Fried chicken, fries, drink.');
  const p4 = insertProd.run(r2.lastInsertRowid, 'Nuclear Wings (6pc)', 320, 'Our hottest wings. Challenge accepted?');
  const p5 = insertProd.run(r3.lastInsertRowid, 'XL Pepperoni Pizza', 480, '16-inch, loaded with pepperoni.');
  const p6 = insertProd.run(r3.lastInsertRowid, 'Spicy Chicken Pizza', 460, 'NEW! Spicy chicken, jalapeños.');
  const p7 = insertProd.run(r4.lastInsertRowid, 'Mango Smoothie', 120, 'Fresh mango, no added sugar.');

  const insertVid = db.prepare(`INSERT INTO videos (restaurant_id, user_id, product_id, caption, thumbnail_emoji, is_challenge, challenge_tag, sponsored, discount_pct, likes_count) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  insertVid.run(r2.lastInsertRowid, owner2.lastInsertRowid, p3.lastInsertRowid, 'This is the best fried chicken in Hawassa 😭🔥', '🍗', 0, null, 0, 0, 412);
  insertVid.run(r1.lastInsertRowid, owner1.lastInsertRowid, p1.lastInsertRowid, 'Watch us make our new burger 👀🍔', '🍔', 0, null, 0, 0, 289);
  insertVid.run(r1.lastInsertRowid, owner1.lastInsertRowid, p1.lastInsertRowid, 'POV: You ordered our XL smash burger…', '🎬', 0, null, 0, 0, 198);
  insertVid.run(r3.lastInsertRowid, owner3.lastInsertRowid, p6.lastInsertRowid, 'NEW spicy chicken pizza 🔥', '🍕', 0, null, 0, 0, 156);
  insertVid.run(r3.lastInsertRowid, owner3.lastInsertRowid, p5.lastInsertRowid, 'Watch us make 100 pizzas in 2 hours 😂', '🎬', 0, null, 0, 0, 731);
  insertVid.run(r2.lastInsertRowid, owner2.lastInsertRowid, p4.lastInsertRowid, 'Can you finish our Nuclear Wings? 🌶️🔥', '🌶️', 1, 'spicy-challenge', 0, 0, 522);
  insertVid.run(r4.lastInsertRowid, owner1.lastInsertRowid, p7.lastInsertRowid, 'Buy 1 get 1 free for the next 30 mins ⏰', '🥤', 0, null, 1, 20, 87);
  insertVid.run(r1.lastInsertRowid, cust1.lastInsertRowid, p2.lastInsertRowid, 'Trying the new cheeseburger from Burger Lab 🍔', '📱', 0, null, 0, 0, 64);

  console.log('Seeded database with demo data.');
  console.log('Demo logins (phone / password):');
  console.log('  Customer:  0911111111 / pass123');
  console.log('  Owner:     0933333333 / pass123 (Burger Lab)');
  console.log('  Rider:     0966666666 / pass123');
  console.log('  Admin:     0900000000 / admin123');
}

module.exports = db;
