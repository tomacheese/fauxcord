# Discord Mock Server

A mock server that replicates the behavior of the Discord REST API v10.  
Run integration tests for Discord bots and applications without connecting to the real service.

## Features

- **Discord API v10 compatible** — Covers channels, Guilds, messages, Webhooks, and OAuth2
- **Stateful consistency** — Messages created via POST can be retrieved via GET
- **Test control API** — Set up and reset test environments via `/_test/*`
- **Rate Limit headers** — Discord-compatible headers attached to responses (dummy values)
- **Snowflake IDs** — Automatically generates Discord-compatible IDs
- **File attachments** — Supports file uploads via multipart/form-data

## Quick Start

### Docker Compose (recommended)

```bash
# Clone the repository
git clone https://github.com/tomacheese/fauxcord
cd fauxcord

# Start
docker compose up -d

# Verify
curl http://localhost:3000/_mock/health
```

### Running locally

**Requirements:** Node.js 22 or later (recommended: 24 LTS), pnpm

```bash
# Install dependencies
pnpm install

# Build and start the server
pnpm build
pnpm start

# Dev mode (auto-restarts on file changes)
pnpm dev
```

## Setting Up a Test Environment

After starting the server, first register a Bot token and Guild via `/_test/setup`.

```bash
curl -X POST http://localhost:3000/_test/setup \
  -H "Content-Type: application/json" \
  -d '{
    "token": "Bot mytoken123",
    "user": {
      "id": "1111111111111111111",
      "username": "TestBot"
    },
    "guilds": [
      {
        "id": "9876543210987654321",
        "name": "Test Guild",
        "channels": [
          { "id": "1234567890123456789", "name": "general", "type": 0 }
        ]
      }
    ]
  }'
```

**Example response:**

```json
{
  "token": "Bot mytoken123",
  "user": { "id": "1111111111111111111", "username": "TestBot" },
  "guilds": [
    {
      "id": "9876543210987654321",
      "name": "Test Guild",
      "channels": [
        { "id": "1234567890123456789", "name": "general", "type": 0 }
      ]
    }
  ]
}
```

## Common API Usage Examples

### Get a channel

```bash
curl http://localhost:3000/api/v10/channels/1234567890123456789 \
  -H "Authorization: Bot mytoken123"
```

### Send a message

```bash
curl -X POST http://localhost:3000/channels/1234567890123456789/messages \
  -H "Authorization: Bot mytoken123" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello, World!"}'
```

### Create and execute a Webhook

```bash
# Create Webhook
WEBHOOK=$(curl -s -X POST http://localhost:3000/channels/1234567890123456789/webhooks \
  -H "Authorization: Bot mytoken123" \
  -H "Content-Type: application/json" \
  -d '{"name": "MyWebhook"}')

WEBHOOK_ID=$(echo $WEBHOOK | jq -r '.id')
WEBHOOK_TOKEN=$(echo $WEBHOOK | jq -r '.token')

# Execute Webhook
curl -X POST "http://localhost:3000/webhooks/$WEBHOOK_ID/$WEBHOOK_TOKEN?wait=true" \
  -H "Content-Type: application/json" \
  -d '{"content": "Webhook message", "username": "CustomBot"}'
```

### Get Guild information

```bash
curl http://localhost:3000/guilds/9876543210987654321 \
  -H "Authorization: Bot mytoken123"
```

### Bulk delete messages

```bash
curl -X POST http://localhost:3000/channels/1234567890123456789/messages/bulk-delete \
  -H "Authorization: Bot mytoken123" \
  -H "Content-Type: application/json" \
  -d '{"messages": ["id1", "id2", "id3"]}'
```

## Test Control API

### Reset the test environment

```bash
# Reset only a specific Bot's data (Guild/channels are kept)
curl -X POST http://localhost:3000/_test/reset \
  -H "Content-Type: application/json" \
  -d '{"token": "Bot mytoken123"}'

# Full data reset
curl -X POST http://localhost:3000/_test/reset \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Delete the test environment

```bash
curl -X DELETE "http://localhost:3000/_test/setup/Bot%20mytoken123"
```

### Inspect channel messages (for testing)

```bash
curl http://localhost:3000/_test/messages/1234567890123456789
```

## Environment Variables

| Variable       | Default                 | Description                                             |
| -------------- | ----------------------- | ------------------------------------------------------- |
| `PORT`         | `3000`                  | Listen port                                             |
| `HOST`         | `0.0.0.0`               | Bind address                                            |
| `DB_PATH`      | `/data/mock.db`         | SQLite file path                                        |
| `UPLOAD_PATH`  | `/data/uploads`         | Directory for storing attachments                       |
| `BASE_URL`     | `http://localhost:3000` | Used for attachment URL generation and OAuth2 redirects |
| `LOG_LEVEL`    | `info`                  | Log level (`debug` / `info` / `warn` / `error`)         |
| `DISABLE_AUTH` | `false`                 | Set to `true` to accept any token                       |
| `LATENCY_MS`   | `0`                     | Artificial latency added to all responses (ms)          |
| `SEED_FILE`    | _(none)_                | Path to a JSON file loaded automatically at startup     |

