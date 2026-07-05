#!/usr/bin/env bash
# Drives one library's compatibility check end-to-end so the caller only has
# to read a short summary line instead of raw container logs.
#
# Usage: run-library-check.sh <library-name> [extra-timeout-seconds] [project-suffix]
#   e.g. run-library-check.sh oceanic
#        run-library-check.sh discordgo 900
#        run-library-check.sh serenity 900 retry2   # project: fauxcord-compat-serenity-retry2
#
# project-suffix: opt-in escape hatch for when a previous invocation for the
# same library may still be alive (e.g. its log looked STALE but you are not
# fully certain -- see compat/scripts/status-check.sh). Appending a unique
# suffix guarantees a brand-new Compose project name, so a leftover live
# invocation cannot collide with the new one even if the "is it dead" check
# was wrong. Omit it for the normal case (no suspected leftover run).
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
# Compose project isolation: each invocation runs under its own Compose
# project name (`-p fauxcord-compat-<lib>`), NOT the shared default derived
# from the directory name. Without this, two concurrent invocations for
# different libraries resolve to the SAME project and therefore the SAME
# container name for the shared `fauxcord` service
# (`fauxcord-compat-fauxcord-1`) — one invocation's `down`/cleanup then
# SIGTERMs the *other* invocation's still-in-use fauxcord container out from
# under it. This was confirmed as the root cause of a real cross-track
# failure (discordnet + discordgo run concurrently, one's teardown killed
# the other's fauxcord container), not just host I/O contention. Per-library
# project names mean each invocation gets its own independent fauxcord
# container, so concurrent runs are actually isolated rather than merely
# hoped to be serialized.
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
    # NOTE: rc must be captured on the line directly after the command runs,
    # NOT via `if timeout ...; then return 0; fi` followed by `rc=$?`. When
    # the tested command fails, bash's `if`-without-`else` construct reports
    # its OWN exit status as 0 (POSIX: "if no commands in a branch are
    # executed, the if-list's exit status is 0") -- so `$?` right after such
    # an `if/fi` is always 0, never the real failure code. This silently
    # broke both the 124/143 timeout-retry branch below (dead code -- rc was
    # never anything but 0) and the "attempt N failed" message (always
    # printed "exit code 0" regardless of the actual failure). Confirmed via
    # a real serenity build that hit this exact path; only the separate
    # downstream image-existence check caught the resulting failure.
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

# `docker compose build` (bake mode, used automatically when building
# multiple targets in one invocation) has been observed to report exit 0
# for the *overall* command even when one of the targets actually failed to
# compile -- the per-target "failed to solve" error is printed into the
# build log, but does not affect the aggregate exit code. Trusting the exit
# code alone previously let a real serenity `cargo build` compile failure
# slip through here silently, only to surface much later (and far more
# expensively, since it forced an implicit rebuild inside the shorter,
# fixed-length run-step timeout) as an opaque `RUN_FAILED`/timeout. Verify
# each image was actually tagged before trusting the build "succeeded".
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
# NOTE: exit code must be captured directly from `timeout`, NOT via
# `if ! timeout ...; then rc=$?; ...`. Negating with `!` makes `$?` inside
# the then-branch reflect the (always-0) exit status of the negated `if`
# condition itself, not the real exit code of `timeout` — this previously
# caused every failure here to be misreported as "exit 0", hiding the real
# cause (same class of bug the retry_with_timeout comment above warns about
# for `local rc=$?`, confirmed via a real serenity run that logged
# "failed/timed out (exit 0)" for what was actually a dependency-not-ready
# failure).
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
