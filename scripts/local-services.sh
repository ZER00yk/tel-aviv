#!/usr/bin/env bash
# Unprivileged Debian development services. Packages retain APT signatures/checksums.
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
service_dir="$repo_dir/.local/services"
binary_dir="$service_dir/bin-root"
pg_bin="$binary_dir/usr/lib/postgresql/17/bin"
export LD_LIBRARY_PATH="$binary_dir/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PGPASSWORD="${LOCAL_DATABASE_PASSWORD:-local-development-only}"
mkdir -p "$service_dir"
case "${1:-start}" in
  stop)
    if [ -f "$service_dir/pgdata/postmaster.pid" ]; then "$pg_bin/pg_ctl" -D "$service_dir/pgdata" stop -m fast; fi
    if [ -f "$service_dir/redis.pid" ]; then "$binary_dir/usr/bin/redis-cli" -h 127.0.0.1 shutdown; fi
    exit 0 ;;
  start) ;;
  *) echo 'Usage: scripts/local-services.sh [start|stop]' >&2; exit 2 ;;
esac
if [ ! -x "$pg_bin/postgres" ] || [ ! -x "$binary_dir/usr/bin/redis-server" ]; then
  command -v dpkg-deb >/dev/null || { echo 'Use docker compose up -d on non-Debian hosts.' >&2; exit 1; }
  mkdir -p "$service_dir/apt/lists/partial" "$service_dir/apt/archives/partial" "$binary_dir"
  cat > "$service_dir/apt/sources.list" <<'EOF'
deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian trixie main
deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian-security trixie-security main
EOF
  apt_args=(-o "Dir::Etc::sourcelist=$service_dir/apt/sources.list" -o Dir::Etc::sourceparts=- -o "Dir::State::lists=$service_dir/apt/lists" -o "Dir::Cache::archives=$service_dir/apt/archives")
  /usr/bin/apt-get "${apt_args[@]}" update
  (cd "$service_dir" && /usr/bin/apt-get "${apt_args[@]}" download postgresql-17 postgresql-client-17 redis-server redis-tools liblzf1)
  for archive in "$service_dir"/*.deb; do dpkg-deb -x "$archive" "$binary_dir"; done
fi
if [ ! -f "$service_dir/pgdata/PG_VERSION" ]; then
  "$pg_bin/initdb" -D "$service_dir/pgdata" -L "$binary_dir/usr/share/postgresql/17" --username=tellaviv --auth-local=trust --auth-host=scram-sha-256 --pwfile=<(printf '%s' "$PGPASSWORD") --locale=C.UTF-8
fi
if ! "$pg_bin/pg_isready" -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  "$pg_bin/pg_ctl" -D "$service_dir/pgdata" -l "$service_dir/postgres.log" -o '-h 127.0.0.1 -p 5432 -k /tmp' start
fi
if ! "$binary_dir/usr/bin/redis-cli" -h 127.0.0.1 ping >/dev/null 2>&1; then
  "$binary_dir/usr/bin/redis-server" --bind 127.0.0.1 --port 6379 --daemonize yes --dir "$service_dir" --pidfile "$service_dir/redis.pid" --logfile "$service_dir/redis.log"
fi
if ! "$pg_bin/psql" -h 127.0.0.1 -U tellaviv -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='tellaviv'" | rg -q '^1$'; then
  "$pg_bin/createdb" -h 127.0.0.1 -U tellaviv tellaviv
fi
"$pg_bin/psql" -h 127.0.0.1 -U tellaviv -d tellaviv -tAc 'SELECT 1'
"$binary_dir/usr/bin/redis-cli" -h 127.0.0.1 ping
echo 'PostgreSQL and Redis ready on loopback; see .env.example for application URLs.'
