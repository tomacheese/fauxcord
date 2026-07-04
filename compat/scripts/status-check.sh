#!/usr/bin/env bash
# Aggregated, deterministic status snapshot for Issue #68 multi-agent coordination.
#
# Purpose: replace ad-hoc, manually-reasoned "is it alive / is it stuck" checks
# (running several separate commands and eyeballing timestamps) with a single
# script that always emits the same structured output. Intended for use by
# team-lead's periodic check-in loop and by each verification agent when
# deciding whether to retry a run.
#
# Usage: compat/scripts/status-check.sh [stale-seconds]
#   stale-seconds: threshold (default 180) above which a log file with no
#                  update is reported as STALE instead of ALIVE.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STALE_THRESHOLD="${1:-180}"
NOW=$(date +%s)

echo "=== host ==="
uptime

echo
echo "=== git ==="
git -C "$REPO_ROOT" status --porcelain
echo "HEAD: $(git -C "$REPO_ROOT" log -1 --oneline)"

echo
echo "=== compat/results ==="
ls -la "$REPO_ROOT/compat/results/"*.json 2>/dev/null || echo "(no result files)"

echo
echo "=== build/run logs liveness (threshold: ${STALE_THRESHOLD}s) ==="
LOG_DIR="$REPO_ROOT/compat/results/_logs"
if [ -d "$LOG_DIR" ]; then
  for f in "$LOG_DIR"/*.log; do
    [ -e "$f" ] || continue
    MTIME=$(stat -c %Y "$f")
    AGE=$((NOW - MTIME))
    if [ "$AGE" -le "$STALE_THRESHOLD" ]; then
      STATUS="ALIVE"
    else
      STATUS="STALE"
    fi
    echo "$STATUS (${AGE}s ago): $(basename "$f")"
  done
else
  echo "(no log dir yet: $LOG_DIR)"
fi

echo
echo "=== docker processes ==="
ps aux | grep -E "buildx|docker compose|docker-compose" | grep -v grep || echo "(none running)"

echo
echo "=== docker containers (compat-related) ==="
docker ps -a --format "{{.Names}}\t{{.Status}}" | grep -iE "verify|fauxcord-compat" || echo "(none)"
