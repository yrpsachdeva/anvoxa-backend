// auth.js — Firebase-verified Google / Phone / Email login
// Matches the Anvoxa Supabase schema (users table with UUID id, full_name, avatar_url, google_id)
require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const router = express.Router();
const { generateAccessToken, generateRefreshToken, rotateRefreshToken, revokeAllSessions } = require('./tokenService');
const getSupabase = require('./supabase');

// ─────────────────────────────────────────────────────────────
// Firebase Admin init
// ─────────────────────────────────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
  });
}

// ─────────────────────────────────────────────────────────────
// Map frontend role -> DB enum
//   Frontend sends 'client' or 'researcher'
//   DB enum is        'client' or 'team'
// ─────────────────────────────────────────────────────────────
function mapRole(role) {
  if (role === 'researcher' || role === 'team') return 'team';
  return 'client';
}

// ─────────────────────────────────────────────────────────────
// Find existing user OR create a new one
// We match by:
//   1. google_id  (= Firebase UID — most reliable)
//   2. email      (fallback if same person signs in via different method)
//   3. phone      (fallback for phone OTP)
// Returns the full user row.
// ─────────────────────────────────────────────────────────────
async function findOrCreateUser(decoded, role) {
  const firebaseUid = decoded.uid;
  const email = decoded.email || null;
  const phone = decoded.phone_number || null;
  const fullName = decoded.name || null;
  const avatarUrl = decoded.picture || null;
  const dbRole = mapRole(role);

  // 1. Try to find by google_id (Firebase UID)
  let { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('google_id', firebaseUid)
    .maybeSingle();

  // 2. Fall back to email
  if (!user && email) {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    user = data;
  }

  // 3. Fall back to phone
  if (!user && phone) {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();
    user = data;
  }

  if (user) {
    // Existing user — update missing fields & last_login
    const { data: updated, error } = await supabase
      .from('users')
      .update({
        google_id: user.google_id || firebaseUid,
        email: user.email || email,
        phone: user.phone || phone,
        full_name: user.full_name || fullName,
        avatar_url: user.avatar_url || avatarUrl,
        email_verified: user.email_verified || !!decoded.email_verified,
        phone_verified: user.phone_verified || !!phone,
        last_login_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .select()
      .single();

    if (error) throw new Error('Update user failed: ' + error.message);
    return updated;
  }

  // No user found — create a new one (Supabase auto-generates the UUID id)
  const { data: created, error: createError } = await supabase
    .from('users')
    .insert({
      email,
      phone,
      full_name: fullName,
      avatar_url: avatarUrl,
      google_id: firebaseUid,
      role: dbRole,
      email_verified: !!decoded.email_verified,
      phone_verified: !!phone,
      last_login_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (createError) throw new Error('Create user failed: ' + createError.message);
  return created;
}

// ─────────────────────────────────────────────────────────────
// Shared handler — verify Firebase token, find/create user, issue JWTs
// ─────────────────────────────────────────────────────────────
async function handleFirebaseLogin(req, res, provider) {
  try {
    const { firebaseToken, role } = req.body;
    if (!firebaseToken) return res.status(400).json({ error: 'Firebase token required' });

    // Verify with Firebase Admin
    const decoded = await admin.auth().verifyIdToken(firebaseToken);

    // Find or create the user in Supabase
    const user = await findOrCreateUser(decoded, role);

    // Issue your own JWTs
    const accessToken = generateAccessToken(user);
    const refreshToken = await generateRefreshToken(
      user.id,
      req.headers['user-agent'],
      req.ip
    );

    // ⚠ Frontend reads `accessToken` (not `token`) — keep this name!
    res.json({ accessToken, refreshToken, user });
  } catch (err) {
    console.error(`[${provider} login error]`, err);
    res.status(401).json({ error: err.message || 'Authentication failed' });
  }
}

// ─────────────────────────────────────────────────────────────
// Routes — match the frontend exactly
// ─────────────────────────────────────────────────────────────
router.post('/firebase/google', (req, res) => handleFirebaseLogin(req, res, 'google'));
router.post('/firebase/phone',  (req, res) => handleFirebaseLogin(req, res, 'phone'));
router.post('/firebase/email',  (req, res) => handleFirebaseLogin(req, res, 'email'));

// ─────────────────────────────────────────────────────────────
// POST /auth/refresh
// ─────────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const { userId, refreshToken } = req.body;
    if (!userId || !refreshToken) {
      return res.status(400).json({ error: 'userId and refreshToken required' });
    }

    const newRefreshToken = await rotateRefreshToken(
      refreshToken,
      userId,
      req.headers['user-agent'],
      req.ip
    );

    const { data: user } = await getSupabase().from('users').select('*').eq('id', userId).single();
    const accessToken = generateAccessToken(user);

    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /auth/logout
// ─────────────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    await revokeAllSessions(userId);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
