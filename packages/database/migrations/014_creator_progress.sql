ALTER TABLE creations ADD COLUMN category text NOT NULL DEFAULT 'platformer'
 CHECK(category IN('platformer','puzzle','action','exploration','challenge','other'));
CREATE TABLE creator_play_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 creation_id uuid NOT NULL REFERENCES creations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 creation_version integer NOT NULL CHECK(creation_version>0),
 seed bigint NOT NULL CHECK(seed BETWEEN 0 AND 4294967295),
 level jsonb NOT NULL CHECK(jsonb_typeof(level)='object'),
 state jsonb NOT NULL CHECK(jsonb_typeof(state)='object'),
 next_sequence integer NOT NULL DEFAULT 0 CHECK(next_sequence>=0),
 simulated_ticks integer NOT NULL DEFAULT 0 CHECK(simulated_ticks BETWEEN 0 AND 18000),
 status text NOT NULL DEFAULT 'playing' CHECK(status IN('playing','completed','failed','expired')),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 validated_at timestamptz
);
CREATE INDEX creator_attempts_user_time ON creator_play_attempts(user_id,started_at DESC);
CREATE TABLE creator_completions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 creation_id uuid NOT NULL REFERENCES creations(id) ON DELETE CASCADE,
 user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 creation_version integer NOT NULL CHECK(creation_version>0),
 attempt_id uuid UNIQUE REFERENCES creator_play_attempts(id) ON DELETE SET NULL,
 ticks integer NOT NULL CHECK(ticks BETWEEN 1 AND 18000),
 deaths integer NOT NULL CHECK(deaths>=0),
 completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(creation_id,user_id,creation_version)
);
CREATE INDEX creator_completion_listing ON creator_completions(creation_id,completed_at DESC);
CREATE TABLE creator_play_visits (
 creation_id uuid NOT NULL REFERENCES creations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 visit_date date NOT NULL DEFAULT CURRENT_DATE,
 PRIMARY KEY(creation_id,user_id,visit_date)
);
