# Getting Started

## What is Fauxcord?

A mock server for Discord REST API v10.  
It lets you automate testing of bots and apps without connecting to the real Discord.

**What it can do:**

- Send, fetch, edit, and delete messages
- Reactions, pins, Webhooks
- Guild / channel / member / role operations
- OAuth2 flows (Authorization Code / Client Credentials)
- File attachments
- Gateway (WebSocket): Identify / Heartbeat / Resume, and Dispatch events for
  messages, reactions, guilds, channels, members, and roles

**What it cannot do:**

- Voice / video
- Sharding, ETF/zlib compression, privileged intents

---

## 1. Start the server

### Docker (recommended)

```bash
docker run -p 3000:3000 ghcr.io/tomacheese/fauxcord:latest
```

To persist data:

```bash
docker run -p 3000:3000 -v fauxcord-data:/data ghcr.io/tomacheese/fauxcord:latest
```

### Docker Compose

```bash
# Download compose.yaml and start
curl -O https://raw.githubusercontent.com/tomacheese/fauxcord/master/compose.yaml
docker compose up -d
```

### Local (Node.js + pnpm; see `.node-version` for the exact version)

```bash
git clone https://github.com/tomacheese/fauxcord
cd fauxcord
pnpm install
pnpm dev     # Dev mode (auto-restarts on file changes)
```

Verify it's running:

```bash
curl http://localhost:3000/_mock/health
# → {"status":"ok","version":"1.0.0","db":"ok","uptime":1}
```

---

## 2. Set up a Bot

Fauxcord keeps track of which Bot tokens are valid.  
Before running your tests, register a token and Guild via `/_test/setup`.

```bash
curl -X POST http://localhost:3000/_test/setup \
  -H "Content-Type: application/json" \
  -d '{
    "token": "Bot mytoken",
    "user": {
      "id": "111111111111111111",
      "username": "MyTestBot"
    },
    "guilds": [
      {
        "id": "222222222222222222",
        "name": "My Test Server",
        "channels": [
          { "id": "333333333333333333", "name": "general", "type": 0 },
          { "id": "444444444444444444", "name": "logs",    "type": 0 }
        ]
      }
    ]
  }'
```

> All `id` fields are optional. When omitted, a Discord-compatible Snowflake ID is generated automatically.

---

## 3. Call the API

Once set up, you can make requests using the same URL format as the real Discord API.

### Send a message

```bash
curl -X POST http://localhost:3000/api/v10/channels/333333333333333333/messages \
  -H "Authorization: Bot mytoken" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello, Fauxcord!"}'
```

```json
{
  "id": "1513052391153471489",
  "content": "Hello, Fauxcord!",
  "author": { "id": "111111111111111111", "username": "MyTestBot", "bot": true },
  "timestamp": "2026-06-07T10:00:00.000Z",
  ...
}
```

### List messages

```bash
curl http://localhost:3000/api/v10/channels/333333333333333333/messages \
  -H "Authorization: Bot mytoken"
```

### Create and execute a Webhook

```bash
# Create
WH=$(curl -s -X POST http://localhost:3000/api/v10/channels/333333333333333333/webhooks \
  -H "Authorization: Bot mytoken" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Webhook"}')

WH_ID=$(echo $WH | jq -r '.id')
WH_TOKEN=$(echo $WH | jq -r '.token')

# Execute
curl -X POST "http://localhost:3000/webhooks/$WH_ID/$WH_TOKEN?wait=true" \
  -H "Content-Type: application/json" \
  -d '{"content": "Webhook message!"}'
```

---

## 4. URL formats

All of the following formats are accepted.

| URL format              | Behavior                       |
| ----------------------- | ------------------------------ |
| `/api/v10/channels/...` | Recommended (Discord standard) |
| `/api/channels/...`     | Handled as v10                 |
| `/channels/...`         | Handled as v10                 |

> Anything other than v10, such as `/api/v9/`, returns `400 (50041)`.

---

## 5. Reset test data

You can reset data before and after each test case.

