-- Thread records survive removal of an account's root message. Other authors'
-- replies remain in their original conversation rather than entering the room feed.
CREATE TABLE chat_threads (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  root_message_id uuid UNIQUE REFERENCES chat_messages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(room_id,id)
);
ALTER TABLE chat_messages ADD COLUMN thread_id uuid;
ALTER TABLE chat_messages ADD CONSTRAINT chat_message_thread_room
  FOREIGN KEY(room_id,thread_id) REFERENCES chat_threads(room_id,id) ON DELETE CASCADE;
CREATE INDEX chat_thread_history ON chat_messages(thread_id,created_at DESC,id DESC)
  WHERE thread_id IS NOT NULL;
