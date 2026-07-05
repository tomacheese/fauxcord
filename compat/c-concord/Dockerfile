# syntax=docker/dockerfile:1
#
# Concord (github.com/Cogmasters/concord) compatibility verifier.
#
# Concord requires libcurl built with --enable-websockets (per its README);
# Debian's packaged libcurl lacks that flag, so this builds curl 8.7.1 from
# source instead, mirroring Concord's own upstream CI recipe.
FROM debian:stable-slim AS build

# Build tools; pinning isn't meaningful here (same rationale as the root
# Dockerfile's `hadolint ignore=DL3018` for apk).
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    autoconf \
    automake \
    libtool \
    pkg-config \
    libssl-dev \
    zlib1g-dev \
    git \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Build libcurl with WebSocket support (as Concord's CI does) and install to
# /usr/local; ldconfig refreshes the loader cache so `-lcurl` finds this build.
WORKDIR /tmp/curl-build
RUN curl -LO https://curl.se/download/curl-8.7.1.tar.gz \
    && tar -xzf curl-8.7.1.tar.gz
WORKDIR /tmp/curl-build/curl-8.7.1
RUN ./configure --with-openssl --enable-websockets \
    && make -j"$(nproc)" \
    && make install \
    && ldconfig

# Build Concord from source and install headers/lib to /usr/local, per
# README.md's "Installing Concord" section.
WORKDIR /tmp/concord
RUN git clone --depth 1 https://github.com/Cogmasters/concord . \
    && make all \
    && make install \
    && ldconfig

# Build context is compat/ (see compose.yaml), so COPY paths are
# prefixed with the library directory and the shared common/ dir.
WORKDIR /app
COPY c-concord/verify.c ./verify.c
COPY common ./common

# Concord installs headers to $PREFIX/include/concord (see Makefile's install target).
RUN gcc -O2 -Wall -I/usr/local/include/concord -o /verify verify.c \
    -ldiscord -lcurl -lpthread -lm

FROM debian:stable-slim
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Runtime libs (libcurl, libdiscord.so) live under /usr/local/lib; refresh the
# loader cache here too since this is a separate layer from `build`.
COPY --from=build /usr/local/lib /usr/local/lib
COPY --from=build /verify /verify
COPY common /app/common
RUN ldconfig
WORKDIR /app
CMD ["/verify"]
