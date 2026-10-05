# Deployment

Use one VPS, Docker Compose and Caddy. Configure DOMAIN, a unique URL-safe POSTGRES_PASSWORD, a random AUTH_TRUSTED_PROXY_SECRET of at least 32 characters, optional verified-email provider configuration, and persistent volume backups securely. `compose.production.yml` keeps database/Redis internal and proxies web + Socket.IO through normal HTTPS 443 with polling fallback. Production login uses native Tell Aviv username/password accounts; development impersonation is always disabled.

Create a private, ignored `.env.production` containing `DOMAIN`, a URL-safe random `POSTGRES_PASSWORD`, `AUTH_TRUSTED_PROXY_SECRET` and any optional provider/metrics settings. Keep the Compose project name constant across upgrades: changing it selects different database, Redis and upload volumes.

```sh
bash scripts/deploy-production.sh --env-file .env.production --project tell-aviv --release RELEASE
bash scripts/deploy-production.sh --env-file .env.production --project tell-aviv --release RELEASE --apply
```

The first command builds immutable release tags for the app and PostgreSQL-client operations image and checks production settings without starting or replacing services. The apply command waits for PostgreSQL/Redis, creates a verified pre-migration snapshot when an existing schema is present, applies checksum-guarded additive migrations, waits for web/realtime health, starts the proxy and previews maintenance before starting its scheduler. Receipts and previous image IDs remain in `.local/deploy/PROJECT/RELEASE`. These commands never remove volumes, clear Redis or run account-owner bootstrap.

Web, realtime, database and Redis have readiness checks; database/Redis remain internal to the Compose network. `HTTP_BIND`, `HTTPS_BIND`, `HTTP_PORT` and `HTTPS_PORT` optionally choose proxy bindings, while normal VPS defaults expose ports 80/443. Use loopback bindings when another trusted ingress terminates public TLS.

Email/S3 credentials must be injected through your secret manager or ignored deployment environment files. Do not bake them into images. Set a URL-encoded password in DATABASE_URL if it contains reserved URI characters. TLS certificates are handled by Caddy for the configured domain; DNS/ports must already reach the VPS. All official games run as native modules, without iframe or native install requirements.

Use [backup/restore instructions](BACKUP_RESTORE.md) and verify restoration before treating backups as operational. Public DNS/TLS, provider email/S3 and sustained traffic require checks on the chosen target. Accountless public tunnels are temporary workspace ingress with no availability guarantee; they do not establish a durable VPS or managed production service.

## Upgrade failures and rollback

If the build, configuration check or backup fails, application services have not been replaced. If migration or service readiness fails, stop and inspect the private deployment receipt and the affected service rather than rerunning with empty volumes. Existing migrations are additive and immutable. To roll back application containers, set `TELL_AVIV_IMAGE` and `TELL_AVIV_OPERATIONS_IMAGE` to the previously recorded image IDs/tags, then use the same project and environment file with `docker compose ... up -d --no-build web realtime operations`. Keep database/upload volumes intact. Application rollback does not undo migrations; confirm compatibility with the previous app before restarting it. A database restore always uses a separate empty target and is never automatic.

## A new deployment restored from a development snapshot

Restore only into a new, empty deployment database and upload volume; verify all dump/upload hashes and migration checksums before exposing ingress. Existing usernames, native Argon2 hashes, account UUIDs, ownership and private resources are preserved. Development/legacy sessions and old recovery tokens must not authorize the new host. Before web/realtime or public ingress starts, run the isolated-copy tool with `NODE_ENV=production`, `DEV_AUTH=false`, `DATABASE_URL` pointing only to the new copy, and `DEPLOY_ISOLATED_COPY=true`:

```sh
node --import tsx scripts/production-clone-auth.ts --confirm-new-deployment-copy
```

It invalidates copied sessions, password-reset links, email-verification links and recovery codes in one transaction, retaining passwords and application data. Users sign in with their native password and can generate new recovery codes. This is a new-copy step, not an ordinary production upgrade command.

## Builds through a controlled network proxy

The Dockerfile accepts an optional BuildKit secret `build_ca` for a proxy trust certificate during dependency downloads. Standard Docker proxy build arguments and `NODE_USE_ENV_PROXY=1` allow Node 24/Corepack to use the configured HTTPS proxy; the certificate is mounted only for the two dependency steps and is never copied into image layers. On hosts whose proxy name is resolved solely by `/etc/hosts`, provide the same approved mapping with Docker's `--add-host`. Keep registry signature verification and the frozen lockfile enabled. Ordinary Internet-connected VPS builds do not need these options.

The current cloud Docker daemon uses the VFS driver, which copies complete filesystems for image layers and exhausted its 32 GiB filesystem during repeated builds. Only task-owned build cache and a diagnostic image were reclaimed; source, application images, database/upload volumes and backups were preserved. On this host, a final release can reuse the verified dependency image and a completed host production build through `scripts/prepare-release-context.ts`. Set `RELEASE_BASE_IMAGE` and `RELEASE_BASE_CONTAINER` to the matching running base, then run the script after source is stable. It checks the frozen lockfile, copies only allowed source and completed `.next` files (excluding build cache, private environment/key files, dependencies and workspace data), verifies every copied file hash, and writes a one-COPY Dockerfile plus source/build manifests under `.local/deploy`. Build that returned context with a fresh release tag, verify its labels and replace services using the same persistent volumes. Keep enough free space for VFS container replacement; do not run several builds or maintenance containers simultaneously on this filesystem.

Development cloud runtime can use signed Debian package services via `scripts/local-services.sh`; those extracted binaries rely on Debian trixie compatible host libraries. Other hosts should use standard Docker or system services. Services and web/realtime processes must restart after environment snapshot restoration; data and installed dependencies persist, processes do not.

Native registrations remain ordinary accounts. Establish the first owner with the host-only, preview-first [owner bootstrap tool](BOOTSTRAP_OWNER.md) after verifying the native account UUID. Existing owners cannot be replaced through bootstrap.
