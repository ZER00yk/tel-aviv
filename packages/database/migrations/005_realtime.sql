CREATE TABLE multiplayer_matches (
  id uuid PRIMARY KEY,
  game_id varchar(40) NOT NULL,
  lobby_code varchar(8) NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL DEFAULT now(),
  result jsonb NOT NULL
);
CREATE TABLE multiplayer_results (
  match_id uuid NOT NULL REFERENCES multiplayer_matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score integer NOT NULL DEFAULT 0,
  won boolean NOT NULL DEFAULT false,
  PRIMARY KEY(match_id,user_id)
);
CREATE INDEX multiplayer_user_history ON multiplayer_results(user_id,match_id);
