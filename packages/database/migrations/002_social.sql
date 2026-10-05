-- Social relations are directional where private preferences need separate ownership.
CREATE TABLE friendships (
  user_low uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_low,user_high), CHECK (user_low < user_high)
);
CREATE TABLE friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sender_id,recipient_id), CHECK (sender_id <> recipient_id)
);
CREATE TABLE user_blocks (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,blocked_id), CHECK(user_id <> blocked_id)
);
CREATE TABLE friend_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  favorite boolean NOT NULL DEFAULT false,
  close_friend boolean NOT NULL DEFAULT false,
  muted boolean NOT NULL DEFAULT false,
  nickname varchar(80) NOT NULL DEFAULT '',
  note varchar(2000) NOT NULL DEFAULT '',
  PRIMARY KEY(user_id,friend_id), CHECK(user_id <> friend_id)
);
CREATE TABLE servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  name varchar(80) NOT NULL,
  description varchar(1000) NOT NULL DEFAULT '',
  icon text, banner text,
  discoverable boolean NOT NULL DEFAULT false,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE server_members (
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(server_id,user_id)
);
CREATE TABLE server_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  color varchar(7) NOT NULL DEFAULT '#7c6cff',
  position integer NOT NULL DEFAULT 0 CHECK(position >= 0),
  permissions text[] NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false,
  UNIQUE(server_id,name), UNIQUE(server_id,id)
);
CREATE UNIQUE INDEX server_default_role ON server_roles(server_id) WHERE is_default;
CREATE TABLE server_member_roles (
  server_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  PRIMARY KEY(server_id,user_id,role_id),
  FOREIGN KEY(server_id,user_id) REFERENCES server_members(server_id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(server_id,role_id) REFERENCES server_roles(server_id,id) ON DELETE CASCADE
);
CREATE TABLE server_invites (
  code varchar(32) PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz,
  max_uses integer CHECK(max_uses > 0),
  uses integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_id uuid NOT NULL REFERENCES users(id),
  game_id varchar(80),
  launched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE party_members (
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  ready boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(party_id,user_id)
);
CREATE TABLE party_invites (
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 day',
  PRIMARY KEY(party_id,user_id)
);
CREATE TABLE chat_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(12) NOT NULL CHECK(kind IN ('global','dm','group','channel','party')),
  name varchar(100) NOT NULL DEFAULT '',
  server_id uuid REFERENCES servers(id) ON DELETE CASCADE,
  party_id uuid UNIQUE REFERENCES parties(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES users(id),
  channel_type varchar(20) NOT NULL DEFAULT 'text' CHECK(channel_type IN ('text','announcement')),
  restricted_role_id uuid,
  position integer NOT NULL DEFAULT 0,
  dm_key varchar(80) UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(server_id,restricted_role_id) REFERENCES server_roles(server_id,id),
  CHECK((kind='channel')=(server_id IS NOT NULL)),
  CHECK((kind='party')=(party_id IS NOT NULL)),
  CHECK((kind='dm')=(dm_key IS NOT NULL))
);
CREATE UNIQUE INDEX one_global_chat ON chat_rooms(kind) WHERE kind='global';
INSERT INTO chat_rooms(kind,name) VALUES('global','Global Chat');
CREATE TABLE chat_members (
  room_id uuid NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(room_id,user_id)
);
CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  content varchar(4000) NOT NULL,
  reply_to uuid REFERENCES chat_messages(id) ON DELETE SET NULL,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(room_id,id)
);
CREATE INDEX chat_history ON chat_messages(room_id,created_at DESC,id DESC);
CREATE INDEX chat_author ON chat_messages(author_id,created_at DESC);
CREATE INDEX chat_search ON chat_messages USING gin(to_tsvector('simple',content));
CREATE TABLE chat_reactions (
  message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji varchar(40) NOT NULL,
  PRIMARY KEY(message_id,user_id,emoji)
);
CREATE TABLE chat_pins (
  message_id uuid PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,
  pinned_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE chat_read_cursors (
  room_id uuid NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id uuid,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(room_id,user_id),
  FOREIGN KEY(room_id,message_id) REFERENCES chat_messages(room_id,id) ON DELETE SET NULL (message_id)
);
CREATE TABLE chat_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL UNIQUE REFERENCES chat_messages(id) ON DELETE CASCADE,
  question varchar(300) NOT NULL,
  multiple boolean NOT NULL DEFAULT false,
  closes_at timestamptz
);
CREATE TABLE chat_poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES chat_polls(id) ON DELETE CASCADE,
  label varchar(200) NOT NULL,
  position integer NOT NULL,
  UNIQUE(poll_id,id), UNIQUE(poll_id,position)
);
CREATE TABLE chat_poll_votes (
  poll_id uuid NOT NULL REFERENCES chat_polls(id) ON DELETE CASCADE,
  option_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(poll_id,option_id,user_id),
  FOREIGN KEY(poll_id,option_id) REFERENCES chat_poll_options(poll_id,id) ON DELETE CASCADE
);
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  kind varchar(60) NOT NULL,
  title varchar(200) NOT NULL,
  link varchar(500) NOT NULL DEFAULT '',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_inbox ON notifications(user_id,created_at DESC);
CREATE TABLE social_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(60) NOT NULL,
  title varchar(200) NOT NULL,
  link varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX social_feed ON social_activity(created_at DESC);
