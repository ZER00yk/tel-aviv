# Local reliability and observability evidence

This pass adds a durable metrics sink, private Prometheus text exporters, an owned-fixture load harness, and actual operating-system worker failover tests. It does not establish production capacity, deploy monitoring, or prove arbitrary multi-region operation.

## Worker ownership and recovery

`WorkerFence` preserves the single-owner rule for each realtime namespace. A five-second Redis lease elects the worker. A successful takeover advances an immutable PostgreSQL generation row. Every domain write transaction takes a shared lock on that row and checks both the generation and current Redis owner. Takeover takes the conflicting SQL lock, so it cannot overtake an in-flight guarded commit. Redis publication checks the exact lease token and applies the cache commands in one Lua operation. A resumed old process can neither commit a new generation's match changes nor publish over its cache.

Migration `037_operational_metrics.sql` supplies the generation table and bounded metrics snapshots. It is additive and applied; earlier migrations are preserved. Rejected startup releases its connections and exits instead of leaving an idle SQL pool keeping the process alive.

The opt-in `apps/realtime/src/multiprocess.integration.test.ts` uses real separate Node processes on ports 3501/3502 with a random namespace. It starts a Connect Four match, rejects a competing live owner, suspends the owner using `SIGSTOP`, recovers the same match under the next generation, resumes the former owner and rejects its stale action, kills the replacement using `SIGKILL`, and recovers the committed board under a third generation. It compares SQL and Redis state, reconnects both participants, and verifies an unfinished match has no completion receipt. It also tests authorization and actual HTTP exposition on the realtime `/metrics` endpoint.

Only those spawned processes and that fixture namespace are stopped or cleaned. There is no service-wide Redis reset. The ownership test plus the existing server/queue/recovery integration suites passed **15/15** tests. The ownership scenario took 20.736 seconds in that run; a later successful rerun with exporter HTTP assertions took 17.254 seconds.

These tests validate single-owner failover with the local PostgreSQL and Redis services. They do not introduce several simultaneous owners of one namespace, remove ownership locks, simulate a database partition, or prove correctness under every possible infrastructure failure.

## Private export and durable retention

`GET /api/metrics` exports the web and retained realtime snapshots. Realtime workers also expose `GET /metrics` for their current process. Both require a separate bearer token set through `METRICS_SCRAPE_TOKEN` with 32–256 characters; an absent or short configuration disables access. The production Compose recipe accepts this optional secret and keeps the service ports private. The endpoints use `Cache-Control: no-store` and Prometheus text format version 0.0.4.

Web requests persist snapshots at most once per ten seconds while receiving traffic. Realtime workers persist every ten seconds and on graceful close. A stable random instance ID is shared within each process, including web development module reloads. SQL keeps a final process snapshot for 48 hours, with bounded expired-row pruning within its namespace. This retains process-lifetime counters for recently active instances: it is **not** an exact 48-hour event counter. A crash can lose the most recent ten seconds of unsaved metric increments. Active socket/user gauges only include snapshots at most 30 seconds old.

The exporter provides fixed-label HTTP requests, rejected/server errors, cumulative latency buckets and duration sums; socket requests/errors by operation family; connections, disconnections and lobby recovery counts; active sockets/users; waiting/matching tickets; active checkpointed matches; failed matchmaking attempts; worker error fingerprints; database/Redis health; application-role connection counts and server connection capacity; Redis memory; process memory; cleanup backlog/retrying jobs; and rejected upload/economy work. Upload/economy buckets count errors after request parsing for chat/Classes upload operations and collectible/marketplace/loan operations; they include intentional invalid requests. Failed matchmaking is a retained SQL ticket count, not a general count of every failed game outcome. Lobby recoveries identify reconnects into existing matches; reconnects without a retained lobby are included in connection counts.

Labels are a finite whitelist. Arbitrary method/path IDs, account names, private content, error messages, SQL queries, sessions, passwords, provider keys and poker state are omitted. JSON is sanitized before persistence and revalidated before rendering, including manually inserted or older snapshot rows. API and realtime request/tick error logs use fixed error fingerprint buckets plus a validated five-character SQLSTATE and correlation ID, never arbitrary `Error.name` or query text. Database connection counts describe the shared application database role, not exact per-process pool occupancy or wait duration.

