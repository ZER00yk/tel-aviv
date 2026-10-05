# Tell Aviv deployment receipt — goals 5

The application is running in the `tell-aviv-live-20261004` Docker Compose project at **https://localhost:3843**. This endpoint is bound to loopback and uses Caddy's local certificate authority. It is accessible from this cloud workspace; it is not a public website.

The final image was verified on **2026-10-04 at 22:41 UTC** without restarting services or changing application data. The read-only receipt passed **32 of 32 checks**. A separate deployed Chromium test passed **23 checks** at 21:49 UTC and removed its temporary accounts and upload fixtures.

## Immutable application release

| Property               | Verified value                                                                |
| ---------------------- | ----------------------------------------------------------------------------- |
| Image tag              | `tell-aviv:release-20261004-goals5`                                           |
| Image ID               | `sha256:1f582529976885e7da1fa612f49782529349a96d4275076ae4f4ed940c68d8a6`     |
| Build ID               | `8V28kbGjIWBOMckS-yFdP`                                                       |
| Source digest          | `1f31736d13b78b87805f0374ae847e92d21deee40128378616122ac983d8f32e`            |
| Compiled build digest  | `b85816297a82ebe53c4c62aa44f9b53ed65dc4ef448e6b24c0f36127a36379a7`            |
| Dependency lock digest | `7a48b2b1c203c0695c123e695726fc9494e01e5b9ca32ce17b5bce36a412fdd5`            |
| Manifest verification  | 490 source files and 181 compiled files; all 671 deployed file hashes matched |

Both the web and realtime containers use this image. The source and compiled digests are recomputed from the release manifest, matched against the image labels, and checked against the actual files in the running web container. These digests identify the frozen application release prepared at 17:22 UTC. Later verification scripts and handoff documents are recorded separately.

## Running services and security checks

Web, realtime, PostgreSQL, and Redis report healthy. Caddy is running and its HTTPS endpoint responds successfully. All five containers have `unless-stopped` restart policies and zero restarts in the final receipt. PostgreSQL and Redis ports are private to Docker, as are the direct web and realtime ports. Caddy publishes HTTP on `127.0.0.1:3808` and HTTPS on `127.0.0.1:3843`.

The HTTP receipt validates the Caddy certificate using its local CA, with TLS 1.3. Production CSP includes fresh request nonces and `strict-dynamic`, all returned script tags have the matching nonce, and `unsafe-eval` is absent. HSTS, framing denial, and MIME sniffing prevention are present.

Production runs with native authentication and development login disabled. Argon2id uses 65,536 KiB memory, three passes, and one lane. The trusted proxy proof and metrics token are configured and distinct. The unauthenticated `/api/metrics` endpoint returns **401** with `private, no-store`; authorized private web and realtime scrapes return **200** with the Prometheus content type. The receipt stores only configuration booleans and bounded operational settings, never passwords or tokens.

The deployed Chromium test covers native registration, logout and login, Secure private session cookies, development login returning 404, Creator saves, private file ownership checks, authenticated WebSocket connection, foreign WebSocket origin denial, the Ego canvas, and native security settings. It reports no browser execution errors or CSP violations and no account cleanup failures.

A complete ranked Ego browser run on this deployment defeated all 40 rooms and eight bosses in **2,639.208 wall-clock seconds (43.99 minutes)** and 2,625.161 authoritative server seconds. It reported no browser execution errors. Its temporary native account was deleted through the application API before the final maintenance checks.

## Persistent data and maintenance

The final database inspection found **115 tables**, **99 accounts**, and **36 migrations** after the pacing test's account cleanup. Every applied migration checksum matches the repository migration file. The five original application containers retain their original image IDs and start times.

Persisted production backup status records a fresh verified snapshot at **22:35:59 UTC**, containing a **371,774-byte database dump and five uploads**. The earlier snapshot at 17:10:02 UTC contained a 382,338-byte dump and five uploads. Its isolated restore drill at **17:10:34 UTC** verified 115 tables, 99 accounts, 36 migrations, and all five restored upload checksums. That restore result is retained in production status; the new snapshot did not receive a second isolated restore drill.

The operations scheduler is **not running**. Its configured schedule enables a backup every 24 hours, 14-day retention, at least seven retained backups, and a maintenance pass every 60 seconds. The tested operations image is `sha256:cf223c8599fcddcf0e4e03195f4da3648f5a826a6569812fac236bb53fde0fcc`, built at 17:01 UTC. It predates the final application image and is recorded as a separate artifact.

