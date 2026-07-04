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
# NOTE: mtime alone is not sufficient. A log whose last write happened just
# before its process died (e.g. a buildkit container start failure) still
# looks freshly-updated -- confirmed via a real case where serenity retry7
# had fully stopped, but the last line written (the failure itself) was
# recent enough to report "ALIVE 595s ago". Two extra checks close this
# gap without changing the existing "STATUS (Ns ago): filename" line format
# that callers already parse:
#   1. cross-check the mtime-based ALIVE verdict against whether a matching
#      buildx/docker-compose process is actually still running
#   2. scan the log's tail for failure patterns regardless of mtime/STATUS,
#      since a fatal error can be the very last (and therefore "freshest")
#      line in the file
LOG_DIR="$REPO_ROOT/compat/results/_logs"
if [ -d "$LOG_DIR" ]; then
  for f in "$LOG_DIR"/*.log; do
    [ -e "$f" ] || continue
    BASENAME="$(basename "$f")"
    LIB="${BASENAME%%-*}"
    MTIME=$(stat -c %Y "$f")
    AGE=$((NOW - MTIME))
    if [ "$AGE" -le "$STALE_THRESHOLD" ]; then
      STATUS="ALIVE"
      if ! ps aux | grep -E "buildx|docker compose|docker-compose" | grep -v grep |
        grep -qi "$LIB"; then
        STATUS="ALIVE (mtime only, no matching process -- DEAD?)"
      fi
    else
      STATUS="STALE"
    fi
    echo "$STATUS (${AGE}s ago): $BASENAME"

    FAIL_LINE=$(tail -n 20 "$f" | grep -iE "error|exit code [1-9]|failed" | tail -n 1 || true)
    if [ -n "$FAIL_LINE" ]; then
      echo "  FAILED_TAIL: ${BASENAME}: ${FAIL_LINE}"
    fi
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
