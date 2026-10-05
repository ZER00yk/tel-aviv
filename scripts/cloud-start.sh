#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
mkdir -p .local/logs
exec 9>.local/logs/cloud-start.lock
flock -w 45 9 || { echo 'Another startup is still running; inspect .local/logs.' >&2; exit 1; }
if [ ! -f .env ]; then cp .env.example .env; chmod 600 .env; fi
bash scripts/local-services.sh start
pnpm db:migrate
task_process_running() {
  local saved_pid
  [ -f "$1" ] || return 1
  read -r saved_pid < "$1"
  [[ "$saved_pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$saved_pid" 2>/dev/null || return 1
  local process_state
  process_state="$(ps -p "$saved_pid" -o stat=)"
  [[ -n "$process_state" && "$process_state" != Z* ]]
}
if ! curl --max-time 3 -fsS http://localhost:3001/health >/dev/null && ! task_process_running .local/logs/realtime.pid; then
  nohup pnpm dev:realtime >.local/logs/realtime.log 2>&1 < /dev/null 9>&- &
  echo "$!" > .local/logs/realtime.pid
fi
if ! curl --max-time 3 -fsS http://localhost:3000/api/health >/dev/null && ! task_process_running .local/logs/web.pid; then
  nohup pnpm dev:web >.local/logs/web.log 2>&1 < /dev/null 9>&- &
  echo "$!" > .local/logs/web.pid
fi
for attempt in {1..45}; do
  if curl --max-time 2 -fsS http://localhost:3000/api/health >/dev/null 2>&1 && curl --max-time 2 -fsS http://localhost:3001/health >/dev/null 2>&1; then
    echo 'Tell Aviv web ready on :3000; realtime ready on :3001.'
    exit 0
  fi
  sleep 1
done
echo 'Startup did not become ready; inspect .local/logs or the active terminal logs.' >&2
exit 1
