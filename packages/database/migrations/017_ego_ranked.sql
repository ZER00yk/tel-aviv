CREATE TABLE ego_ranked_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seed bigint NOT NULL CHECK(seed BETWEEN 0 AND 4294967295),
  game_version text NOT NULL,
  mode text NOT NULL CHECK(mode='boss-gauntlet'),
  difficulty text NOT NULL CHECK(difficulty IN ('standard','volatile')),
  modifiers jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(modifiers)='array'),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','failed','abandoned','expired')),
  validation_status text NOT NULL DEFAULT 'server-simulated' CHECK(validation_status IN ('server-simulated','version-preserved')),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  state jsonb NOT NULL CHECK(jsonb_typeof(state)='object'),
  statistics jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(statistics)='object'),
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  completion_ms bigint CHECK(completion_ms>=0),
  deaths integer NOT NULL DEFAULT 0 CHECK(deaths BETWEEN 0 AND 1),
  final_boss_reached text,
  rewarded_at timestamptz,
  CHECK((status='active' AND ended_at IS NULL) OR (status<>'active' AND ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX ego_ranked_one_active ON ego_ranked_runs(user_id) WHERE status='active';
CREATE INDEX ego_ranked_history ON ego_ranked_runs(user_id,started_at DESC);
CREATE TABLE ego_permanent_progress (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bosses jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(bosses)='array'),
  completions integer NOT NULL DEFAULT 0 CHECK(completions>=0),
  runs integer NOT NULL DEFAULT 0 CHECK(runs>=0),
  insight integer NOT NULL DEFAULT 0 CHECK(insight>=0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO achievement_definitions(id,game_id,name,description,points,criteria) VALUES
 ('ego-ranked-rowan','ego-trip','Outside the orbit','Defeat Rowan in a server-simulated ranked run.',35,'{"rankedBoss":"Rowan"}'),
 ('ego-ranked-bennett','ego-trip','Break the plan','Defeat Bennett in a server-simulated ranked run.',40,'{"rankedBoss":"Bennett"}'),
 ('ego-ranked-austin','ego-trip','Find your pace','Defeat Austin in a server-simulated ranked run.',45,'{"rankedBoss":"Austin"}'),
 ('ego-ranked-dakota','ego-trip','Through the noise','Defeat Dakota in a server-simulated ranked run.',50,'{"rankedBoss":"Dakota"}'),
 ('ego-ranked-mira','ego-trip','Beyond the reflection','Defeat Mira in a server-simulated ranked run.',55,'{"rankedBoss":"Mira"}'),
 ('ego-ranked-sol','ego-trip','Still a spark','Defeat Sol in a server-simulated ranked run.',60,'{"rankedBoss":"Sol"}'),
 ('ego-ranked-inez','ego-trip','Keep the promise','Defeat Inez in a server-simulated ranked run.',65,'{"rankedBoss":"Inez"}'),
 ('ego-ranked-noa','ego-trip','Write your ending','Defeat Noa in a server-simulated ranked run.',70,'{"rankedBoss":"Noa"}'),
 ('ego-ranked-clear','ego-trip','Verified confidence','Complete the entire server-simulated ranked boss gauntlet.',150,'{"rankedClear":true}'),
 ('ego-ranked-volatile','ego-trip','Steady in the storm','Complete a server-simulated ranked volatile run.',200,'{"rankedDifficulty":"volatile","clear":true}')
ON CONFLICT(id) DO NOTHING;
