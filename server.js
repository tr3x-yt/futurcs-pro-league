const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const connectPgSimple = require('connect-pg-simple');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const PgSession = connectPgSimple(session);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('trust proxy', 1);

app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'futurcs-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 },
}));

app.use(passport.initialize());
app.use(passport.session());

const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

passport.use(new SteamStrategy({
  returnURL: `${BASE_URL}/auth/steam/return`,
  realm: BASE_URL,
  apiKey: process.env.STEAM_API_KEY,
}, async (identifier, profile, done) => {
  try {
    const steamId = profile.id;
    const displayName = profile.displayName;
    const avatar = profile.photos?.[2]?.value || profile.photos?.[0]?.value || '';
    const result = await pool.query(`
      INSERT INTO players (steam_id, nickname, avatar_url, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (steam_id) DO UPDATE
        SET nickname = EXCLUDED.nickname, avatar_url = EXCLUDED.avatar_url, last_seen = NOW()
      RETURNING *
    `, [steamId, displayName, avatar]);
    return done(null, result.rows[0]);
  } catch (err) { return done(err); }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query('SELECT * FROM players WHERE id = $1', [id]);
    done(null, result.rows[0] || false);
  } catch (err) { done(err); }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY, steam_id VARCHAR(64) UNIQUE, email VARCHAR(255) UNIQUE,
      password VARCHAR(255), nickname VARCHAR(64) NOT NULL, avatar_url TEXT DEFAULT '',
      rating INTEGER DEFAULT 1000, tier VARCHAR(32) DEFAULT 'specialist',
      wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0,
      kills INTEGER DEFAULT 0, deaths INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(), last_seen TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY, map VARCHAR(64) DEFAULT 'Mirage', status VARCHAR(32) DEFAULT 'pending',
      team_a INTEGER[] DEFAULT '{}', team_b INTEGER[] DEFAULT '{}',
      score_a INTEGER DEFAULT 0, score_b INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(), finished_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS waitlist (
      id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('✅ DB ready');
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try { req.user = jwt.verify(token, process.env.JWT_SECRET || 'futurcs-jwt'); return next(); }
    catch (_) {}
  }
  res.status(401).json({ error: 'Не авторизован' });
}

app.get('/auth/steam', passport.authenticate('steam'));
app.get('/auth/steam/return',
  passport.authenticate('steam', { failureRedirect: '/?auth=fail' }),
  (req, res) => res.redirect('/?auth=success')
);
app.get('/auth/logout', (req, res) => req.logout(() => res.redirect('/')));

app.post('/api/register', async (req, res) => {
  const { nickname, email, password } = req.body;
  if (!nickname || nickname.length < 3) return res.status(400).json({ error: 'Никнейм минимум 3 символа' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Некорректный email' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Пароль минимум 8 символов' });
  try {
    const hashed = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO players (nickname, email, password, created_at) VALUES ($1,$2,$3,NOW()) RETURNING id,nickname,email,rating,tier`,
      [nickname, email, hashed]
    );
    const user = result.rows[0];
    const token = jwt.sign(user, process.env.JWT_SECRET || 'futurcs-jwt', { expiresIn: '30d' });
    res.json({ success: true, user, token });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email или никнейм уже заняты' });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM players WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !user.password) return res.status(401).json({ error: 'Неверный email или пароль' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Неверный email или пароль' });
    await pool.query('UPDATE players SET last_seen = NOW() WHERE id = $1', [user.id]);
    const token = jwt.sign(
      { id: user.id, nickname: user.nickname, email: user.email, rating: user.rating, tier: user.tier },
      process.env.JWT_SECRET || 'futurcs-jwt', { expiresIn: '30d' }
    );
    res.json({ success: true, user: { id: user.id, nickname: user.nickname, rating: user.rating, tier: user.tier }, token });
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/me', async (req, res) => {
  try {
    let userId = null;
    if (req.isAuthenticated()) {
      userId = req.user.id;
    } else {
      const token = req.headers.authorization?.split(' ')[1];
      if (token) {
        try { userId = jwt.verify(token, process.env.JWT_SECRET || 'futurcs-jwt').id; } catch(_) {}
      }
    }
    if (!userId) return res.status(401).json({ error: 'Не авторизован' });
    const result = await pool.query(
      'SELECT id, nickname, avatar_url, rating, tier, wins, losses, kills, deaths, created_at FROM players WHERE id = $1',
      [userId]
    );
    res.json(result.rows[0] || {});
  } catch (err) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, nickname, avatar_url, rating, tier, wins, losses,
        CASE WHEN (wins+losses)>0 THEN ROUND(wins::numeric/(wins+losses)*100,1) ELSE 0 END as winrate,
        CASE WHEN deaths>0 THEN ROUND(kills::numeric/deaths,2) ELSE kills END as kd
      FROM players ORDER BY rating DESC LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/stats', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT COUNT(*) as total_players,
        COUNT(CASE WHEN last_seen > NOW() - INTERVAL '24 hours' THEN 1 END) as online_today,
        COALESCE(SUM(wins+losses),0) as total_matches
      FROM players
    `);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/waitlist', async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Некорректный email' });
  try {
    await pool.query('INSERT INTO waitlist (email) VALUES ($1) ON CONFLICT DO NOTHING', [email]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Ошибка' }); }
});

app.use(express.static(path.join(__dirname, '.')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 FUTURCS on port ${PORT}`));
}).catch(err => { console.error('❌', err); process.exit(1); });
