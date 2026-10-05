ALTER TABLE chat_threads ADD COLUMN name varchar(100) NOT NULL DEFAULT '';
ALTER TABLE chat_threads ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE chat_threads ADD COLUMN archived_at timestamptz;
ALTER TABLE chat_threads ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE chat_threads t SET created_by=root.author_id FROM chat_messages root WHERE root.id=t.root_message_id;
UPDATE chat_threads t SET updated_at=COALESCE((SELECT max(created_at) FROM chat_messages m WHERE m.thread_id=t.id),t.created_at);
CREATE INDEX chat_thread_discovery ON chat_threads(room_id,archived_at,updated_at DESC,id DESC);
CREATE TABLE chat_thread_members (
  thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following boolean NOT NULL DEFAULT true,
  read_at timestamptz NOT NULL DEFAULT 'epoch',
  read_message_id uuid REFERENCES chat_messages(id) ON DELETE SET NULL,
  PRIMARY KEY(thread_id,user_id)
);
INSERT INTO chat_thread_members(thread_id,user_id)
SELECT DISTINCT thread_id,author_id FROM chat_messages WHERE thread_id IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO chat_thread_members(thread_id,user_id)
SELECT id,created_by FROM chat_threads WHERE created_by IS NOT NULL ON CONFLICT DO NOTHING;
ALTER TABLE chat_rooms ADD COLUMN icon text;
ALTER TABLE chat_rooms ADD CONSTRAINT chat_group_icon CHECK(icon IS NULL OR (kind='group' AND length(icon)<=2048 AND icon LIKE 'https://%'));
