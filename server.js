require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const db = require('./db'); // initializes + seeds sqlite db on first run (async, see db.ready)

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/feed'));
app.use('/api', require('./routes/restaurants'));
app.use('/api', require('./routes/cart'));
app.use('/api', require('./routes/orders'));
app.use('/api', require('./routes/rider'));
app.use('/api/admin', require('./routes/admin'));

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'DropTok API' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
db.ready
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🍔📱 DropTok API running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
