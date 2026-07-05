# syntax=docker/dockerfile:1
# Build context is compat/ (see compose.yaml), so COPY paths are prefixed
# with the library directory and the shared common/ dir.
FROM node:24-alpine
WORKDIR /app
COPY js-discordjs/package.json ./
RUN npm install --no-audit --no-fund
COPY js-discordjs/verify.mjs ./
COPY common ./common
CMD ["node", "verify.mjs"]
