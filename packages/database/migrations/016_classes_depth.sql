-- Private study history, assignment change history and durable reminder deduplication.
CREATE TABLE school_flashcard_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 resource_id uuid NOT NULL REFERENCES school_resources(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 card_key text NOT NULL CHECK(card_key ~ '^[0-9a-f]{64}$'),
 rating text NOT NULL CHECK(rating IN ('again','hard','good','easy')),
 front text NOT NULL, back text NOT NULL,
 interval_seconds integer NOT NULL CHECK(interval_seconds BETWEEN 0 AND 31536000),
 review_version integer NOT NULL CHECK(review_version > 0),
 due_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX school_flashcard_reviews_history ON school_flashcard_reviews(user_id,resource_id,created_at DESC,id DESC);
CREATE TABLE school_assignment_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 resource_id uuid NOT NULL REFERENCES school_resources(id) ON DELETE CASCADE,
 editor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 version integer NOT NULL,
 previous_status text, status text NOT NULL,
 due_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(resource_id,version)
);
CREATE INDEX school_assignment_history_resource ON school_assignment_history(resource_id,created_at DESC);
ALTER TABLE school_quiz_attempts ADD COLUMN resource_version integer;
ALTER TABLE school_quiz_attempts ADD COLUMN breakdown jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(breakdown)='array');
CREATE INDEX school_quiz_attempts_history ON school_quiz_attempts(user_id,resource_id,created_at DESC);
CREATE TABLE school_reminder_deliveries (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 resource_id uuid NOT NULL REFERENCES school_resources(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('assignment-due','assignment-overdue','flashcards-due')),
 cycle_key text NOT NULL CHECK(length(cycle_key) <= 100),
 notification_id uuid REFERENCES notifications(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,resource_id,kind,cycle_key)
);
