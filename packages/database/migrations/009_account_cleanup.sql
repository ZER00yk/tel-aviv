-- File deletion survives object-provider outages and account cascade deletion.
CREATE TABLE storage_cleanup_jobs (
 storage_key uuid PRIMARY KEY,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 last_attempt_at timestamptz
);
