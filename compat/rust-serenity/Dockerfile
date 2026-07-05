# syntax=docker/dockerfile:1
# Build context is compat/ (see compose.yaml), so COPY paths are prefixed
# with the library directory and the shared common/ dir.
#
# Single-stage, debug build (matches the low-ceremony style of the other
# Mechanism-B verifiers). `--release` is intentionally NOT used: this host is
# I/O/network constrained, and for a throwaway verifier binary that runs once
# per CI invocation, a debug build meaningfully cuts compile time/IO versus a
# full optimized `--release` build, at no cost to what we're measuring (wire
# compatibility, not runtime speed).
FROM rust:1-slim
WORKDIR /app

# Minimal C toolchain for linking. `rustls_backend` (see Cargo.toml) avoids
# needing OpenSSL/pkg-config dev headers, but a linker (cc) is still required
# and is not guaranteed to be present in the "slim" base image variant. Build
# tools, so version pinning isn't meaningful here (same rationale as the root
# Dockerfile's `hadolint ignore=DL3018` for apk).
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libc6-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy the manifest first and pre-fetch/build dependencies as their own layer,
# so editing src/main.rs alone doesn't invalidate the (slow) dependency build.
COPY rust-serenity/Cargo.toml rust-serenity/Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs \
    && cargo fetch \
    && cargo build \
    && rm -rf src

COPY rust-serenity/src ./src
COPY common ./common

# Force a real rebuild of the actual verifier at image-build time. buildkit's
# COPY preserves the real source's mtime, which can predate the dummy
# deps-layer binary built above from `fn main() {}`; cargo's staleness check
# then considers the stub already up to date and `cargo run` silently executes
# the stale dummy binary (rc=0, no output, no results file). This was the
# confirmed root cause of the sibling rust-twilight verifier producing no
# result. Touching the source and building here guarantees the real binary is
# compiled before the runtime `cargo run`, and surfaces any compile error at
# build time.
RUN touch src/main.rs && cargo build --offline

CMD ["cargo", "run", "--offline"]
