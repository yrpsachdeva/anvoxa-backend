// api.js — Authenticated routes for the dashboard
// Engagements (list, create) + Profile (update)
require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const getSupabase = require('./supabase');

// ─────────────────────────────────────────────────────────────
// requireAuth — middleware that verifies the access token
// ─────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.sub;
    req.userRole = decoded.role;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─────────────────────────────────────────────────────────────
// GET /engagements — list current user's engagements
// (clients see their own; team sees all)
// ─────────────────────────────────────────────────────────────
router.get('/engagements', requireAuth, async (req, res) => {
  try {
    let query = getSupabase().from('engagements').select('*').order('created_at', { ascending: false });
    if (req.userRole !== 'team') {
      query = query.eq('client_id', req.userId);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json({ engagements: data || [] });
  } catch (err) {
    console.error('[GET /engagements]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /engagements — create a new engagement (clients only)
// body: { title, arm, notes }
// ─────────────────────────────────────────────────────────────
router.post('/engagements', requireAuth, async (req, res) => {
  try {
    const { title, arm, notes } = req.body;
    if (!title || !arm) return res.status(400).json({ error: 'Title and arm required' });

    const validArms = ['studio', 'research', 'intelligence', 'academy', 'labs', 'core'];
    if (!validArms.includes(arm)) return res.status(400).json({ error: 'Invalid arm' });

    const { data, error } = await supabase
      .from('engagements')
      .insert({
        client_id: req.userId,
        arm,
        title,
        notes: notes || null,
        status: 'enquiry',
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ engagement: data });
  } catch (err) {
    console.error('[POST /engagements]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// PATCH /profile — update the current user's profile
// body: { full_name?, phone?, organisation?, designation? }
//
// Note: full_name and phone live on `users`.
// organisation and designation live on `client_profiles`.
// We update both and return the merged user object.
// ─────────────────────────────────────────────────────────────
router.patch('/profile', requireAuth, async (req, res) => {
  try {
    const { full_name, phone, organisation, designation } = req.body;

    // 1. Update users table
    const userPatch = {};
    if (full_name !== undefined) userPatch.full_name = full_name;
    if (phone !== undefined) userPatch.phone = phone;

    let userRow;
    if (Object.keys(userPatch).length) {
      const { data, error } = await supabase
        .from('users')
        .update(userPatch)
        .eq('id', req.userId)
        .select()
        .single();
      if (error) throw error;
      userRow = data;
    } else {
      const { data } = await getSupabase().from('users').select('*').eq('id', req.userId).single();
      userRow = data;
    }

    // 2. Upsert client_profiles row (only if user is a client and we have profile fields)
    let profileRow = {};
    if ((organisation !== undefined || designation !== undefined) && req.userRole === 'client') {
      const profilePatch = { user_id: req.userId };
      if (organisation !== undefined) profilePatch.organisation = organisation;
      if (designation !== undefined) profilePatch.designation = designation;

      const { data, error } = await supabase
        .from('client_profiles')
        .upsert(profilePatch, { onConflict: 'user_id' })
        .select()
        .single();
      if (error) throw error;
      profileRow = data;
    } else {
      // Try fetching existing profile so frontend gets it back
      const { data } = await supabase
        .from('client_profiles')
        .select('organisation, designation')
        .eq('user_id', req.userId)
        .maybeSingle();
      profileRow = data || {};
    }

    // 3. Merge for the frontend
    const merged = {
      ...userRow,
      organisation: profileRow.organisation || null,
      designation: profileRow.designation || null,
    };

    res.json({ user: merged });
  } catch (err) {
    console.error('[PATCH /profile]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /me — return the latest user info (handy on dashboard load)
// ─────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { data: userRow, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.userId)
      .single();
    if (error) throw error;

    const { data: profileRow } = await supabase
      .from('client_profiles')
      .select('organisation, designation')
      .eq('user_id', req.userId)
      .maybeSingle();

    res.json({
      user: {
        ...userRow,
        organisation: profileRow?.organisation || null,
        designation: profileRow?.designation || null,
      },
    });
  } catch (err) {
    console.error('[GET /me]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

