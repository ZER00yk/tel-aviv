CREATE TABLE users (
 id uuid PRIMARY KEY, google_sub text UNIQUE, email text, username varchar(24) NOT NULL UNIQUE,
 display_name varchar(80) NOT NULL, avatar text, banner text, bio text NOT NULL DEFAULT '', status text NOT NULL DEFAULT '',
 xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0), role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','owner')),
 settings jsonb NOT NULL DEFAULT '{}', disabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_ci ON users(lower(username));
CREATE TABLE sessions (
 id uuid PRIMARY KEY, token_hash text NOT NULL UNIQUE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 user_agent text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE TABLE oauth_states (state_hash text PRIMARY KEY, verifier text NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE username_history (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, username text NOT NULL, changed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE platform_flags (key text PRIMARY KEY, enabled boolean NOT NULL DEFAULT true);
CREATE TABLE announcements (id uuid PRIMARY KEY, author_id uuid REFERENCES users(id) ON DELETE SET NULL, title text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE error_reports (id uuid PRIMARY KEY, user_id uuid REFERENCES users(id) ON DELETE SET NULL, component text NOT NULL, message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
