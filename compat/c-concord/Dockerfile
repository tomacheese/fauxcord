# syntax=docker/dockerfile:1
#
# Concord (github.com/Cogmasters/concord) compatibility verifier.
#
# Concord's own upstream CI (.github/workflows/test_build.yml, confirmed via
# `gh api repos/Cogmasters/concord/contents/.github/workflows/test_build.yml`)
# does NOT use Debian/Ubuntu's packaged libcurl. It builds curl 8.7.1 from
# source with `--enable-websockets`, because Concord's README states:
# "Libcurl must be compiled with the --enable-websockets flag to work with
# Concord." System libcurl (e.g. Debian's libcurl4-openssl-dev) is not built
# with that flag, so linking against it risks missing symbols even though
# this verifier never touches the Gateway/WebSocket path. This Dockerfile
# mirrors the official CI recipe instead of relying on the distro package.
FROM debian:stable-slim AS build

# Build tools, so version pinning isn't meaningful here (same rationale as
# the root Dockerfile's `hadolint ignore=DL3018` for apk).
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

# Build libcurl 8.7.1 from source with WebSocket support enabled, exactly as
# Concord's own CI does, then install it to /usr/local (ldconfig refreshes
# the loader cache so `-lcurl` at link time picks up this build instead of
# any system copy).
WORKDIR /tmp/curl-build
RUN curl -LO https://curl.se/download/curl-8.7.1.tar.gz \
    && tar -xzf curl-8.7.1.tar.gz
WORKDIR /tmp/curl-build/curl-8.7.1
RUN ./configure --with-openssl --enable-websockets \
    && make -j"$(nproc)" \
    && make install \
    && ldconfig

# Build Concord itself from source (static lib) and install headers/lib to
# /usr/local, per README.md's "Installing Concord" section (`make && make
# install`, PREFIX defaults to /usr/local).
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

# Concord installs headers to $PREFIX/include/concord (see Makefile's
# `install:` target: DESTINCLUDE_DIR = $(PREFIX)/include/concord).
RUN gcc -O2 -Wall -I/usr/local/include/concord -o /verify verify.c \
    -ldiscord -lcurl -lpthread -lm

FROM debian:stable-slim
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Concord's shared runtime pieces (libcurl 8.7.1 built above, libdiscord.so
# if produced) live under /usr/local/lib; refresh the loader cache in the
# final image too since this is a separate filesystem layer from `build`.
COPY --from=build /usr/local/lib /usr/local/lib
COPY --from=build /verify /verify
COPY common /app/common
RUN ldconfig
WORKDIR /app
CMD ["/verify"]
