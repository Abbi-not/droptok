const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// On most hosts the app's own directory is fine for SQLite. On platforms with
// an attached persistent disk, set DB_PATH to the disk's mount path
// (e.g. /var/data/droptok.db) so data survives deploys/restarts.
const dbPath = process.env.DB_PATH || path.join(__dirname, 'droptok.db');

// `db` is exported immediately so `require('../db')` works synchronously in
// every route file. Its real methods (exec/prepare) get attached once the
// WASM engine finishes loading — see `db.ready` below, which server.js awaits
// before accepting any HTTP traffic. Route handlers only ever call
// db.prepare(...) while handling a request, i.e. always after `ready` has
// resolved, so this indirection is invisible to the rest of the app.
const db = {};

function wrapStatement(sqlDb, save, sql) {
  return {
    run(...params) {
      const stmt = sqlDb.prepare(sql);
      try {
        stmt.bind(params);
        stmt.step();
      } finally {
        stmt.free();
      }
      const changes = sqlDb.getRowsModified();
      const idRow = sqlDb.exec('SELECT last_insert_rowid() AS id');
      const lastInsertRowid = idRow.length ? idRow[0].values[0][0] : undefined;
      save();
      return { changes, lastInsertRowid };
    },
    get(...params) {
      const stmt = sqlDb.prepare(sql);
      let row;
      try {
        stmt.bind(params);
        if (stmt.step()) row = stmt.getAsObject();
      } finally {
        stmt.free();
      }
      return row;
    },
    all(...params) {
      const stmt = sqlDb.prepare(sql);
      const rows = [];
      try {
        stmt.bind(params);
        while (stmt.step()) rows.push(stmt.getAsObject());
      } finally {
        stmt.free();
      }
      return rows;
    },
  };
}

async function init() {
  const SQL = await initSqlJs();
  const sqlDb = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  const save = () => fs.writeFileSync(dbPath, Buffer.from(sqlDb.export()));

  db.exec = (sql) => { sqlDb.exec(sql); save(); };
  db.prepare = (sql) => wrapStatement(sqlDb, save, sql);

  db.exec('PRAGMA foreign_keys = ON');

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

    console.log('Seeded database with demo data (no mock videos — feed starts empty).');
    console.log('Demo logins (phone / password):');
    console.log('  Customer:  0911111111 / pass123');
    console.log('  Owner:     0933333333 / pass123 (Burger Lab)');
    console.log('  Rider:     0966666666 / pass123');
    console.log('  Admin:     0900000000 / admin123');
  }

  return db;
}

db.ready = init();

module.exports = db;
