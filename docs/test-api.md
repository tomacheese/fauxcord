# Test Control API

These are endpoints specific to Fauxcord.
Use them to set up your test environment, inspect data, and reset state.

> **No authentication required** — these endpoints can be called without an Authorization header.

---

## `POST /_test/setup` — Create an environment

Registers a Bot, Guilds, and Channels in one call.  
Intended to be called from your test suite's `beforeAll` or `before_each`.

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
        "name": "Test Guild",
        "channels": [
          { "id": "333333333333333333", "name": "general", "type": 0 }
        ]
      }
    ]
  }'
```

**Fields**

| Field                      | Required | Description                                        |
| -------------------------- | -------- | -------------------------------------------------- |
| `token`                    | ✅       | Bot token (including the `"Bot "` prefix)          |
| `user.id`                  | —        | User ID (a Snowflake is auto-generated if omitted) |
| `user.username`            | —        | Username (default: `"MockBot"`)                    |
| `guilds`                   | —        | Array of Guilds to create                          |
| `guilds[].id`              | —        | Guild ID (auto-generated if omitted)               |
| `guilds[].name`            | ✅       | Guild name                                         |
| `guilds[].channels`        | —        | Array of channels to create                        |
| `guilds[].channels[].id`   | —        | Channel ID (auto-generated if omitted)             |
| `guilds[].channels[].name` | ✅       | Channel name                                       |
| `guilds[].channels[].type` | —        | Channel type (`0`: text, default: `0`)             |

**Response**: The setup result (including any auto-generated IDs)

**Note**: Calling this twice with the same token returns `409 Conflict`.  
For subsequent calls, delete the existing data first via `/_test/reset` or `DELETE /_test/setup/:token`.

---

## `DELETE /_test/setup/:token` — Completely delete an environment

Deletes the Bot and all of its related data (Guilds, Channels, Messages, Webhooks).

```bash
curl -X DELETE "http://localhost:3000/_test/setup/Bot%20mytoken"
```

> If the token contains a space, like `Bot mytoken`, encode it as `%20`.

---

## `POST /_test/reset` — Delete messages only

Deletes only posted data, while keeping Guild, Channel, and Bot registrations intact.  
Use this for initialization before and after each test case.

### Reset all data

```bash
curl -X POST http://localhost:3000/_test/reset \
  -H "Content-Type: application/json" \
  -d '{}'
```

What gets deleted: messages, webhooks, reactions, pins, embeds, attachments

### Reset only a specific Bot's data

```bash
curl -X POST http://localhost:3000/_test/reset \
  -H "Content-Type: application/json" \
  -d '{"token": "Bot mytoken"}'
```

Only messages sent by that Bot and Webhooks belonging to that Bot's Guilds are deleted.

---

## `GET /_test/messages/:channelId` — Inspect a channel's messages

An endpoint for verifying within your tests that messages have actually arrived.

```bash
curl http://localhost:3000/_test/messages/333333333333333333
```

```json
{
  "messages": [
    {
      "id": "1513052391153471489",
      "content": "Hello, Fauxcord!",
      "author_token": "Bot mytoken",
      "created_at": "2026-06-07 10:00:00"
    }
  ]
}
```

If `author_token` is `"webhook"`, the message was posted via a Webhook.

---

## `GET /_test/webhooks/:channelId` — List a channel's Webhooks

```bash
curl http://localhost:3000/_test/webhooks/333333333333333333
```

```json
{
  "webhooks": [
    {
      "id": "1513052391153471490",
      "name": "My Webhook",
      "token": "abcdef1234567890"
    }
  ]
}
```

---

## `GET /_mock/health` — Check server status

```bash
curl http://localhost:3000/_mock/health
```

```json
{
  "status": "ok",
  "version": "1.0.0",
  "db": "ok",
  "uptime": 42
}
```

If `db` is not `"ok"`, there is a problem with SQLite.

---

## Typical test flow

```
1. At the start of the test suite
   POST /_test/setup   → Register Bot / Guild / Channel

2. Before each test case
   POST /_test/reset   → Clear messages etc.

3. Run the test
   Call the API via a Discord library

4. Assertions
   Verify message delivery via GET /_test/messages/:channelId

5. At the end of the test suite (optional)
   DELETE /_test/setup/:token  → Complete deletion
```

### Example: usage with vitest

```typescript
import { beforeAll, beforeEach, describe, it, expect } from 'vitest'

const BASE = 'http://localhost:3000'
const TOKEN = 'Bot test-token'
const CHANNEL_ID = '333333333333333333'

beforeAll(async () => {
  await fetch(`${BASE}/_test/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: TOKEN,
      user: { id: '111111111111111111', username: 'TestBot' },
      guilds: [
        {
          id: '222222222222222222',
          name: 'Test Guild',
          channels: [{ id: CHANNEL_ID, name: 'general', type: 0 }],
        },
      ],
    }),
  })
})

beforeEach(async () => {
  await fetch(`${BASE}/_test/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
})

it('sends a message', async () => {
  // Send a message via the library
  await sendMessage(CHANNEL_ID, 'hello')

  // Verify delivery via /_test/messages
  const res = await fetch(`${BASE}/_test/messages/${CHANNEL_ID}`)
  const { messages } = await res.json()
  expect(messages.some((m) => m.content === 'hello')).toBe(true)
})
```
