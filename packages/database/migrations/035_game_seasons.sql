-- Additive, isolated competitions; ordinary all/daily/weekly boards are preserved.
CREATE TABLE game_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  title text NOT NULL CHECK(length(title) BETWEEN 3 AND 80),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK(ends_at > starts_at),
  leaderboard_epoch uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','ended')),
  rewards jsonb NOT NULL CHECK(jsonb_typeof(rewards)='array' AND jsonb_array_length(rewards)=3
    AND (rewards->>0)::integer BETWEEN 0 AND 1000
    AND (rewards->>1)::integer BETWEEN 0 AND 1000
    AND (rewards->>2)::integer BETWEEN 0 AND 1000
    AND (rewards->>0)::integer >= (rewards->>1)::integer AND (rewards->>1)::integer >= (rewards->>2)::integer),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  finalized_at timestamptz,
  CHECK((state='active' AND finalized_at IS NULL) OR (state='ended' AND finalized_at IS NOT NULL))
);
CREATE TABLE game_season_modes (
  season_id uuid NOT NULL REFERENCES game_seasons(id) ON DELETE CASCADE,
  game_id text NOT NULL,
  category text NOT NULL,
  PRIMARY KEY(season_id,game_id,category)
);
CREATE INDEX game_season_mode_lookup ON game_season_modes(game_id,category,season_id);
CREATE TABLE game_season_baselines (
  season_id uuid NOT NULL,
  game_id text NOT NULL,
  category text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  baseline double precision NOT NULL CHECK(baseline>=0 AND baseline<'Infinity'::float8),
  PRIMARY KEY(season_id,game_id,category,user_id),
  FOREIGN KEY(season_id,game_id,category) REFERENCES game_season_modes ON DELETE CASCADE
);
CREATE TABLE game_season_entries (
  season_id uuid NOT NULL,
  game_id text NOT NULL,
  category text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score double precision NOT NULL CHECK(score>0 AND score<'Infinity'::float8),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(season_id,game_id,category,user_id),
  FOREIGN KEY(season_id,game_id,category) REFERENCES game_season_modes ON DELETE CASCADE
);
CREATE INDEX game_season_entry_rank ON game_season_entries(season_id,game_id,category,score DESC,recorded_at,user_id);
CREATE TABLE game_season_standings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL,
  game_id text NOT NULL,
  category text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  rank integer NOT NULL CHECK(rank BETWEEN 1 AND 10000),
  score double precision NOT NULL CHECK(score>0 AND score<'Infinity'::float8),
  reward integer NOT NULL CHECK(reward BETWEEN 0 AND 1000),
  UNIQUE(season_id,game_id,category,rank),
  UNIQUE(season_id,game_id,category,user_id),
  FOREIGN KEY(season_id,game_id,category) REFERENCES game_season_modes ON DELETE CASCADE
);
-- The receipt survives account removal without keeping the deleted identity.
CREATE TABLE game_season_reward_receipts (
  standing_id uuid PRIMARY KEY REFERENCES game_season_standings(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  amount integer NOT NULL CHECK(amount BETWEEN 1 AND 1000),
  ledger_id uuid REFERENCES currency_ledger(id) ON DELETE SET NULL,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX game_season_standings_user ON game_season_standings(user_id,season_id) WHERE user_id IS NOT NULL;
CREATE FUNCTION protect_game_season_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- FK anonymization is allowed; frozen results/rewards cannot be rewritten.
  IF TG_TABLE_NAME='game_season_standings' THEN
    IF (to_jsonb(NEW)-'user_id')=(to_jsonb(OLD)-'user_id') AND NEW.user_id IS NULL THEN RETURN NEW; END IF;
  ELSE
    IF (to_jsonb(NEW)-'user_id'-'ledger_id')=(to_jsonb(OLD)-'user_id'-'ledger_id')
      AND (NEW.user_id=OLD.user_id OR NEW.user_id IS NULL)
      AND (NEW.ledger_id=OLD.ledger_id OR NEW.ledger_id IS NULL) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Competition results and reward receipts are immutable';
END;
$$;
CREATE TRIGGER game_season_frozen_results BEFORE UPDATE ON game_season_standings FOR EACH ROW EXECUTE FUNCTION protect_game_season_history();
CREATE TRIGGER game_season_reward_once BEFORE UPDATE ON game_season_reward_receipts FOR EACH ROW EXECUTE FUNCTION protect_game_season_history();
