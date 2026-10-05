CREATE TABLE storage_integrity_findings (
 storage_key uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('orphan-object','missing-object','size-mismatch')),
 expected_bytes bigint, actual_bytes bigint,
 first_detected_at timestamptz NOT NULL DEFAULT now(),
 last_detected_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 PRIMARY KEY(storage_key,kind)
);
CREATE INDEX storage_integrity_unresolved ON storage_integrity_findings(kind,last_detected_at) WHERE resolved_at IS NULL;
CREATE TABLE operation_state (
 name text PRIMARY KEY CHECK(length(name)<=100),
 data jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(data)='object'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
