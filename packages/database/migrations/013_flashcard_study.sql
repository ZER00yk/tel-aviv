-- Private, server-owned learner progress. Shared decks never share learner history.
CREATE TABLE flashcard_progress (
 resource_id uuid NOT NULL REFERENCES school_resources(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 card_key text NOT NULL CHECK(card_key ~ '^[0-9a-f]{64}$'),
 due_at timestamptz NOT NULL DEFAULT now(),
 interval_seconds integer NOT NULL DEFAULT 0 CHECK(interval_seconds BETWEEN 0 AND 31536000),
 streak integer NOT NULL DEFAULT 0 CHECK(streak >= 0),
 review_count integer NOT NULL DEFAULT 0 CHECK(review_count >= 0),
 review_version integer NOT NULL DEFAULT 0 CHECK(review_version >= 0),
 review_nonce uuid,
 nonce_expires_at timestamptz,
 last_review_at timestamptz,
 PRIMARY KEY(resource_id,user_id,card_key)
);
CREATE INDEX flashcard_progress_due_idx ON flashcard_progress(user_id,resource_id,due_at);
