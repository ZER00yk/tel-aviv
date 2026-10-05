-- Existing gauntlets remain intact. Canonical server state and revision fencing are reused.
ALTER TABLE ego_ranked_runs DROP CONSTRAINT ego_ranked_runs_mode_check;
ALTER TABLE ego_ranked_runs ADD CONSTRAINT ego_ranked_runs_mode_check
  CHECK (mode IN ('boss-gauntlet','campaign'));
INSERT INTO achievement_definitions(id,game_id,name,description,points,criteria)
VALUES ('ego-ranked-campaign','ego-trip','Every district, verified',
  'Complete forty server-simulated campaign rooms and all eight bosses.',200,
  '{"rankedMode":"campaign","rooms":40,"clear":true}')
ON CONFLICT(id) DO NOTHING;
