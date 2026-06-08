-- ============================================================
-- ANVOXA · PostgreSQL Schema · Supabase
-- Run this in Supabase SQL Editor (in order)
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('client', 'team');
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'pending');
CREATE TYPE engagement_status AS ENUM ('enquiry', 'scoped', 'active', 'paused', 'complete', 'cancelled');
CREATE TYPE arm_type AS ENUM ('studio', 'research', 'intelligence', 'academy', 'labs', 'core');
CREATE TYPE otp_purpose AS ENUM ('login', 'verify_phone', 'change_phone');

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE,
  phone           TEXT UNIQUE,
  full_name       TEXT,
  role            user_role NOT NULL DEFAULT 'client',
  status          user_status NOT NULL DEFAULT 'active',
  google_id       TEXT UNIQUE,                      -- from Google OAuth
  avatar_url      TEXT,
  phone_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE users IS 'All Anvoxa users — clients and internal team members';
COMMENT ON COLUMN users.role IS 'client = external; team = internal Anvoxa staff';

-- ============================================================
-- OTP TOKENS  (phone-based login)
-- ============================================================

CREATE TABLE otp_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT NOT NULL,
  token_hash    TEXT NOT NULL,                      -- bcrypt hash of the 6-digit OTP
  purpose       otp_purpose NOT NULL DEFAULT 'login',
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  used          BOOLEAN NOT NULL DEFAULT FALSE,
  attempts      SMALLINT NOT NULL DEFAULT 0,        -- max 3 attempts before lock
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_otp_phone ON otp_tokens (phone, used, expires_at);

COMMENT ON TABLE otp_tokens IS 'Short-lived OTP codes sent via SMS. Never store plaintext OTPs.';

-- ============================================================
-- SESSIONS
-- ============================================================

CREATE TABLE sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token   TEXT NOT NULL UNIQUE,             -- hashed refresh token
  device_info     TEXT,                             -- e.g. "Chrome / macOS"
  ip_address      INET,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  revoked         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON sessions (user_id, revoked);

COMMENT ON TABLE sessions IS 'Persistent login sessions. One user can have multiple active sessions.';

-- ============================================================
-- CLIENT PROFILES  (extra info for role = client)
-- ============================================================

CREATE TABLE client_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  organisation    TEXT,
  designation     TEXT,
  country         TEXT DEFAULT 'India',
  archetype       TEXT,                             -- 'founder_book' | 'institution' | 'leader_ai'
  notes           TEXT,                             -- internal Anvoxa notes
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TEAM PROFILES  (extra info for role = team)
-- ============================================================

CREATE TABLE team_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  arm             arm_type,                         -- which arm they primarily work in
  title           TEXT,                             -- e.g. "Research Guide"
  bio             TEXT,
  active_slots    SMALLINT NOT NULL DEFAULT 3,      -- how many engagements they can carry
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ENGAGEMENTS  (client projects / retainers)
-- ============================================================

CREATE TABLE engagements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES users(id),
  arm             arm_type NOT NULL,
  title           TEXT NOT NULL,
  status          engagement_status NOT NULL DEFAULT 'enquiry',
  start_date      DATE,
  end_date        DATE,
  monthly_value   NUMERIC(12,2),                    -- INR or USD
  currency        CHAR(3) DEFAULT 'INR',
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_engagements_client ON engagements (client_id, status);

-- ============================================================
-- ENGAGEMENT ASSIGNMENTS  (team <> engagement)
-- ============================================================

CREATE TABLE engagement_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id   UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  team_member_id  UUID NOT NULL REFERENCES users(id),
  lead            BOOLEAN NOT NULL DEFAULT FALSE,   -- true = lead guide on this engagement
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (engagement_id, team_member_id)
);

-- ============================================================
-- AUDIT LOG  (immutable record of key actions)
-- ============================================================

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id),
  action      TEXT NOT NULL,                        -- e.g. 'login.otp', 'login.google', 'session.revoke'
  meta        JSONB,                                -- arbitrary context
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_log (user_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_log (action, created_at DESC);

COMMENT ON TABLE audit_log IS 'Immutable log. Never update or delete rows.';

-- ============================================================
-- AUTO-UPDATE updated_at  via trigger
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_client_profiles_updated_at
  BEFORE UPDATE ON client_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_team_profiles_updated_at
  BEFORE UPDATE ON team_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_engagements_updated_at
  BEFORE UPDATE ON engagements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (Supabase RLS)
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagements ENABLE ROW LEVEL SECURITY;

-- Users can only read/update their own row
CREATE POLICY "users: own row" ON users
  FOR ALL USING (auth.uid() = id);

-- Clients see only their own profile
CREATE POLICY "client_profiles: own row" ON client_profiles
  FOR ALL USING (auth.uid() = user_id);

-- Team members can see all client profiles (for account management)
CREATE POLICY "client_profiles: team read" ON client_profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'team')
  );

-- Sessions: own only
CREATE POLICY "sessions: own row" ON sessions
  FOR ALL USING (auth.uid() = user_id);

-- Engagements: client sees their own; team sees all
CREATE POLICY "engagements: client own" ON engagements
  FOR SELECT USING (auth.uid() = client_id);

CREATE POLICY "engagements: team all" ON engagements
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'team')
  );
