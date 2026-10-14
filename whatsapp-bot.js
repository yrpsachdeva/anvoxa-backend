// whatsapp-bot.js — Anvoxa WhatsApp Chatbot
// ─────────────────────────────────────────────────────────────
// Uses Twilio WhatsApp sandbox / business number to run a
// multi-turn conversation, collect lead info, save to Supabase
// as a consultation, and notify the team via WhatsApp + email.
//
// SETUP:
//   1. In Twilio console → Messaging → WhatsApp → Sandbox (or Business)
//      set the Webhook URL to: https://your-railway-url.up.railway.app/whatsapp
//      Method: HTTP POST
//   2. Add to .env:
//        TWILIO_WHATSAPP_FROM=whatsapp:+14155238886   (sandbox) or your business number
//        TEAM_WHATSAPP=whatsapp:+916291881019          (your number to receive alerts)
//        TEAM_EMAIL=helloanvox@gmail.com
//   3. In index.js add:
//        const waBot = require('./whatsapp-bot');
//        app.use('/whatsapp', express.urlencoded({ extended: false }), waBot);
// ─────────────────────────────────────────────────────────────

require('dotenv').config();
const express   = require('express');
const twilio    = require('twilio');
const getSupabase = require('./supabase');

const router = express.Router();

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM  = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
const TEAM_WA    = process.env.TEAM_WHATSAPP   || null;
const TEAM_EMAIL = process.env.TEAM_EMAIL      || 'helloanvox@gmail.com';

// ── In-memory session store (resets on server restart)
// For production: replace with Redis or a Supabase sessions table.
const sessions = new Map();

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes of inactivity

// ── Conversation steps ────────────────────────────────────────
// Each step has: message to send, field to store answer in,
// optional validator, and next step key.
const FLOW = {
  start: {
    msg: () => `👋 Hi! I'm the Anvoxa assistant.\n\nI'll connect you with the right person in just a few questions.\n\nWhat's your *full name*?`,
    field: 'name',
    next: 'service',
  },
  service: {
    msg: (s) => `Great, ${s.name?.split(' ')[0] || 'there'}! 👍\n\nWhat can we help you with?\n\nReply with a number:\n*1* — Research & Publishing\n*2* — AI / Chatbot Solutions\n*3* — Ebook Production\n*4* — EB-1A / NIW Immigration\n*5* — Something else`,
    field: 'service_choice',
    validator: (v) => ['1','2','3','4','5'].includes(v.trim()),
    errorMsg: 'Please reply with a number *1–5* to choose a service.',
    next: 'detail',
  },
  detail: {
    msg: (s) => {
      const svc = serviceLabel(s.service_choice);
      return `Got it — *${svc}*.\n\nCan you share a brief description of what you need? Even a sentence or two helps us prepare.\n\n_(Type "skip" to move on)_`;
    },
    field: 'notes',
    transform: (v) => v.toLowerCase() === 'skip' ? null : v,
    next: 'email',
  },
  email: {
    msg: () => `What's the best *email address* to reach you on?\n\nWe'll use this to send a meeting link once we confirm a slot.`,
    field: 'email',
    validator: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
    errorMsg: 'That doesn\'t look like a valid email. Please try again.',
    next: 'timezone',
  },
  timezone: {
    msg: () => `Almost done! 🎉\n\nWhich region are you in? (helps us suggest the right time slot)\n\n*1* — India / South Asia\n*2* — Middle East / Gulf\n*3* — Europe / UK\n*4* — USA / Canada\n*5* — Southeast Asia / Aus\n*6* — Other`,
    field: 'region_choice',
    validator: (v) => ['1','2','3','4','5','6'].includes(v.trim()),
    errorMsg: 'Please reply with a number *1–6* to choose your region.',
    next: 'done',
  },
  done: {
    msg: (s) => {
      const svc  = serviceLabel(s.service_choice);
      const region = regionLabel(s.region_choice);
      return `✅ *All set, ${s.name?.split(' ')[0] || 'there'}!*\n\nHere's what we noted:\n• Service: ${svc}\n• Region: ${region}\n• Email: ${s.email}\n\nA member of our team will reach out within *2 working days* to schedule a free 30-min call.\n\nYou can also book a slot directly at 👉 https://anvoxa.com\n\nTalk soon! 🚀 — *Anvoxa*`;
    },
    field: null,
    next: null,
  },
};

// ── Helpers ───────────────────────────────────────────────────
function serviceLabel(choice) {
  const map = { '1':'Research & Publishing', '2':'AI / Chatbot Solutions', '3':'Ebook Production', '4':'EB-1A / NIW Immigration', '5':'Other' };
  return map[choice] || 'Other';
}
function regionLabel(choice) {
  const map = { '1':'India / South Asia', '2':'Middle East / Gulf', '3':'Europe / UK', '4':'USA / Canada', '5':'SE Asia / Australia', '6':'Other' };
  return map[choice] || 'Other';
}

