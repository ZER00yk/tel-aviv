-- Native credentials are additive: UUID ownership and historical identities stay intact.
CREATE TABLE user_credentials (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 password_hash text NOT NULL,
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sessions ADD COLUMN authentication_method text NOT NULL DEFAULT 'legacy'
 CHECK (authentication_method IN ('legacy','development','password'));
ALTER TABLE sessions ADD COLUMN authenticated_at timestamptz;
ALTER TABLE sessions ADD COLUMN credential_version bigint;
CREATE TABLE password_reset_tokens (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 credential_version bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX password_reset_one_active_per_user ON password_reset_tokens(user_id);
CREATE INDEX password_reset_expiry ON password_reset_tokens(expires_at);
CREATE TABLE account_recovery_codes (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 code_hash text NOT NULL UNIQUE,
 credential_version bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_recovery_user ON account_recovery_codes(user_id);
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
CREATE TABLE email_verification_tokens (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 email text NOT NULL,
 credential_version bigint NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verification_expiry ON email_verification_tokens(expires_at);
CREATE TABLE account_security_events (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN (
 'registered','login','password_changed','recovery_requested','recovery_delivery_failed',
 'password_reset','recovery_codes_generated','recovery_code_used','reauthenticated',
 'session_revoked','sessions_revoked','development_bootstrap','email_changed','email_verified')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_security_events_user ON account_security_events(user_id,created_at DESC);
