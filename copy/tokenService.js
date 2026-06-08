const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const getSupabase = require('./supabase');

// ── Generate short-lived access token (15 min) ──────────────
function generateAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, phone: user.phone },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m' }
  );
}

// ── Generate refresh token and persist to DB ─────────────────
async function generateRefreshToken(userId, deviceInfo, ipAddress) {
  const raw = uuidv4() + uuidv4();              // 72-char random string
  const hashed = await bcrypt.hash(raw, 10);

  const { error } = await getSupabase().from('sessions').insert({
    user_id: userId,
    refresh_token: hashed,
    device_info: deviceInfo,
    ip_address: ipAddress,
  });

  if (error) throw new Error('Could not persist session: ' + error.message);
  return raw;  // return plaintext to send to client (once only)
}

// ── Verify and rotate refresh token ──────────────────────────
async function rotateRefreshToken(rawToken, userId, deviceInfo, ip) {
  const { data: sessions, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('revoked', false)
    .gt('expires_at', new Date().toISOString());

  if (error || !sessions.length) throw new Error('No valid sessions found');

  // find matching hashed token
  let matched = null;
  for (const s of sessions) {
    const ok = await bcrypt.compare(rawToken, s.refresh_token);
    if (ok) { matched = s; break; }
  }
  if (!matched) throw new Error('Refresh token invalid or expired');

  // revoke old session
  await getSupabase().from('sessions').update({ revoked: true }).eq('id', matched.id);

  // issue new
  return generateRefreshToken(userId, deviceInfo, ip);
}

// ── Revoke all sessions for a user (full logout) ─────────────
async function revokeAllSessions(userId) {
  await getSupabase().from('sessions').update({ revoked: true }).eq('user_id', userId);
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  rotateRefreshToken,
  revokeAllSessions,
};