### Using SEED_FILE

You can automatically register Bots, Guilds, and channels at startup.

```bash
# Specify via environment variable
SEED_FILE=/path/to/seed.json pnpm start
```

Create a seed file based on `seed.example.json`.

## Supported Path Formats

All of the following path formats work.

| Path format           | Behavior                     |
| --------------------- | ---------------------------- |
| `/api/v10/{endpoint}` | Handled as v10 (recommended) |
| `/api/{endpoint}`     | Handled as v10               |
| `/{endpoint}`         | Handled as v10               |

**Unsupported versions (v6–v9) return `400`.**

## Authentication

### Bot token authentication

```
Authorization: Bot <token>
```

Only tokens previously registered via `/_test/setup` are valid.

Setting `DISABLE_AUTH=true` allows any token.

### Endpoints that do not require authentication

- `POST /webhooks/{id}/{token}` (Webhook execution)
- `GET /_mock/health`
- `/_test/*`

## Running Tests

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage
```

## Directory Structure

```
src/
├── index.ts                # Entry point
├── config.ts               # Environment variable config
├── db.ts                   # SQLite initialization
├── snowflake.ts            # Snowflake ID generation
├── errors.ts               # Error code constants & helpers
├── test-helpers.ts         # Test helpers
├── integration.test.ts     # Integration tests
│
├── middleware/
│   ├── auth.ts             # Bot/Bearer token authentication
│   ├── cors.ts             # CORS configuration
│   ├── latency.ts          # Artificial latency
│   ├── rate-limit.ts       # Rate Limit headers
│   └── version.ts          # API version resolution
│
├── routes/
│   ├── channels.ts         # /channels/* endpoints
│   ├── guilds.ts           # /guilds/* endpoints
│   ├── mock.ts             # /_mock/* endpoints
│   ├── oauth2.ts           # /oauth2/* endpoints
│   ├── test.ts             # /_test/* endpoints
│   ├── users.ts            # /users/*, /applications/*
│   └── webhooks.ts         # /webhooks/* endpoints
│
├── services/
│   ├── attachments.ts      # File storage & delivery
│   ├── channels.ts         # Channel operations
│   ├── guilds.ts           # Guild operations
│   ├── messages.ts         # Message operations
│   ├── oauth2.ts           # OAuth2 flow
│   ├── test-control.ts     # Test control
│   ├── users.ts            # User operations
│   └── webhooks.ts         # Webhook operations
│
└── validators/
    ├── common.ts           # Common validation
    ├── guild.ts            # Guild validation
    ├── message.ts          # Message validation
    └── webhook.ts          # Webhook validation
```

## Tech Stack

| Item             | Technology                                                              |
| ---------------- | ----------------------------------------------------------------------- |
| Runtime          | Node.js 24 (LTS)                                                        |
| Framework        | [Hono](https://hono.dev/)                                               |
| DB               | SQLite + [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)   |
| Type definitions | [discord-api-types](https://github.com/discordjs/discord-api-types) v10 |
| Testing          | [Vitest](https://vitest.dev/)                                           |

## Error Codes

Returns error codes fully compatible with Discord API v10.

| Code    | Description                             |
| ------- | --------------------------------------- |
| `10003` | Unknown Channel                         |
| `10004` | Unknown Guild                           |
| `10007` | Unknown Member                          |
| `10008` | Unknown Message                         |
| `10013` | Unknown User                            |
| `10015` | Unknown Webhook                         |
| `30003` | Maximum number of pins reached (50)     |
| `30007` | Maximum number of webhooks reached (15) |
| `50006` | Cannot send an empty message            |
| `50035` | Invalid Form Body (validation error)    |
| `50041` | Invalid API version provided            |

See [Getting Started](./docs/getting-started.md) for details.

## License

MIT