function getOrCreateSession(from) {
  if (sessions.has(from)) {
    const s = sessions.get(from);
    // Reset expired sessions
    if (Date.now() - s.lastActivity > SESSION_TTL_MS) {
      sessions.delete(from);
    } else {
      s.lastActivity = Date.now();
      return s;
    }
  }
  const s = { step: 'start', data: {}, lastActivity: Date.now() };
  sessions.set(from, s);
  return s;
}

function sendWhatsApp(to, body) {
  return twilioClient.messages.create({ from: FROM, to, body });
}

// ── Save lead to Supabase consultations table ─────────────────
async function saveLead(from, data) {
  try {
    const svc = serviceLabel(data.service_choice);
    const region = regionLabel(data.region_choice);
    await getSupabase()
      .from('consultations')
      .insert({
        name:             data.name || 'WhatsApp Lead',
        email:            data.email || null,
        service_interest: svc,
        slot_utc:         null,   // no slot booked yet — team will follow up
        slot_ist:         null,
        user_tz:          region,
        notes:            data.notes ? `[WhatsApp] ${data.notes}` : '[WhatsApp enquiry — no notes]',
        status:           'pending',
      });
    console.log('[WhatsApp bot] Lead saved for', from);
  } catch (err) {
    console.error('[WhatsApp bot] Failed to save lead:', err.message);
  }
}

// ── Notify team ───────────────────────────────────────────────
async function notifyTeam(from, data) {
  const svc    = serviceLabel(data.service_choice);
  const region = regionLabel(data.region_choice);
  const msg    = `🔔 *New WhatsApp Lead — Anvoxa*\n\n👤 *Name:* ${data.name || '—'}\n📧 *Email:* ${data.email || '—'}\n🌍 *Region:* ${region}\n🛠 *Service:* ${svc}\n💬 *Notes:* ${data.notes || '—'}\n📱 *WhatsApp:* ${from.replace('whatsapp:','')}`;

  // 1. WhatsApp alert to team number
  if (TEAM_WA) {
    try { await sendWhatsApp(TEAM_WA, msg); } catch(e) { console.error('[notify team WA]', e.message); }
  }

  // 2. Console log (email via SendGrid/Nodemailer can be wired here)
  console.log('[WhatsApp bot] Team notified:\n', msg);
  // TODO: wire up email via nodemailer/sendgrid if needed
  // await sendEmail({ to: TEAM_EMAIL, subject: `New WhatsApp lead: ${data.name}`, text: msg });
}

// ── Webhook handler ───────────────────────────────────────────
router.post('/', async (req, res) => {
  // Twilio sends application/x-www-form-urlencoded
  const from = req.body?.From;
  const body = (req.body?.Body || '').trim();

  if (!from) return res.sendStatus(400);

  console.log(`[WhatsApp] ${from}: "${body}"`);

  const session = getOrCreateSession(from);
  const step    = FLOW[session.step];

  // ── Handle "restart" keyword at any point
  if (body.toLowerCase() === 'restart' || body.toLowerCase() === 'start') {
    sessions.delete(from);
    const fresh = getOrCreateSession(from);
    const firstStep = FLOW['start'];
    await sendWhatsApp(from, firstStep.msg(fresh.data));
    res.sendStatus(200);
    return;
  }

  // ── If this is the very first message (step = start), send the greeting
  if (session.step === 'start' && !session.data.name) {
    // Send greeting and move to awaiting name
    await sendWhatsApp(from, step.msg(session.data));
    // step stays 'start' — next message will be their name
    res.sendStatus(200);
    return;
  }

  // ── Validate the user's reply for the current step
  if (step.validator && !step.validator(body)) {
    await sendWhatsApp(from, step.errorMsg || 'Sorry, I didn\'t understand that. Please try again.');
    res.sendStatus(200);
    return;
  }

  // ── Store the answer
  if (step.field) {
    session.data[step.field] = step.transform ? step.transform(body) : body;
  }

  // ── Advance to next step
  session.step = step.next;
  session.lastActivity = Date.now();

  const nextStep = FLOW[session.step];
  if (!nextStep) {
    // Shouldn't happen, but reset gracefully
    sessions.delete(from);
    res.sendStatus(200);
    return;
  }

  // ── Send the next question / closing message
  await sendWhatsApp(from, nextStep.msg(session.data));

  // ── If we just sent the 'done' message, save and notify
  if (session.step === 'done') {
    await saveLead(from, session.data);
    await notifyTeam(from, session.data);
    sessions.delete(from); // clear session after completion
  }

  res.sendStatus(200);
});

// ── Periodic cleanup of expired sessions (every 10 min) ──────
setInterval(() => {
  const now = Date.now();
  for (const [key, s] of sessions.entries()) {
    if (now - s.lastActivity > SESSION_TTL_MS) sessions.delete(key);
  }
}, 10 * 60 * 1000);

module.exports = router;