The metrics suites passed **10/10** tests with database and Redis configured: authorization, bounded labels/fingerprints, independent snapshots, latency aggregation, expired owned-row pruning, idempotent instance upserts, unrelated namespace preservation, SQL retention, private data removal and actual exporter response headers. No external scraper, dashboard, alert destination or long-term monitoring backend was deployed.

## Reusable mixed load

Run the migrated local app and PostgreSQL/Redis services, then:

```bash
pnpm load:local
LOAD_USERS=4 LOAD_ROUNDS=8 pnpm load:local
```

`LOAD_BASE_URL` defaults to `http://localhost:3000` and permits local hosts only. User count is bounded to 2, 4 or 6 and rounds to 1–20. The harness runs an isolated realtime worker on port 3501 and a generated Redis/SQL namespace, so that port must be available. It preserves ordinary authentication and action limits. No synthetic bypass increases application quotas.

The harness registers native accounts with generated in-memory passwords, logs out and logs in, performs authenticated reads, private chat messages, Classes and Creator versioned saves, presence and room subscriptions, party invitations/recovery, queue joins/cancellations, Connect Four, poker, Ego Trip input, and a real owned collectible listing/purchase. A generated collectible edition avoids consuming or changing existing collectible supply. It gathers per-operation p50/p95, unexpected errors, expected rejection counts, elapsed throughput, its own CPU/RSS, owned-worker CPU ticks/RSS, shared application-role DB connections and Redis memory. JSON reports in `.local/` include no response bodies, credentials or child logs.

Each run deletes only its verified generated account UUID/username pairs, their domain data, owned edition, random namespace and owned lobby outcomes. It preserves the shared anonymous authentication budget; only its own identity-hash windows are deleted. Cleanup is verified and failed runs return a nonzero exit code.

Two actual local runs passed with zero unexpected errors and verified account cleanup:

| Fixture           | Operations | Elapsed including setup/cleanup | Overall operations/s |
| ----------------- | ---------: | ------------------------------: | -------------------: |
| 2 users, 4 rounds |        128 |                         8.183 s |                15.64 |
| 4 users, 8 rounds |        383 |                        10.351 s |                37.00 |

Selected timings from the four-user run:

| Operation                                         | Samples |   p50 |      p95 |
| ------------------------------------------------- | ------: | ----: | -------: |
| Native login                                      |       4 | 92 ms |    99 ms |
| Authenticated profile read                        |      32 | 33 ms |    89 ms |
| Classes save                                      |      32 | 84 ms |   548 ms |
| Creator save                                      |      32 | 50 ms | 1,063 ms |
| Socket game action, including expected rejections |      16 |  4 ms |    14 ms |

The owned realtime worker used 220,196,864 RSS bytes and 80 additional CPU clock ticks over the measurement. Shared application-role connections reached the sampled value 26, with one active connection; Redis used 1,423,976 bytes. These are a small development-server diagnostic run in a shared workspace with concurrent source changes, not a sustained saturation benchmark. The autosave tail is a reason to measure a production build under controlled workload next; these measurements do not isolate its cause or establish a production service limit.

Reports: `.local/mixed-load-2026-10-04T02-41-01.392Z.json` and `.local/mixed-load-2026-10-04T02-41-50.571Z.json`. A final 128-operation rerun after narrowing match cleanup to exact owned match UUIDs also passed with zero unexpected errors and verified account cleanup (`.local/mixed-load-2026-10-04T02-49-36.115Z.json`). UTC filenames identify artifacts; the local user date for these runs is October 3, 2026.

## Degraded message delivery coverage

The real socket scenarios delay a duplicate board command, deliver out-of-turn commands, disconnect/reconnect a participant, compare the recovered board and match ID, reject repeated terminal poker actions with one persisted match receipt, and reject a repeated Ego Trip input sequence. Expected rejections are counted separately from unexpected errors. The operating-system ownership test adds process suspension, crash, stale-owner resumption and participant reconnect.

This is application-message delay/reordering and disconnect coverage. It does not claim kernel-level latency/jitter/packet loss shaping, physical mobile-network testing, browser-tab suspension, full Night Shift degradation coverage or an exhaustive long-duration poker/Ego campaign stress run. Those remain further validation work.
