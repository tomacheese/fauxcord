# syntax=docker/dockerfile:1
# Build context is compat/ (see docker-compose.yml), so COPY paths are prefixed
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

# Minimal C toolchain for linking. twilight-http's default backend (hyper +
# rustls, like serenity's rustls_backend) avoids needing OpenSSL/pkg-config
# dev headers, but a linker (cc) is still required and is not guaranteed to
# be present in the "slim" base image variant.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libc6-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy the manifest first and pre-fetch/build dependencies as their own layer,
# so editing src/main.rs alone doesn't invalidate the (slow) dependency build.
COPY rust-twilight/Cargo.toml ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo fetch
RUN cargo build
RUN rm -rf src

COPY rust-twilight/src ./src
COPY common ./common

CMD ["cargo", "run", "--offline"]
