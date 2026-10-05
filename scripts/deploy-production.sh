#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

deploy_env=.env.production
deploy_project=tell-aviv
deploy_release="$(date -u +%Y%m%dT%H%M%SZ)"
deploy_apply=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file) deploy_env="${2:?Supply an environment file}"; shift 2 ;;
    --project) deploy_project="${2:?Supply a Compose project}"; shift 2 ;;
    --release) deploy_release="${2:?Supply a release label}"; shift 2 ;;
    --apply) deploy_apply=true; shift ;;
    *) echo "Usage: scripts/deploy-production.sh [--env-file FILE] [--project NAME] [--release LABEL] [--apply]" >&2; exit 2 ;;
  esac
done
[[ "$deploy_project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'Invalid Compose project.' >&2; exit 2; }
[[ "$deploy_release" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$ ]] || { echo 'Invalid release label.' >&2; exit 2; }
[ -f "$deploy_env" ] || { echo 'Create a private production environment file first.' >&2; exit 2; }
export TELL_AVIV_IMAGE="tell-aviv:$deploy_release"
export TELL_AVIV_OPERATIONS_IMAGE="tell-aviv-operations:$deploy_release"
compose=(docker compose --env-file "$deploy_env" --project-name "$deploy_project" -f compose.production.yml)
"${compose[@]}" config --quiet

# Build and validate before replacing any running application service.
"${compose[@]}" build web operations
"${compose[@]}" run --rm --no-deps -T web node --import tsx scripts/production-preflight.ts
if [ "$deploy_apply" != true ]; then
  echo "Prepared release $deploy_release. Use --apply with this release label to deploy."
  exit 0
fi

receipt_dir=".local/deploy/$deploy_project/$deploy_release"
mkdir -p "$receipt_dir"
chmod 700 "$receipt_dir"
"${compose[@]}" images --format json > "$receipt_dir/previous-images.json"
"${compose[@]}" up -d --wait --wait-timeout 120 postgres redis
database_state="$("${compose[@]}" run --rm --no-deps -T web node --import tsx scripts/production-preflight.ts --database-state)"
if [ "$database_state" = existing ]; then
  # A verified snapshot must finish before applying additive migrations.
  "${compose[@]}" run --rm --no-deps -T operations node --import tsx scripts/backup.ts > "$receipt_dir/pre-migration-backup.log"
elif [ "$database_state" != fresh ]; then
  echo 'Unrecognized database state; deployment stopped before migration.' >&2
  exit 1
fi
"${compose[@]}" run --rm --no-deps -T web node --import tsx packages/database/src/migrate.ts
"${compose[@]}" up -d --wait --wait-timeout 180 web realtime
"${compose[@]}" up -d proxy
"${compose[@]}" run --rm --no-deps -T operations node --import tsx scripts/ops-worker.ts --once --dry-run > "$receipt_dir/maintenance-preview.log"
"${compose[@]}" up -d operations
"${compose[@]}" ps --format json > "$receipt_dir/services.json"
echo "Deployed release $deploy_release; receipts saved in $receipt_dir. Verify the public HTTPS origin and Socket.IO next."
