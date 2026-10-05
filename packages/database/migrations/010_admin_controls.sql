-- Additive, account-specific storage budgets and immutable administrative evidence.
CREATE TABLE user_storage_quotas (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  quota_bytes bigint NOT NULL CHECK (quota_bytes BETWEEN 1048576 AND 107374182400),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Actor/target IDs deliberately have no cascading FK: deleting an account must
-- not erase the record of a privileged balance or storage change.
CREATE TABLE admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  actor_username varchar(24) NOT NULL,
  target_id uuid,
  target_username varchar(24),
  action varchar(80) NOT NULL,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_recent ON admin_audit_log(created_at DESC);
CREATE INDEX admin_audit_target ON admin_audit_log(target_id,created_at DESC);

CREATE FUNCTION prevent_admin_audit_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Administrator audit records are append-only';
END;
$$;
CREATE TRIGGER admin_audit_append_only
  BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_admin_audit_changes();
