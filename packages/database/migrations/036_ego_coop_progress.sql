ALTER TABLE ego_permanent_progress ADD COLUMN discoveries jsonb NOT NULL DEFAULT '[]'
  CHECK(jsonb_typeof(discoveries)='array' AND jsonb_array_length(discoveries)<=2);
CREATE TABLE ego_coop_completion_receipts (
  match_id uuid NOT NULL REFERENCES multiplayer_matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  discoveries jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(discoveries)='array' AND jsonb_array_length(discoveries)<=2),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(match_id,user_id)
);
CREATE INDEX ego_coop_completion_owner ON ego_coop_completion_receipts(user_id,recorded_at DESC);
