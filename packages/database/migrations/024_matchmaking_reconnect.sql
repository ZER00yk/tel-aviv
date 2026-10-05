ALTER TABLE matchmaking_members ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
