-- 002: production account model
--  * users: status (pending/active/deactivated), email verification, TOTP 2FA; restaurant link moved out
--  * student_profiles: unique University ID + verification status
--  * restaurant_users: user <-> restaurant association (one active owner per restaurant)
--  * restaurant_invitations, auth_tokens, notifications, email_outbox, university_roster
--  * restaurants.published_at (draft vs published), request extra info, append-only audit log

CREATE TABLE users_new (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL,
  email                TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('student','restaurant','admin')),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','deactivated')),
  email_verified_at    TEXT,
  phone                TEXT,
  token_version        INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  totp_secret          TEXT,
  totp_pending_secret  TEXT,
  totp_enabled         INTEGER NOT NULL DEFAULT 0,
  last_login_at        TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new (id, name, email, password_hash, role, status, email_verified_at, phone, token_version,
                       must_change_password, last_login_at, created_at, updated_at)
SELECT id, name, email, password_hash, role, CASE WHEN is_active = 1 THEN 'active' ELSE 'deactivated' END,
       created_at, phone, token_version, must_change_password, last_login_at, created_at, updated_at
  FROM users;

CREATE TABLE student_profiles (
  user_id             INTEGER PRIMARY KEY REFERENCES users_new(id) ON DELETE RESTRICT,
  university_id       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('verified','unverified')),
  verified_at         TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO student_profiles (user_id, university_id, verification_status)
SELECT id, COALESCE(NULLIF(student_id_number, ''), 'LEGACY-' || id), 'unverified' FROM users WHERE role = 'student';

CREATE TABLE restaurant_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users_new(id) ON DELETE RESTRICT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  assigned_role TEXT NOT NULL DEFAULT 'owner' CHECK (assigned_role IN ('owner','employee')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
-- One primary owner per restaurant, one active restaurant per account
CREATE UNIQUE INDEX ux_restaurant_owner ON restaurant_users(restaurant_id) WHERE status = 'active' AND assigned_role = 'owner';
CREATE UNIQUE INDEX ux_user_restaurant ON restaurant_users(user_id) WHERE status = 'active';
INSERT OR IGNORE INTO restaurant_users (user_id, restaurant_id, assigned_role)
SELECT id, restaurant_id, COALESCE(staff_role, 'owner') FROM users WHERE role = 'restaurant' AND restaurant_id IS NOT NULL;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

ALTER TABLE restaurants ADD COLUMN published_at TEXT;
UPDATE restaurants SET published_at = created_at;

ALTER TABLE restaurant_requests ADD COLUMN additional_info TEXT;

CREATE TABLE restaurant_invitations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  email         TEXT NOT NULL COLLATE NOCASE,
  token_hash    TEXT NOT NULL UNIQUE,
  replace_owner INTEGER NOT NULL DEFAULT 0,
  request_id    INTEGER REFERENCES restaurant_requests(id),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  expires_at    TEXT NOT NULL,
  invited_by    INTEGER REFERENCES users(id),
  accepted_by   INTEGER REFERENCES users(id),
  accepted_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_invitations_restaurant ON restaurant_invitations(restaurant_id, status);

CREATE TABLE auth_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('email_verification','password_reset','mfa_challenge')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
DROP TABLE IF EXISTS password_reset_tokens;

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);

CREATE TABLE email_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  text_body  TEXT NOT NULL,
  html_body  TEXT,
  status     TEXT NOT NULL CHECK (status IN ('sent','logged','failed')),
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Optional official roster used to verify University IDs (import with `npm run roster:import`)
CREATE TABLE university_roster (
  university_id TEXT PRIMARY KEY COLLATE NOCASE,
  email         TEXT COLLATE NOCASE,
  full_name     TEXT,
  imported_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE audit_logs ADD COLUMN before_data TEXT;
ALTER TABLE audit_logs ADD COLUMN after_data TEXT;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
