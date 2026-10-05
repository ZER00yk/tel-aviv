-- Anonymous native authentication cannot use user-FK rate windows. Store only
-- domain-separated hashes; each request is committed before credential work.
CREATE TABLE auth_request_windows (
  scope_hash char(64) NOT NULL CHECK (scope_hash ~ '^[0-9a-f]{64}$'),
  bucket varchar(80) NOT NULL CHECK (bucket ~ '^[a-zA-Z0-9:_-]{1,80}$'),
  window_start timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  count integer NOT NULL CHECK (count BETWEEN 1 AND 10000),
  PRIMARY KEY (scope_hash, bucket),
  CHECK (expires_at > window_start)
);
CREATE INDEX auth_request_windows_expiry ON auth_request_windows(expires_at);
