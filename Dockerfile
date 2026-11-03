# syntax=docker/dockerfile:1

# ===== Stage 1: builder =====
# Stage that installs dependencies
FROM node:26-alpine AS builder

# Tools required for the native better-sqlite3 build (build tools need no version pin)
# hadolint ignore=DL3018
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install a pinned pnpm to stay compatible with the lockfile (installed via npm because Node 25+ no longer bundles corepack)
RUN npm install -g pnpm@11.2.2

# Install dependencies (build scripts are allow-listed)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# Copy the sources (no compile step: tsx runs the TypeScript directly)
COPY tsconfig.json ./
COPY src ./src

# ===== Stage 2: prod-deps =====
# Stage that prunes devDependencies, leaving production dependencies only
# (the built better-sqlite3 binary and tsx are dependencies, so they are kept)
FROM builder AS prod-deps
RUN pnpm prune --prod

# ===== Stage 3: runner =====
# Lightweight runtime stage (no build tools or devDependencies)
FROM node:26-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

# Create a non-root user so the server does not run as root
RUN addgroup -S -g 1001 nodejs && adduser -S discord-mock -u 1001 -G nodejs

# Create the data directory and make it writable by the non-root user
RUN mkdir -p /data/uploads && chown -R discord-mock:nodejs /data

# Copy production dependencies, sources, and tsconfig
COPY --from=prod-deps --chown=discord-mock:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=discord-mock:nodejs /app/src ./src
COPY --from=builder --chown=discord-mock:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=discord-mock:nodejs /app/package.json ./package.json

USER 1001:1001

EXPOSE 3000

# Healthcheck (start-period is generous because DB initialization slows startup)
# Note: busybox wget resolves localhost to ::1 (IPv6), which cannot reach a
# server listening on IPv4 only, so 127.0.0.1 is explicit
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD ["wget", "-qO-", "http://127.0.0.1:3000/_mock/health"]

# Run the TypeScript sources directly with tsx
CMD ["node_modules/.bin/tsx", "src/index.ts"]