A fresh once-only Docker dry run at **22:34:54 UTC** passed with zero failures. It checked 99 accounts, five objects, and five metadata records; missing objects, orphan objects, size mismatches, cleanup retries, expired trash, and expired marketplace offers were all zero. The subsequent scheduler startup completed **one applied pass with zero failures**, created the fresh verified backup, and recorded its successful state. It was stopped before a second scheduled pass because of the actual disk allocation described below. This verifies one applied pass; it does not establish continuous or daily scheduling.

Docker uses the VFS storage driver. Although the operations image's logical size is about 1.59 GB, its actual container allocation exhausted the **3.22 GB** available when startup began. Only the newly created scheduler container was stopped and removed, restoring about **3.22 GB free**. Every original application container, named volume, image, source file, compiled release file, dependency, backup, and release manifest was preserved.

Before maintenance testing, the completed host production build's 718 MiB generated cache was removed. It is excluded from the release manifest and unused by the immutable containers. All 671 deployed files matched their hashes again after cache cleanup and after the scheduler attempt.

A read-only streaming image inspection found about 382 MB of build cache inside the existing operations image, 632 MB of dependencies, 127 MB of Node, and 438 MB of PostgreSQL/base files. Creating a trimmed image while preserving the tested image would add another full VFS image snapshot, followed by a separate container snapshot. This consumes more total space than starting the existing operations image. No new image was created. Remaining inactive Docker build cache and the release context total only about 28 MB.

A lighter host-worker fallback was also assessed. Host TCP can reach this project's private PostgreSQL and Redis bridge addresses. However, the actual production uploads and backups live under `/var/lib/docker/volumes`, outside the writable workspace, and are neither readable nor writable by the task user. The fallback therefore cannot access the actual production upload/backup bytes. No host launcher was created and no worker was pointed at development data.

Continuous scheduled maintenance requires more than the observed container allocation plus an operational reserve, a deployment host with a more efficient Docker storage driver, or a supported host worker with access to the actual production volumes. The current 3.22 GB reserve is insufficient for another scheduler allocation.

The existing deployment can be inspected without changing services:

```bash
docker compose --project-name tell-aviv-live-20261004 \
  --env-file .local/deploy/live-20261004.env -f compose.production.yml ps
node .local/verification/deployment-receipt-goals5.mjs
```

After sufficient capacity or a more efficient Docker storage driver has been provided, these commands use the already tested operations image. They must remain deferred with the current 3.22 GB reserve because both allocate a VFS container snapshot:

```bash
maintenance=(docker compose --project-name tell-aviv-live-20261004 \
  --env-file .local/deploy/live-20261004.env -f compose.production.yml)
TELL_AVIV_OPERATIONS_IMAGE=tell-aviv-operations:deployment-20261004 \
  "${maintenance[@]}" run --rm --no-deps -T operations \
  node --import tsx scripts/ops-worker.ts --once --dry-run
TELL_AVIV_OPERATIONS_IMAGE=tell-aviv-operations:deployment-20261004 \
  "${maintenance[@]}" up -d --no-deps operations
```

Review the dry-run result before starting the scheduler. Neither command rebuilds or restarts web, realtime, PostgreSQL, or Redis; named data volumes are retained.

## Public deployment constraint

The user authorized the choice of hosting provider. The available cloud network policy denies the public ingress providers that were tested, and no accessible hosting account or public forwarding capability is available in this workspace. The current Docker deployment therefore has no public URL. Public hosting still requires an accessible deployment target or permitted ingress configuration.

## Evidence

- `.local/verification/deployment-receipt-goals5.json`: final image, services, TLS, configuration, metrics, migration, and maintenance receipt.
- `.local/verification/deployment-receipt-goals5.mjs`: repeatable read-only receipt collector; validates TLS with the local Caddy CA.
- `.local/verification/deployment-receipt-goals5-pre-cache-20261004T215826.json`: preserved receipt before host build-cache cleanup.
- `.local/verification/operations-image-size-goals5.json`: streamed operations-image size assessment; no container allocated.
- `.local/verification/operations-dryrun-goals5.json`: clean post-pacing once-only Docker maintenance check.
- `.local/verification/operations-scheduled-goals5.json`: one applied pass, new backup, and scheduler capacity/recovery evidence.
- `.local/verification/operations-host-fallback-goals5.json`: private bridge connectivity and unsupported volume access assessment.
- `.local/verification/deployed-browser-check-5.json`: 23 deployed HTTP, browser, WebSocket, and fixture cleanup checks.
- `.local/verification/ego-browser-playtest-goals5.json`: complete deployed ranked campaign and browser measurements.
- `.local/deploy/release-context-5980229c-203f-4805-936d-0e0b6835259c/manifest.json`: frozen source and compiled file hashes.
- `.local/verification/public-ingress-goals4.json`: public ingress access probes and policy denials.

The private deployment environment file is intentionally excluded from this document and from source archives.
