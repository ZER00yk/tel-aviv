ALTER TABLE creator_play_attempts ADD COLUMN runtime_revision text NOT NULL DEFAULT 'legacy';
CREATE INDEX creator_attempt_speed ON creator_play_attempts(creation_id,creation_version,runtime_revision,simulated_ticks)
 WHERE status='completed';
CREATE TABLE creation_collaborators (
 creation_id uuid NOT NULL REFERENCES creations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 permission text NOT NULL CHECK(permission IN ('viewer','editor')),
 invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
 last_seen_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(creation_id,user_id)
);
CREATE INDEX creation_collaborator_account ON creation_collaborators(user_id,creation_id);
CREATE TABLE creator_follows (
 follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 creator_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(follower_id,creator_id), CHECK(follower_id<>creator_id)
);
CREATE TABLE creation_difficulty_ratings (
 creation_id uuid NOT NULL REFERENCES creations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 rating smallint NOT NULL CHECK(rating BETWEEN 1 AND 5),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(creation_id,user_id)
);
CREATE TABLE creation_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 creation_id uuid NOT NULL REFERENCES creations(id) ON DELETE CASCADE,
 reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
 reason text NOT NULL CHECK(reason IN ('inappropriate','harassment','exploit','misleading','broken','other')),
 details text NOT NULL DEFAULT '' CHECK(length(details)<=1000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed','dismissed')),
 reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
 review_note text CHECK(length(review_note)<=500),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 UNIQUE(creation_id,reporter_id)
);
CREATE INDEX creation_reports_review ON creation_reports(status,created_at);
CREATE INDEX creation_reports_account ON creation_reports(reporter_id,created_at);
