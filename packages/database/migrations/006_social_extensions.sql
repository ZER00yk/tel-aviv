-- Additive social hardening and private, room-authorized attachment bindings.
CREATE TABLE social_rate_windows (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bucket varchar(80) NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK(count > 0),
  PRIMARY KEY(user_id,bucket)
);
CREATE TABLE chat_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id),
  message_id uuid,
  storage_key uuid NOT NULL UNIQUE,
  filename varchar(255) NOT NULL,
  mime varchar(150) NOT NULL,
  bytes integer NOT NULL CHECK(bytes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(room_id,message_id) REFERENCES chat_messages(room_id,id) ON DELETE CASCADE
);
CREATE INDEX chat_message_attachments ON chat_attachments(message_id);
