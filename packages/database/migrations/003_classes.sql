CREATE TABLE IF NOT EXISTS school_classes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL, color text NOT NULL DEFAULT '#6c70ff', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS school_resources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_id uuid NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, parent_id uuid REFERENCES school_resources(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('folder','note','assignment','flashcards','quiz','link','file')),
 title text NOT NULL, data jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1,
 deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS school_resources_class_idx ON school_resources(class_id, parent_id);
CREATE INDEX IF NOT EXISTS school_resources_owner_idx ON school_resources(owner_id, deleted_at);
CREATE TABLE IF NOT EXISTS school_shares (
 resource_id uuid NOT NULL REFERENCES school_resources(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 permission text NOT NULL CHECK (permission IN ('view','edit')), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(resource_id,user_id)
);
CREATE TABLE IF NOT EXISTS school_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resource_id uuid NOT NULL REFERENCES school_resources(id) ON DELETE CASCADE,
 editor_id uuid NOT NULL REFERENCES users(id), version integer NOT NULL, title text NOT NULL, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(resource_id,version)
);
CREATE TABLE IF NOT EXISTS school_quiz_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resource_id uuid NOT NULL REFERENCES school_resources(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, score integer NOT NULL, total integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS creations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title text NOT NULL, description text NOT NULL DEFAULT '', tags jsonb NOT NULL DEFAULT '[]', level jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1, published boolean NOT NULL DEFAULT false, plays integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS creation_versions (
 creation_id uuid NOT NULL REFERENCES creations(id) ON DELETE CASCADE, version integer NOT NULL,
 level jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(creation_id,version)
);
CREATE TABLE IF NOT EXISTS creation_likes (
 creation_id uuid NOT NULL REFERENCES creations(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(creation_id,user_id)
);
CREATE TABLE IF NOT EXISTS creation_favorites (
 creation_id uuid NOT NULL REFERENCES creations(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(creation_id,user_id)
);
CREATE TABLE IF NOT EXISTS creation_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creation_id uuid NOT NULL REFERENCES creations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, body text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
