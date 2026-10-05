CREATE TABLE IF NOT EXISTS game_saves (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version BETWEEN 1 AND 1000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);
CREATE TABLE IF NOT EXISTS game_states (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);
CREATE TABLE IF NOT EXISTS game_play_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  mode text NOT NULL DEFAULT 'solo'
);
CREATE UNIQUE INDEX IF NOT EXISTS game_one_active_session ON game_play_sessions(user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS game_sessions_history ON game_play_sessions(user_id, started_at DESC);
CREATE TABLE IF NOT EXISTS game_favorites (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,game_id)
);
CREATE TABLE IF NOT EXISTS achievement_definitions (
  id text PRIMARY KEY,
  game_id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  icon text NOT NULL DEFAULT 'star',
  hidden boolean NOT NULL DEFAULT false,
  points integer NOT NULL CHECK (points >= 0),
  criteria jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id text NOT NULL REFERENCES achievement_definitions(id),
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,achievement_id)
);
CREATE TABLE IF NOT EXISTS leaderboard_entries (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id text NOT NULL,
  category text NOT NULL,
  period text NOT NULL CHECK (period IN ('all','daily','weekly')),
  period_key text NOT NULL,
  score double precision NOT NULL CHECK (score >= 0 AND score < 'Infinity'::float8),
  metadata jsonb NOT NULL DEFAULT '{}',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,game_id,category,period,period_key)
);
CREATE INDEX IF NOT EXISTS leaderboard_rank ON leaderboard_entries(game_id,category,period,period_key,score DESC);
CREATE TABLE IF NOT EXISTS currency_accounts (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency text NOT NULL CHECK (currency IN ('tell-coins','casino-credits')),
  balance bigint NOT NULL DEFAULT 0 CHECK(balance >= 0 AND balance <= 1000000000000),
  last_reward_at timestamptz,
  PRIMARY KEY(user_id,currency)
);
CREATE TABLE IF NOT EXISTS currency_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency text NOT NULL,
  amount bigint NOT NULL CHECK(amount <> 0),
  balance_after bigint NOT NULL CHECK(balance_after >= 0),
  reason text NOT NULL,
  reference_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_user ON currency_ledger(user_id,currency,created_at DESC);
CREATE TABLE IF NOT EXISTS cosmetic_inventory (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,item_id)
);
INSERT INTO achievement_definitions(id,game_id,name,description,points,criteria) VALUES
 ('incremental-forge','incremental','First alloy','Produce your first alloy.',25,'{"alloy":1}'),
 ('incremental-prestige','incremental','New perspective','Complete your first prestige.',100,'{"prestige":1}'),
 ('incremental-ascend','incremental','Beyond the workshop','Complete an ascension.',200,'{"ascensions":1}'),
 ('tycoon-empire','tycoon','A small empire','Own three businesses.',50,'{"businesses":3}'),
 ('tycoon-million','tycoon','Millionaire','Earn a million fictional cash.',150,'{"earned":1000000}'),
 ('casino-first-win','casino','Lucky break','Win a server verified casino round.',25,'{"wins":1}'),
 ('deck-clear','deck-roguelike','The final page','Defeat the final archive guardian.',150,'{"clear":true}'),
 ('tower-ten','tower-defense','Holding the line','Survive ten server simulated waves.',75,'{"wave":10}'),
 ('tower-clear','tower-defense','Path secured','Complete twenty waves.',150,'{"clear":true}')
ON CONFLICT(id) DO NOTHING;
