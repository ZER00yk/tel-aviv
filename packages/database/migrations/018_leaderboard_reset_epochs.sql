-- Preserve ranked game state while resetting exactly one leaderboard scope.
CREATE TABLE leaderboard_reset_epochs (
 game_id text NOT NULL, category text NOT NULL,
 period text NOT NULL CHECK(period IN('all','daily','weekly')),
 period_key text NOT NULL,
 reset_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(game_id,category,period,period_key)
);
CREATE TABLE leaderboard_reset_baselines (
 game_id text NOT NULL, category text NOT NULL,
 period text NOT NULL CHECK(period IN('all','daily','weekly')), period_key text NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 baseline numeric NOT NULL DEFAULT 0 CHECK(baseline>=0),
 blocked_run_id text,
 PRIMARY KEY(game_id,category,period,period_key,user_id),
 FOREIGN KEY(game_id,category,period,period_key) REFERENCES leaderboard_reset_epochs(game_id,category,period,period_key) ON DELETE CASCADE
);
