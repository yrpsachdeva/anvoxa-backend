require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const authRoutes  = require('./auth');
const apiRoutes   = require('./api');
const adminRoutes = require('./admin-routes');

const app = express();

// ── CORS — explicit allowlist only ────────────────────────────
// Reflecting an arbitrary Origin with credentials enabled would let
// any website make authenticated calls against this API.
const ALLOWED_ORIGINS = [
  'https://www.anvoxa.com',
  'https://anvoxa.com',
  'https://anvoxa-backend-production.up.railway.app',
  process.env.FRONTEND_URL || 'http://localhost:4000',
];

app.use(cors({
  origin(origin, cb) {
    // No Origin header = same-origin request / curl — nothing to grant.
    if (!origin) return cb(null, false);
    cb(null, ALLOWED_ORIGINS.includes(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Security headers ──────────────────────────────────────────
// CSP allows 'unsafe-inline' for script/style because the frontend is
// large single-file HTML pages with inline <script>/<style> throughout —
// moving that to external files or per-tag nonces is a separate, bigger
// refactor. Every external host below is one this app actually calls:
// Google Fonts, the Firebase SDK + auth popup/redirect domains, the
// Umami analytics beacon, and our own Railway backend.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://umami-production-6624.up.railway.app https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "media-src 'self'",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://umami-production-6624.up.railway.app https://anvoxa-backend-production.up.railway.app",
  "frame-src https://accounts.google.com https://anvoxa-1f95c.firebaseapp.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', CSP);
  // allow-popups (not plain same-origin) — Firebase's signInWithPopup opens
  // a popup that talks back to this window; strict same-origin COOP would
  // sever that channel and silently break Google sign-in.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// ── Middleware ────────────────────────────────────────────────
app.use(express.json({ limit: '200kb' }));
app.set('trust proxy', 1);

// ── API routes ────────────────────────────────────────────────
app.use('/auth/admin', adminRoutes.auth);
app.use('/admin',      adminRoutes.protected);
app.use('/auth',       authRoutes);
app.use('/',           apiRoutes);

// ── Page routes ───────────────────────────────────────────────
const send = (file) => (req, res) =>
  res.sendFile(path.join(__dirname, 'public', file));

app.get('/',            send('home.html'));
app.get('/home',        send('home.html'));
app.get('/login',       send('home.html'));
app.get('/admin-login', send('home.html'));
app.get('/terms',       send('home.html'));
app.get('/privacy',     send('home.html'));
app.get('/contact',     send('home.html'));

app.get('/dashboard', send('dashboard.html'));
app.get('/run',       send('run.html'));
app.get('/write',     send('write.html'));
app.get('/deploy',    send('deploy.html'));

app.get('/__/auth/handler', send('home.html'));
app.get('/__/auth/iframe',  send('home.html'));

// Health check
app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'anvoxa-backend' }));

// ── Static assets — cache immutable media, never cache HTML ───
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  setHeaders(res, filePath) {
    if (/\.(png|jpe?g|webp|svg|mp4|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');       // 7 days
    } else if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// Global error handler
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 catch-all (must be last) — starry page for browsers, JSON for APIs
app.use((req, res) => {
  if (req.accepts(['html', 'json']) === 'html') {
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }
  res.status(404).json({ error: 'Route not found' });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`\n  Anvoxa running on http://localhost:${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}\n`);
  console.log(`  /          → home (public landing)`);
  console.log(`  /home      → home (same page, kept for back-compat)`);
  console.log(`  /dashboard → app (auth-gated)\n`);
});
