require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const authRoutes  = require('./auth');
const apiRoutes   = require('./api');
const adminRoutes = require('./admin-routes');

const app = express();

// ── CORS (raw header first, then the cors() middleware) ───────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(cors({
  origin: [
    'https://www.anvoxa.com',
    'https://anvoxa.com',
    'https://anvoxa-backend-production.up.railway.app',
    process.env.FRONTEND_URL || 'http://localhost:4000',
  ],
  credentials: true,
}));

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());
app.set('trust proxy', 1);
app.get('/sitemap.xml', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'sitemap.xml')));

// ── API routes ────────────────────────────────────────────────
app.use('/auth/admin', adminRoutes.auth);
app.use('/admin',      adminRoutes.protected);
app.use('/auth',       authRoutes);
app.use('/',           apiRoutes);

// ── Page routes ───────────────────────────────────────────────
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'home.html')));

app.get('/home', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'home.html')));

app.get('/login', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'home.html')));

app.get('/admin-login', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'home.html')));

app.get('/dashboard', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

app.get('/run', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'run.html')));

app.get('/write', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'write.html')));

app.get('/deploy', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'deploy.html')));

app.get('/__/auth/handler', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'home.html')));

app.get('/__/auth/iframe', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'home.html')));

// Health check
app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'anvoxa-backend' }));
// Sitemap

// Static assets
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Global error handler
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 catch-all (must be last)
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`\n  Anvoxa running on http://localhost:${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}\n`);
  console.log(`  /          → home (public landing)`);
  console.log(`  /home      → home (same page, kept for back-compat)`);
  console.log(`  /dashboard → app (auth-gated)\n`);
});
