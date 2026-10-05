-- Each successful namespace takeover advances the durable fencing generation.
CREATE TABLE realtime_worker_epochs (
 namespace text PRIMARY KEY CHECK(length(namespace) BETWEEN 1 AND 100),
 generation bigint NOT NULL CHECK(generation>0),
 owner_token uuid NOT NULL,
 acquired_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Fixed-label process snapshots survive restarts for a bounded 48 hour window.
CREATE TABLE operational_metric_snapshots (
 namespace text NOT NULL CHECK(length(namespace) BETWEEN 1 AND 100),
 service text NOT NULL CHECK(service IN ('web','realtime')),
 instance_id uuid NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(namespace,service,instance_id),
 CHECK(octet_length(snapshot::text)<=262144)
);
CREATE INDEX operational_metric_snapshots_expiry ON operational_metric_snapshots(expires_at);
