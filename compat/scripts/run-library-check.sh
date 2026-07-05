#!/usr/bin/env bash
# Drives one library's compatibility check end-to-end so the caller only has
# to read a short summary line instead of raw container logs.
#
# Usage: run-library-check.sh <library-name> [extra-timeout-seconds] [project-suffix]
#   e.g. run-library-check.sh oceanic
#        run-library-check.sh discordgo 900
#        run-library-check.sh serenity 900 retry2   # project: fauxcord-compat-serenity-retry2
#
# project-suffix: escape hatch for when a previous invocation for the same
# library might still be alive (see compat/scripts/status-check.sh) but
# you're not fully certain -- forces a brand-new Compose project name so a
# leftover run can't collide. Omit for the normal case.
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
#
# Compose project isolation: each invocation uses its own project name
# (`-p fauxcord-compat-<lib>`) instead of the shared default. Otherwise two
# concurrent invocations for different libraries would resolve to the same
# project/container name for the shared `fauxcord` service, and one
# invocation's teardown would SIGTERM the other's still-in-use container out
# from under it -- confirmed as the root cause of a real cross-track failure
# (discordnet + discordgo run concurrently), not just host I/O contention.
set -uo pipefail

LIB="${1:?usage: run-library-check.sh <library-name> [timeout-seconds] [project-suffix]}"
EXTRA_TIMEOUT="${2:-}"
PROJECT_SUFFIX="${3:-}"
COMPAT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$COMPAT_DIR"

BUILD_TIMEOUT="${EXTRA_TIMEOUT:-900}"   # 15 min default (host is I/O-saturated)
RUN_TIMEOUT=600                          # 10 min for the verifier run itself
SERVICE="verify-${LIB}"
PROJECT="fauxcord-compat-${LIB}${PROJECT_SUFFIX:+-${PROJECT_SUFFIX}}"
COMPOSE=(docker compose -p "$PROJECT" -f compose.yaml)
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
  local attempt rc
  for attempt in 1 2; do
    log "attempt ${attempt}/2 (timeout ${secs}s): $*"
    # Capture rc immediately after the command, not via `if timeout ...;
    # then return 0; fi` followed by `rc=$?` -- an `if` with no executed
    # else-branch reports exit 0 for `$?` regardless of the command's real
    # exit code (POSIX). That previously made the timeout-retry branch below
    # dead code and always logged "exit code 0" on failure.
    timeout "$secs" "$@" >"$logfile" 2>&1
    rc=$?
    if [[ $rc -eq 0 ]]; then
      return 0
    fi
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
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1
}
trap cleanup EXIT

log "building fauxcord + ${SERVICE} (project: ${PROJECT})"
if ! retry_with_timeout "$BUILD_TIMEOUT" "$BUILD_LOG" -- \
  "${COMPOSE[@]}" build fauxcord "$SERVICE"; then
  echo "SUMMARY ${LIB}: BUILD_FAILED (see ${BUILD_LOG})"
  exit 1
fi

# `docker compose build` (bake mode, used automatically for multi-target
# builds) can report exit 0 overall even when one target actually failed to
# compile -- the "failed to solve" error lands in the log but doesn't affect
# the aggregate exit code. Trusting the exit code alone previously let a
# real serenity compile failure slip through silently, surfacing much later
# as an opaque RUN_FAILED/timeout. Verify each image was actually tagged.
for svc_image in "${PROJECT}-fauxcord" "${PROJECT}-${SERVICE}"; do
  if [[ -z "$(docker images -q "$svc_image" 2>/dev/null)" ]]; then
    log "image ${svc_image} was not produced despite build reporting success; tail of log:"
    tail -n 40 "$BUILD_LOG"
    echo "SUMMARY ${LIB}: BUILD_FAILED (see ${BUILD_LOG})"
    exit 1
  fi
done

log "starting fauxcord (waiting for healthcheck)"
if ! retry_with_timeout 300 "${LOG_DIR}/${LIB}-up.log" -- \
  "${COMPOSE[@]}" up -d --wait fauxcord; then
  echo "SUMMARY ${LIB}: FAUXCORD_START_FAILED (see ${LOG_DIR}/${LIB}-up.log)"
  exit 1
fi

log "running verifier"
# Capture the exit code directly from `timeout`, not via
# `if ! timeout ...; then rc=$?; ...` -- negating with `!` makes `$?`
# reflect the if's own (always-0) status, not timeout's real exit code.
# Same class of bug as the retry_with_timeout NOTE above.
timeout "$RUN_TIMEOUT" "${COMPOSE[@]}" run --rm "$SERVICE" \
  >"$RUN_LOG" 2>&1
rc=$?
if [[ $rc -ne 0 ]]; then
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