```bash
# Delete all messages and Webhooks (Bot / Guild / Channel are kept)
curl -X POST http://localhost:3000/_test/reset \
  -H "Content-Type: application/json" \
  -d '{}'

# Reset only a specific Bot's data
curl -X POST http://localhost:3000/_test/reset \
  -H "Content-Type: application/json" \
  -d '{"token": "Bot mytoken"}'
```

For full details on the test control API → [test-api.md](./test-api.md)

---

## 6. Seed data automatically at startup (SEED_FILE)

Instead of calling `/_test/setup` every time, you can load data automatically at startup.

```bash
SEED_FILE=/path/to/seed.json pnpm start
```

See `seed.example.json` for the format of `seed.json`.

---

## 7. Disable authentication (DISABLE_AUTH)

If you want to allow access with any token:

```bash
DISABLE_AUTH=true pnpm start
```

> Tokens that have been set up continue to work with their registered user information.  
> Unregistered tokens are treated as a dummy Bot (`MockBot`).

---

## 8. Connect to the Gateway (WebSocket)

Connecting to the URL returned by `/gateway/bot` (`ws://localhost:3000`) lets you receive Dispatch events (such as `MESSAGE_CREATE`) after completing the HELLO → IDENTIFY → READY handshake.

```javascript
import WebSocket from 'ws'

const ws = new WebSocket('ws://localhost:3000')
ws.on('message', (raw) => {
  const payload = JSON.parse(raw.toString())
  if (payload.op === 10) {
    // HELLO -> IDENTIFY
    ws.send(
      JSON.stringify({
        op: 2,
        d: { token: 'Bot mytoken', intents: 513 },
      })
    )
  }
  console.log(payload)
})
```

---

## 9. Slash commands and interactions

Register a global command, then simulate a user invoking it via the
`/_test/interactions` endpoint (no real Discord client required):

```bash
# Register a global command
curl -X POST http://localhost:3000/api/v10/applications/111111111111111111/commands \
  -H "Authorization: Bot mytoken" \
  -H "Content-Type: application/json" \
  -d '{"name": "ping", "description": "Replies with pong"}'

# Simulate a user running /ping
curl -X POST http://localhost:3000/_test/interactions \
  -H "Content-Type: application/json" \
  -d '{
    "application_id": "111111111111111111",
    "command_name": "ping",
    "guild_id": "222222222222222222",
    "channel_id": "333333333333333333"
  }'
```

Your bot receives an `INTERACTION_CREATE` Gateway event for the simulated
interaction and responds via the callback endpoint:

```bash
curl -X POST "http://localhost:3000/interactions/<interaction_id>/<interaction_token>/callback" \
  -H "Content-Type: application/json" \
  -d '{"type": 4, "data": {"content": "pong"}}'
```

Followup messages reuse the Webhook API, treating the application ID as the
webhook ID and the interaction token as the webhook token:

```bash
curl -X POST "http://localhost:3000/webhooks/111111111111111111/<interaction_token>" \
  -H "Content-Type: application/json" \
  -d '{"content": "a followup message"}'
```

See [test-api.md](./test-api.md) for the full `/_test/interactions` request
shape.

---

## Environment variables

| Variable       | Default                 | Description                                         |
| -------------- | ----------------------- | --------------------------------------------------- |
| `PORT`         | `3000`                  | Port number                                         |
| `HOST`         | `0.0.0.0`               | Bind address                                        |
| `DB_PATH`      | `/data/mock.db`         | SQLite file path                                    |
| `UPLOAD_PATH`  | `/data/uploads`         | Attachment storage directory                        |
| `BASE_URL`     | `http://localhost:3000` | Used to generate attachment URLs                    |
| `DISABLE_AUTH` | `false`                 | Set `true` to bypass authentication                 |
| `LATENCY_MS`   | `0`                     | Artificial latency added to all responses (ms)      |
| `SEED_FILE`    | _(none)_                | Path to a JSON file loaded automatically at startup |

---

## Next steps

- [test-api.md](./test-api.md) — Details of the test control API
- [libraries.md](./libraries.md) — How to connect discord.js / discord.py / Discord.Net and more
