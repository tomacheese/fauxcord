# syntax=docker/dockerfile:1

# ===== Stage 1: builder =====
# 依存パッケージのインストールを行うステージ
FROM node:24-alpine AS builder

# better-sqlite3 のネイティブビルドに必要なツール（ビルドツールはバージョン固定不要）
# hadolint ignore=DL3018
RUN apk add --no-cache python3 make g++

WORKDIR /app

# pnpm をバージョン固定でインストール（lockfile と互換性を保つため）
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate

# 依存パッケージのインストール（ビルドスクリプト許可済み）
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# ソースコードをコピー（tsx でソースを直接実行するためコンパイルは行わない）
COPY tsconfig.json ./
COPY src ./src

# ===== Stage 2: prod-deps =====
# devDependencies を削除し、本番用依存のみに削減するステージ
# （better-sqlite3 のビルド済みバイナリと tsx は dependencies のため保持される）
FROM builder AS prod-deps
RUN pnpm prune --prod

# ===== Stage 3: runner =====
# 実行専用の軽量ステージ（ビルドツール・devDependencies を含まない）
FROM node:24-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

# 非 root ユーザーを作成（セキュリティのため root で実行しない）
RUN addgroup -S -g 1001 nodejs && adduser -S discord-mock -u 1001 -G nodejs

# データディレクトリを作成し、非 root ユーザーが書き込めるよう権限を付与
RUN mkdir -p /data/uploads && chown -R discord-mock:nodejs /data

# 本番用依存・ソースコード・tsconfig をコピー
COPY --from=prod-deps --chown=discord-mock:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=discord-mock:nodejs /app/src ./src
COPY --from=builder --chown=discord-mock:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=discord-mock:nodejs /app/package.json ./package.json

USER 1001:1001

EXPOSE 3000

# ヘルスチェック（DB 初期化などで起動に時間がかかるため start-period は長めに設定）
# 注意: localhost は busybox wget では ::1 (IPv6) に解決され、IPv4 のみで待ち受ける
# サーバーに接続できないため、127.0.0.1 を明示する
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD ["wget", "-qO-", "http://127.0.0.1:3000/_mock/health"]

# tsx で TypeScript ソースを直接実行する（org デファクトスタンダードに準拠）
CMD ["node_modules/.bin/tsx", "src/index.ts"]
