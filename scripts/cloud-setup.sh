#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
command -v node >/dev/null
command -v pnpm >/dev/null
pnpm install --frozen-lockfile --store-dir "${TELL_AVIV_PNPM_STORE:-/workspace/.pnpm-store}"
if [ ! -f .env ]; then cp .env.example .env; chmod 600 .env; fi
bash scripts/local-services.sh start
pnpm db:migrate
echo 'Tell Aviv development dependencies and migrated services are ready.'
