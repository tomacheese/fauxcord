# syntax=docker/dockerfile:1
# Build context is compat/ (see compose.yaml), so COPY paths are prefixed
# with the library directory and the shared common/ dir.
#
# Debug build (no `--release`): this is a throwaway verifier run once per CI
# invocation, and we're checking wire compatibility, not runtime speed.
FROM rust:1-slim
WORKDIR /app

# Minimal C toolchain for linking: rustls_backend avoids needing OpenSSL/
# pkg-config dev headers, but a linker (cc) isn't guaranteed in "slim".
# Build tools; pinning isn't meaningful here (see root Dockerfile's DL3018 ignore).
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

# Touch + rebuild to force a real recompile: COPY preserves the source mtime,
# which can predate the dummy binary above, causing `cargo run` to silently
# execute the stale stub instead (root cause of a past silent-failure bug).
RUN touch src/main.rs && cargo build --offline

CMD ["cargo", "run", "--offline"]
