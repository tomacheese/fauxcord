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

What gets deleted: messages, webhooks, invites, reactions, pins, embeds, attachments

### Reset only a specific Bot's data

```bash
curl -X POST http://localhost:3000/_test/reset \
  -H "Content-Type: application/json" \
  -d '{"token": "Bot mytoken"}'
```

Only messages sent by that Bot and Webhooks/Invites belonging to that Bot's Guilds are deleted.

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
If `author_token` is an empty string, the message was injected via
`POST /_test/channels/:channelId/messages` (see below) as a non-bot user.

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

## `POST /_test/users` — Register a non-bot user

Registers a plain (non-bot) user, for use as the `author` of an injected
message (see below). Unlike `/_test/setup`, an explicit `id` collision is a
hard error — this endpoint never silently reuses an existing row.

```bash
curl -X POST http://localhost:3000/_test/users \
  -H "Content-Type: application/json" \
  -d '{"username": "TestHuman"}'
```

```json
{
  "id": "555555555555555555",
  "username": "TestHuman",
  "discriminator": "0"
}
```

**Fields**

| Field           | Required | Description                                                                                                   |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `id`            | —        | User ID. A Snowflake is auto-generated if omitted. Returns `409 Conflict` if an explicit `id` already exists. |
| `username`      | ✅       | Username.                                                                                                     |
| `discriminator` | —        | Defaults to `"0"`.                                                                                            |

---

## `POST /_test/channels/:channelId/messages` — Inject a message from a specific user

Creates a message in a channel authored by a pre-registered user (typically
one created via `POST /_test/users`), letting you pick an arbitrary non-bot
author — unlike the bot/webhook message paths (`POST /channels/:id/messages`,
Webhook execution), which always resolve the author to a bot or Webhook
account. If the channel belongs to a Guild, the author is also registered
as a Guild member.

```bash
curl -X POST http://localhost:3000/_test/channels/333333333333333333/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello from a human!", "author": {"id": "555555555555555555"}}'
```

Returns the created message object (same shape as
`POST /channels/:channelId/messages`), with `author.bot: false`.

**Fields**

| Field       | Required | Description                                                                                                          |
| ----------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `content`   | ✅       | Message content.                                                                                                     |
| `author.id` | ✅       | ID of a user already registered via `POST /_test/users` (or any other existing user). Returns `404` if unregistered. |

---

## `POST /_test/interactions` — Simulate an interaction

Generates a pseudo-interaction against a registered command (global or
guild-scoped) and dispatches it to the bot via the Gateway as
`INTERACTION_CREATE`. Responds `201` immediately with the interaction's
info; the Gateway dispatch happens asynchronously right after.

```bash
curl -X POST http://localhost:3000/_test/interactions \
  -H "Content-Type: application/json" \
  -d '{
    "application_id": "111111111111111111",
    "command_name": "ping",
    "guild_id": "222222222222222222",
    "channel_id": "333333333333333333"
  }'
```

**Fields**

| Field            | Required | Description                                                        |
| ---------------- | -------- | ------------------------------------------------------------------ |
| `application_id` | ✅       | The bot's application ID (same as its `user.id`)                  |
| `command_name`   | ✅       | Name of a command already registered via the Application Commands API |
| `type`           | —        | Interaction type (default: `2`, APPLICATION_COMMAND)               |
| `guild_id`       | —        | Guild ID. When set, prefers a guild-scoped command match, falling back to a global command of the same name |
| `channel_id`     | —        | Channel ID the interaction is bound to (needed for `type: 4` callback responses and followups) |
| `user_id`        | —        | Invoking user ID (auto-generated if omitted)                       |
| `options`        | —        | Command option values, passed through into the interaction's `data.options` |

**Response**: `201` with the created interaction object (matches the
Discord `Interaction` shape). `404` (`{"message": "404: Not Found", "code": 0}`)
when `command_name` does not match any registered command in scope.

---

## `POST /_test/polls/:messageId/votes` — Inject a poll vote

Registers a vote from a pre-registered user (typically one created via
`POST /_test/users`) on an existing poll's answer, for verifying your
bot's poll-vote handling without a real Discord client casting the vote.

```bash
curl -X POST http://localhost:3000/_test/polls/1513052391153471489/votes \
  -H "Content-Type: application/json" \
  -d '{"answer_id": 1, "user_id": "555555555555555555"}'
```

**Fields**

| Field       | Required | Description                                                        |
| ----------- | -------- | ------------------------------------------------------------------ |
| `answer_id` | ✅       | ID of an existing poll answer (from the message's `poll.answers`). |
| `user_id`   | ✅       | ID of a user already registered via `POST /_test/users` (or any other existing user). |

**Response**: `204 No Content` on success. `404` (`{"message": "404: Not Found", "code": 0}`) when the message has no poll, or the answer ID does not exist on it. `400` (`{"message": "400: Bad Request", "code": 0}`) when `answer_id` or `user_id` is missing.

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

## `GET /_mock/attachments/:channelId/:messageId/:filename` — Download an attachment

Message and application attachment responses contain a public `url` and `proxy_url` under this path. Fetch the returned URL without an Authorization header to verify the uploaded bytes in your test.

```bash
curl http://localhost:3000/_mock/attachments/333333333333333333/1513052391153471489/proof.txt
```

The response uses the uploaded file's content type and returns the original bytes. An attachment that does not exist returns `404` with Fauxcord's standard error response.

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
