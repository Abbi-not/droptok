# DropTok 🍔📱

**"TikTok, but everything you see can be ordered."**

A shoppable short-video food delivery platform: restaurants post videos of their food, customers swipe through a vertical feed and order directly from what they're watching, and riders pick up and deliver. Discovery → impulse → purchase → delivery, in one loop.

This is a full working MVP: a **Node.js/Express + SQLite backend** with JWT auth and every endpoint described in the concept (feed, shoppable videos, cart, checkout, restaurant dashboard, rider app, admin panel, "Nearby Now", challenges, "Order This"), plus a **browser demo frontend** (`public/index.html`) that exercises the whole API — vertical swipeable feed, cart, order tracking, and role-based dashboards for restaurant owners, riders, and admins.

---

## Quick start

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser. The SQLite database (`droptok.db`) is created and seeded automatically on first run with 4 demo restaurants, 7 products, and 8 videos.

### Demo logins

| Role | Phone | Password |
|---|---|---|
| Customer | `0911111111` | `pass123` |
| Restaurant owner (Burger Lab) | `0933333333` | `pass123` |
| Rider | `0966666666` | `pass123` |
| Admin | `0900000000` | `admin123` |

Or just tap "Create an account" in the app to sign up as any role.

### Try the full loop
1. Log in as the **customer** → swipe the feed → tap "Add to cart" on a product card → go to **Cart** → **Checkout**.
2. Log in as the **restaurant owner** → **My Shop** → accept the order, then mark it "preparing".
3. Log in as the **rider** → **Deliveries** → accept the order → mark picked up → delivered.
4. Log in as **admin** → see platform-wide commission and delivery revenue.

You can also hit the ⚡ button on any video for **"Order This"** — a one-tap checkout of the exact item shown, skipping the cart, and check out **Nearby** for the "what's popping near you right now" feed.

---

## Project structure

```
droptok/
├── server.js              # Express app entry point
├── db.js                  # SQLite schema + auto-seed demo data
├── middleware/auth.js     # JWT auth (requireAuth, requireRole, optionalAuth)
├── routes/
│   ├── auth.js             # signup / login
│   ├── feed.js             # main feed, nearby-now, likes, comments
│   ├── restaurants.js      # restaurant CRUD, menu, video posting, order management
│   ├── cart.js              # cart add/update/remove
│   ├── orders.js            # checkout, "order this", order tracking, cancel
│   ├── rider.js              # available orders, accept, status updates, earnings
│   └── admin.js               # users/restaurants/riders/orders + revenue reports
└── public/index.html       # demo frontend (vanilla JS, single file)
```

## Data model

- **users** — customer / restaurant_owner / rider / admin, each with a phone+password login and a location.
- **restaurants** — owned by a user, has a location and rating.
- **products** — a restaurant's menu items.
- **videos** — the shoppable content. Each optionally links to a product, can be flagged `sponsored` (paid boost + discount) or `is_challenge` (e.g. "Nuclear Wings challenge").
- **likes / comments** — comments optionally carry a star `rating`, matching the "rate what you ordered" idea.
- **cart_items** — per-user cart (single-restaurant at a time, like most delivery apps).
- **orders / order_items** — snapshot pricing at time of order; tracks `source_video_id` so you always know which video drove a sale.

## Revenue model (implemented in `/api/admin/reports`)

- **Commission**: platform takes 12% of each order's subtotal from the restaurant.
- **Delivery fee**: flat 39 ETB per order; the rider keeps 80%, platform keeps the rest.
- **Sponsored videos**: `sponsored=1` videos are boosted to the top of the feed and can carry a `discount_pct`.

These are simple defaults — real fee logic, payouts, and reconciliation would be a bigger project, but the schema supports plugging in exact numbers.

## API reference (all under `/api`)

**Auth**
- `POST /auth/signup` `{name, phone, password, role, lat, lng}`
- `POST /auth/login` `{phone, password}`

**Feed & social**
- `GET /feed?lat=&lng=` — main vertical feed (sponsored boosted first, then recent)
- `GET /nearby?lat=&lng=` — "Nearby Now", sorted by distance
- `POST /videos/:id/like`
- `GET /videos/:id/comments`, `POST /videos/:id/comments` `{text, rating}`
- `POST /videos/:id/order-this` `{quantity}` — one-tap order of that video's product

