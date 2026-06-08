// admin-routes.js — Add this to your Express backend
// Handles: admin login, create admin, list enquiries, update status
//
// SETUP STEPS:
//   1. Run this SQL in Supabase SQL Editor:
//
//      CREATE TABLE admin_users (
//        id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//        email        TEXT UNIQUE NOT NULL,
//        password_hash TEXT NOT NULL,
//        created_at   TIMESTAMPTZ DEFAULT NOW()
//      );
//
//   2. npm install bcrypt jsonwebtoken   (if not already installed)
//
//   3. In your index.js add:
//      const adminRoutes = require('./admin-routes');
//      app.use('/auth/admin', adminRoutes.auth);
//      app.use('/admin',      adminRoutes.protected);
//
//   4. Add ADMIN_JWT_SECRET to your .env file:
//      ADMIN_JWT_SECRET=your_very_long_random_secret_here
//
//   5. Create your first admin account by running this once in Node REPL
//      or adding a temporary /setup route:
//
//      const bcrypt = require('bcrypt');
//      const hash = await bcrypt.hash('your_password_here', 12);
//      // Then insert into Supabase:
//      // INSERT INTO admin_users (email, password_hash)
//      // VALUES ('admin@anvoxa.com', '<hash>');

require('dotenv').config();
const express  = require('express');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const getSupabase = require('./supabase');

const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET || 'change_this_secret';

// ── Middleware: verify admin JWT ──────────────────────────────
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, ADMIN_SECRET);
    if (decoded.role !== 'admin') throw new Error('Not admin');
    req.admin = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Auth routes (public) ──────────────────────────────────────
const authRouter = express.Router();

// POST /auth/admin/login
authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required' });

  try {
    const { data: admin, error } = await getSupabase()
      .from('admin_users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (error || !admin)
      return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid)
      return res.status(401).json({ error: 'Invalid credentials' });

    const adminToken = jwt.sign(
      { id: admin.id, email: admin.email, role: 'admin' },
      ADMIN_SECRET,
      { expiresIn: '8h' }
    );

    return res.json({
      adminToken,
      admin: { id: admin.id, email: admin.email },
    });
  } catch (err) {
    console.error('Admin login error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /auth/admin/create  — create a new admin (requires existing admin token)
authRouter.post('/create', requireAdmin, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8)
    return res.status(400).json({ error: 'Email and password (min 8 chars) required' });

  try {
    const password_hash = await bcrypt.hash(password, 12);
    const { data, error } = await getSupabase()
      .from('admin_users')
      .insert({ email: email.toLowerCase().trim(), password_hash })
      .select('id, email, created_at')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ admin: data });
  } catch (err) {
    console.error('Create admin error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── Protected admin routes ────────────────────────────────────
const protectedRouter = express.Router();
protectedRouter.use(requireAdmin);

// GET /admin/enquiries — fetch all enquiries
protectedRouter.get('/enquiries', async (req, res) => {
  try {
    const { data, error } = await getSupabase()
      .from('research_enquiries')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ enquiries: data });
  } catch (err) {
    console.error('Fetch enquiries error:', err);
    return res.status(500).json({ error: 'Failed to fetch enquiries' });
  }
});

// PATCH /admin/enquiries/:id/status — update enquiry status
protectedRouter.patch('/enquiries/:id/status', async (req, res) => {
  const { id }     = req.params;
  const { status } = req.body || {};
  const allowed    = ['new', 'contacted', 'in_progress', 'closed'];

  if (!allowed.includes(status))
    return res.status(400).json({ error: 'Invalid status value' });

  try {
    const { data, error } = await getSupabase()
      .from('research_enquiries')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ enquiry: data });
  } catch (err) {
    console.error('Update status error:', err);
    return res.status(500).json({ error: 'Failed to update status' });
  }
});

// GET /admin/stats — summary stats
protectedRouter.get('/stats', async (req, res) => {
  try {
    const { data, error } = await getSupabase()
      .from('research_enquiries')
      .select('status, level_type, purpose, created_at');

    if (error) throw error;

    const today     = new Date().toISOString().slice(0, 10);
    const total     = data.length;
    const newCount  = data.filter(e => !e.status || e.status === 'new').length;
    const todayCount= data.filter(e => e.created_at?.startsWith(today)).length;
    const closed    = data.filter(e => e.status === 'closed').length;
    const progress  = data.filter(e => ['contacted','in_progress'].includes(e.status)).length;

    return res.json({ total, newCount, todayCount, closed, progress });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = {
  auth:      authRouter,
  protected: protectedRouter,
};
