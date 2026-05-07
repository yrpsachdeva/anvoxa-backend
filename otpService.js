const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

// ── Send OTP via Twilio Verify ────────────────────────────────
// Twilio generates, sends, and verifies the OTP — we never store it
async function sendOtp(phone) {
  // Ensure E.164 format: +919876543210
  const e164 = phone.startsWith('+') ? phone : '+91' + phone;

  const verification = await client.verify.v2
    .services(SERVICE_SID)
    .verifications.create({ to: e164, channel: 'sms' });

  return { status: verification.status, to: verification.to };
}

// ── Verify the OTP code the user submitted ────────────────────
async function verifyOtp(phone, code) {
  const e164 = phone.startsWith('+') ? phone : '+91' + phone;

  const result = await client.verify.v2
    .services(SERVICE_SID)
    .verificationChecks.create({ to: e164, code });

  // result.status === 'approved' means correct
  return result.status === 'approved';
}

module.exports = { sendOtp, verifyOtp };