**Restaurants** (owner-authenticated for writes)
- `GET /restaurants`, `GET /restaurants/:id`
- `POST /restaurants` `{name, bio, avatar_emoji, lat, lng}`
- `GET /my/restaurants`
- `POST /restaurants/:id/products` `{name, price_etb, description}`
- `POST /restaurants/:id/videos` `{caption, thumbnail_emoji, product_id, is_challenge, challenge_tag, sponsored, discount_pct}`
- `GET /restaurants/:id/orders`
- `PATCH /restaurants/:restId/orders/:orderId/status` `{status: accepted|preparing|cancelled}`

**Cart**
- `GET /cart`, `POST /cart/add` `{product_id, quantity}`, `PATCH /cart/:itemId` `{quantity}`, `DELETE /cart/:itemId`, `DELETE /cart`

**Orders**
- `POST /orders/checkout`
- `GET /orders/:id`, `GET /my/orders`
- `POST /orders/:id/cancel`

**Rider**
- `GET /rider/available-orders`
- `POST /rider/orders/:id/accept`
- `PATCH /rider/orders/:id/status` `{status: picked_up|delivering|delivered}`
- `GET /rider/earnings`

**Admin**
- `GET /admin/users`, `/admin/restaurants`, `/admin/riders`, `/admin/orders`, `/admin/reports`

All authenticated routes expect `Authorization: Bearer <token>`.

---

## What's deliberately left as an MVP

To keep this runnable in one shot, some things are simplified rather than production-grade:
- **Video files** — videos are stored as metadata (caption, emoji, optional `video_url`) rather than actual uploaded/streamed video, so there's no video hosting/transcoding pipeline. Wire `video_url` up to a real object store (S3, Cloudflare R2/Stream) to go further.
- **Payments** — checkout creates an order in `placed` status; no real payment gateway (e.g. Telebirr, Chapa) is integrated yet.
- **Personalized recommendation algorithm** — feed is currently sponsored-first + recency; the "learns your taste" ranking described in the concept would need an event-tracking + ranking service layered on top.
- **Real-time rider tracking / push notifications** — status changes are pull-based (refresh), not pushed via websockets.
- **Single SQLite file** — great for an MVP or small deployment; swap `better-sqlite3` for Postgres when you need concurrent writers at scale.

The schema and route structure are built so each of these can be added without a rewrite.

---

## Deploying it live

The app is deploy-ready for any Node host. Two paths are included:

### Option A — Render (recommended, free tier, no credit card)

1. Push this folder to a new GitHub repo (create one at github.com → "New repository" → follow the "push an existing folder" instructions it gives you).
2. Go to [render.com](https://render.com) → sign up (free) → **New → Blueprint** → connect the GitHub repo you just created.
3. Render will detect `render.yaml` in this project automatically. It sets up:
   - A free web service running `npm install` / `npm start`
   - A persistent 1GB disk mounted at `/var/data` so your SQLite database survives restarts and redeploys
   - A random `JWT_SECRET` generated for you
4. Click **Apply** — in a minute or two you'll get a live URL like `https://droptok.onrender.com`.

Note: Render's free tier spins down after 15 minutes of inactivity and takes ~30-50 seconds to wake back up on the next request — fine for a demo, not for production traffic.

### Option B — Any container host (Railway, Fly.io, a VPS, etc.)

A `Dockerfile` is included. Generic flow:
```bash
docker build -t droptok .
docker run -p 3000:3000 -e JWT_SECRET=$(openssl rand -hex 32) -v droptok_data:/app/data -e DB_PATH=/app/data/droptok.db droptok
```
Push the built image to your host of choice, or connect the repo directly if the platform builds from a Dockerfile (Railway and Fly.io both do).

### Before going further than a demo

- Set a strong, random `JWT_SECRET` (never leave the code's default dev secret in production).
- Swap SQLite for Postgres if you expect concurrent writers at real scale (the query patterns in `db.js` are simple enough to port).
- Put the app behind HTTPS (Render and Railway both do this for you automatically).

