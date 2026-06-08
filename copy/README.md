# Anvoxa Backend · Setup Guide

## Stack
- **Database**: PostgreSQL via Supabase (free tier)
- **Backend**: Node.js + Express
- **OTP (SMS)**: Twilio Verify
- **Google Auth**: Google OAuth 2.0
- **Auth tokens**: JWT (access) + UUID refresh tokens

---

## Step 1 · Supabase Setup

1. Go to https://supabase.com → New Project
2. Choose a region close to India (Singapore or Mumbai)
3. Once created, go to **SQL Editor**
4. Paste and run the entire contents of `sql/001_schema.sql`
5. Copy your keys from **Settings → API**:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` ← keep this secret, server-side only

---

## Step 2 · Twilio Setup

1. Sign up at https://twilio.com
2. Go to **Verify → Services → Create new**
3. Name it "Anvoxa" — copy the **Service SID** (`VA...`)
4. From the dashboard copy your **Account SID** and **Auth Token**

---

## Step 3 · Google OAuth Setup

1. Go to https://console.cloud.google.com
2. Create a project → **APIs & Services → Credentials**
3. Create **OAuth 2.0 Client ID** (Web application)
4. Add your frontend URL to **Authorized JavaScript origins**
5. Copy the **Client ID** (`...apps.googleusercontent.com`)

---

## Step 4 · Local Setup

```bash
# Install dependencies
npm install

# Copy env file and fill in your values
cp .env.example .env

# Start dev server
npm run dev
```

Server starts at: http://localhost:4000

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/otp/send` | Send OTP to phone |
| POST | `/auth/otp/verify` | Verify OTP → returns tokens |
| POST | `/auth/google` | Google login → returns tokens |
| POST | `/auth/refresh` | Rotate refresh token |
| POST | `/auth/logout` | Revoke all sessions |
| GET  | `/health` | Server health check |

---

## Auth Flow (Phone OTP)

```
Frontend          Backend            Twilio           Supabase
   |                  |                 |                 |
   |-- POST /otp/send→|                 |                 |
   |                  |-- Send SMS ────→|                 |
   |←── { phone } ────|                 |                 |
   |                  |                 |                 |
   | (user enters OTP)|                 |                 |
   |                  |                 |                 |
   |-- POST /otp/verify→               |                 |
   |                  |── verify code ─→|                 |
   |                  |←── approved ────|                 |
   |                  |── upsert user ──────────────────→|
   |                  |← user row ──────────────────────|
   |←─ { accessToken, refreshToken, user } ─────────────|
```

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `users` | All users — clients and team |
| `otp_tokens` | Reserved (Twilio handles OTP storage) |
| `sessions` | Refresh token store (hashed) |
| `client_profiles` | Extended info for clients |
| `team_profiles` | Extended info for team members |
| `engagements` | Client projects / retainers |
| `engagement_assignments` | Team ↔ engagement mapping |
| `audit_log` | Immutable action log |

---

## Frontend Integration (React)

```js
// 1. Send OTP
await fetch('http://localhost:4000/auth/otp/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: '9876543210' })
});

// 2. Verify OTP
const res = await fetch('http://localhost:4000/auth/otp/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: '9876543210', code: '483920', role: 'client' })
});
const { accessToken, refreshToken, user } = await res.json();

// Store tokens (use httpOnly cookies in production, not localStorage)
localStorage.setItem('refreshToken', refreshToken);
// Pass accessToken in Authorization header for protected calls
```

---

## Security Notes

- OTP codes are **never stored** in your database — Twilio manages them
- Refresh tokens are **bcrypt-hashed** before storage
- Access tokens expire in **15 minutes**
- All tables have **Row Level Security** enabled in Supabase
- Rate limiting on OTP endpoints (3 sends / 10 verifies per 10 min)
- Audit log is **append-only** — never update or delete rows
