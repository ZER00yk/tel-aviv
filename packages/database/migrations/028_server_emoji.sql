CREATE TABLE server_emojis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  name varchar(32) NOT NULL CHECK(name ~ '^[a-z0-9_]{2,32}$'),
  mime varchar(32) NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/gif','image/webp')),
  bytes integer NOT NULL CHECK(bytes>0 AND bytes<=262144),
  data bytea NOT NULL CHECK(octet_length(data)=bytes),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(server_id,name)
);
CREATE INDEX server_emoji_owner_quota ON server_emojis(owner_id);
