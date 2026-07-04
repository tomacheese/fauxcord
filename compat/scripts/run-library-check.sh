#!/usr/bin/env bash
# Drives one library's compatibility check end-to-end so the caller only has
# to read a short summary line instead of raw container logs.
#
# Usage: run-library-check.sh <library-name> [extra-timeout-seconds]
#   e.g. run-library-check.sh oceanic
#        run-library-check.sh discordgo 900
#
# Behavior:
#   1. docker compose build fauxcord verify-<lib>   (retried once on timeout)
#   2. docker compose up -d fauxcord                (waits for healthcheck)
#   3. docker compose run --rm verify-<lib>         (writes results/<lib>.json)
#   4. docker compose down -v                       (cleanup, always runs)
#   5. Prints one summary line + failing endpoints (if any) to stdout.
#
# This host's disk (/mnt/hdd) is I/O-saturated, so build/run steps use long
# timeouts (10min build, 5min run) with one retry on timeout (exit 124/143).
# Docker operations are NOT run in parallel across libraries — only one
# `run-library-check.sh` invocation should be active on the host at a time.
set -uo pipefail

LIB="${1:?usage: run-library-check.sh <library-name> [timeout-seconds]}"
EXTRA_TIMEOUT="${2:-}"
COMPAT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$COMPAT_DIR"

BUILD_TIMEOUT="${EXTRA_TIMEOUT:-900}"   # 15 min default (host is I/O-saturated)
RUN_TIMEOUT=600                          # 10 min for the verifier run itself
SERVICE="verify-${LIB}"
LOG_DIR="${COMPAT_DIR}/results/_logs"
mkdir -p "$LOG_DIR"
BUILD_LOG="${LOG_DIR}/${LIB}-build.log"
RUN_LOG="${LOG_DIR}/${LIB}-run.log"

log() { echo "[run-library-check:${LIB}] $*"; }

retry_with_timeout() {
  # retry_with_timeout <timeout-seconds> <log-file> -- <cmd...>
  local secs="$1" logfile="$2"
  shift 2
  [[ "$1" == "--" ]] && shift
  local attempt
  for attempt in 1 2; do
    log "attempt ${attempt}/2 (timeout ${secs}s): $*"
    if timeout "$secs" "$@" >"$logfile" 2>&1; then
      return 0
    fi
    local rc=$?
    if [[ $rc -eq 124 || $rc -eq 143 ]]; then
      log "attempt ${attempt} timed out after ${secs}s; tail of log:"
      tail -n 20 "$logfile"
      continue
    fi
    log "attempt ${attempt} failed with exit code ${rc}; tail of log:"
    tail -n 40 "$logfile"
    return "$rc"
  done
  log "both attempts timed out"
  return 124
}

cleanup() {
  docker compose -f docker-compose.yml down -v --remove-orphans >/dev/null 2>&1
}
trap cleanup EXIT

log "building fauxcord + ${SERVICE}"
if ! retry_with_timeout "$BUILD_TIMEOUT" "$BUILD_LOG" -- \
  docker compose -f docker-compose.yml build fauxcord "$SERVICE"; then
  echo "SUMMARY ${LIB}: BUILD_FAILED (see ${BUILD_LOG})"
  exit 1
fi

log "starting fauxcord (waiting for healthcheck)"
if ! retry_with_timeout 300 "${LOG_DIR}/${LIB}-up.log" -- \
  docker compose -f docker-compose.yml up -d --wait fauxcord; then
  echo "SUMMARY ${LIB}: FAUXCORD_START_FAILED (see ${LOG_DIR}/${LIB}-up.log)"
  exit 1
fi

log "running verifier"
if ! timeout "$RUN_TIMEOUT" docker compose -f docker-compose.yml run --rm "$SERVICE" \
  >"$RUN_LOG" 2>&1; then
  rc=$?
  log "verifier run failed/timed out (exit ${rc}); tail of log:"
  tail -n 40 "$RUN_LOG"
  echo "SUMMARY ${LIB}: RUN_FAILED (see ${RUN_LOG})"
  exit 1
fi

tail -n 5 "$RUN_LOG"

RESULT_JSON="${COMPAT_DIR}/results/${LIB}.json"
if [[ ! -f "$RESULT_JSON" ]]; then
  echo "SUMMARY ${LIB}: NO_RESULT_FILE (verifier ran but did not write ${RESULT_JSON})"
  exit 1
fi

node - "$RESULT_JSON" "$LIB" <<'NODE'
const fs = require('fs')
const [, , file, lib] = process.argv
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const counts = {}
const failing = []
for (const r of data.results) {
  counts[r.status] = (counts[r.status] ?? 0) + 1
  if (r.status === 'fauxcord-fix' || r.status === 'lib-issue') {
    failing.push(`  - [${r.status}] ${r.endpoint}: ${r.note}`)
  }
}
const countsStr = Object.entries(counts)
  .map(([k, v]) => `${k}=${v}`)
  .join(' ')
console.log(`SUMMARY ${lib}: ${data.results.length} endpoints, ${countsStr}`)
if (failing.length) {
  console.log('Endpoints needing triage (fauxcord-fix / lib-issue):')
  console.log(failing.join('\n'))
}
NODE
