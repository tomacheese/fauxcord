#!/usr/bin/env bash
# Exclusive-lock wrapper around run-library-check.sh, to structurally
# prevent the same library's Docker verification run from being launched
# twice concurrently.
#
# Background: a buildkit grpc crash during a serenity retry was traced to
# run-library-check.sh being started twice for the same library at almost
# the same time -- once via a manual trailing `&`, once via the Bash tool's
# run_in_background:true on a retry, without checking the first invocation's
# liveness first. The two `docker compose build` invocations fought over the
# same buildkit builder and crashed it. This script makes the double-launch
# structurally impossible instead of relying on an operating rule to catch
# it.
#
# How: takes an flock(1) exclusive lock keyed on the library name (not the
# Compose project name -- a project-suffix retry for the same library must
# still be serialized against a still-running earlier attempt, since both
# share the same host buildkit builder). Fails fast if the lock is already
# held. The lock is released automatically on exit (including crash/kill)
# because `exec` replaces this process's image while keeping open file
# descriptors, so the flock'd fd -- and thus the lock -- stays held through
# the build/run/cleanup steps inside run-library-check.sh.
#
# Usage: identical to run-library-check.sh --
#   compat/scripts/run-verify.sh <library-name> [extra-timeout-seconds] [project-suffix]
#
# Calling convention: invoke via the Bash tool with run_in_background:true
# ONLY. Never stack a manual trailing `&` on top -- that's exactly the
# double-launch pattern this script exists to prevent.
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
