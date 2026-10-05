-- Canonical snapshots are server-only. Public/player views are reconstructed on recovery.
CREATE TABLE multiplayer_checkpoints (
  namespace varchar(100) NOT NULL DEFAULT 'tell-aviv',
  lobby_code varchar(8) NOT NULL,
  match_id uuid NOT NULL,
  snapshot_version integer NOT NULL DEFAULT 1 CHECK(snapshot_version=1),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(namespace,lobby_code),
  CHECK(octet_length(snapshot::text)<=1048576)
);
CREATE TABLE multiplayer_checkpoint_members (
  namespace varchar(100) NOT NULL,
  lobby_code varchar(8) NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(namespace,lobby_code,user_id),
  FOREIGN KEY(namespace,lobby_code) REFERENCES multiplayer_checkpoints(namespace,lobby_code) ON DELETE CASCADE
);
CREATE INDEX multiplayer_checkpoint_user ON multiplayer_checkpoint_members(user_id,namespace);
CREATE INDEX multiplayer_checkpoint_expiry ON multiplayer_checkpoints(expires_at);
-- Account erasure invalidates its old complete snapshot, including hidden roles.
CREATE FUNCTION invalidate_deleted_player_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) THEN
    DELETE FROM multiplayer_checkpoints WHERE namespace=OLD.namespace AND lobby_code=OLD.lobby_code;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER multiplayer_checkpoint_member_erased AFTER DELETE ON multiplayer_checkpoint_members
  FOR EACH ROW EXECUTE FUNCTION invalidate_deleted_player_checkpoint();
