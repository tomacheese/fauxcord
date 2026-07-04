#!/usr/bin/env bash
# Exclusive-lock wrapper around run-library-check.sh, to structurally
# prevent the same library's Docker verification run from being launched
# twice concurrently.
#
# Background: a buildkit grpc crash (`frontend grpc server closed
# unexpectedly`) during a serenity retry was traced to run-library-check.sh
# being started twice for the same library at almost the same time -- once
# via a manual trailing `&` for backgrounding, and again via the Bash tool's
# run_in_background:true on a retry a moment later, because the first
# invocation's liveness wasn't checked before the second was issued. The two
# `docker compose build` invocations then fought over the same buildkit
# builder instance and crashed it. That failure mode was previously only
# guarded against by an operating rule ("check status-check.sh before
# retrying"); this script makes the double-launch itself impossible instead
# of relying on every caller remembering the rule.
#
# How: takes an flock(1) exclusive lock keyed on the library name (not the
# Compose project name -- a project-suffix retry for the same library must
# still be serialized against a still-running earlier attempt, since both
# share the same host buildkit builder). If the lock is already held, this
# script fails fast with a clear message instead of blocking forever or
# silently proceeding to double-launch. The lock is held for the entire
# lifetime of the wrapped run-library-check.sh process (released
# automatically on exit, including on crash/kill), because `exec` replaces
# this process's image while keeping its open file descriptors -- so the
# flock'd fd stays open, and therefore the lock stays held, all the way
# through the build/run/cleanup steps inside run-library-check.sh.
#
# Usage: identical to run-library-check.sh --
#   compat/scripts/run-verify.sh <library-name> [extra-timeout-seconds] [project-suffix]
#
# Calling convention (read this before invoking):
#   Call this script via the Bash tool with run_in_background:true ONLY.
#   Never append a trailing `&` on top of that -- run_in_background:true
#   already backgrounds the whole command at the harness level. Stacking a
#   manual `&` underneath it is exactly the pattern that caused the original
#   double-launch, since it lets the foregrounded shell return immediately
#   while a second, unsupervised invocation can be issued before anyone
#   checks whether the first one is still alive.
set -uo pipefail

LIB="${1:?usage: run-verify.sh <library-name> [timeout-seconds] [project-suffix]}"
COMPAT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_DIR="${COMPAT_DIR}/results/_locks"
mkdir -p "$LOCK_DIR"
LOCK_FILE="${LOCK_DIR}/${LIB}.lock"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "SUMMARY ${LIB}: ALREADY_RUNNING (lock held: ${LOCK_FILE})." >&2
  echo "Another run-verify.sh/run-library-check.sh invocation for '${LIB}' is" \
    "still in progress. Check compat/scripts/status-check.sh before retrying" \
    "-- do not start a second one." >&2
  exit 1
fi

# Record who's holding the lock, for anyone inspecting the lock file while
# a run is in progress (status-check.sh or manual `cat`).
{
  echo "pid=$$"
  echo "started=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "args=$*"
} >&9

exec "${COMPAT_DIR}/scripts/run-library-check.sh" "$@"
