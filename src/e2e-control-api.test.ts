import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { GatewayOp } from './gateway/opcodes'
import { createRealServer } from './test-helpers'

const token = 'Bot control-api-token'
const applicationId = '100000000000000001'
const guildId = '100000000000000002'
const channelId = '100000000000000003'

describe('Fauxcord control APIs over a real server', () => {
  let close: (() => Promise<void>) | undefined

  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('sets up and deletes an isolated environment', async () => {
    const server = await createRealServer()
    close = server.close

    const health = await fetch(`${server.baseUrl}/_mock/health`)
    expect(health.status).toBe(200)
    await expect(health.json()).resolves.toMatchObject({
      status: 'ok',
      db: 'ok',
    })

    const setup = await fetch(`${server.baseUrl}/_test/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        user: { id: applicationId, username: 'ControlBot' },
        guilds: [
          {
            id: guildId,
            name: 'Control Guild',
            channels: [{ id: channelId, name: 'control', type: 0 }],
          },
        ],
      }),
    })
    expect(setup.status).toBe(201)

    const deleted = await fetch(
      `${server.baseUrl}/_test/setup/${encodeURIComponent(token)}`,
      { method: 'DELETE' }
    )
    expect(deleted.status).toBe(204)
    const deletedAgain = await fetch(
      `${server.baseUrl}/_test/setup/${encodeURIComponent(token)}`,
      { method: 'DELETE' }
    )
    expect(deletedAgain.status).toBe(404)
  })

  it('injects, inspects, resets, and lists test resources', async () => {
    const server = await createRealServer()
    close = server.close

    const setup = await fetch(`${server.baseUrl}/_test/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        user: { id: applicationId, username: 'ControlBot' },
        guilds: [
          {
            id: guildId,
            name: 'Control Guild',
            channels: [{ id: channelId, name: 'control', type: 0 }],
          },
        ],
      }),
    })
    expect(setup.status).toBe(201)

    const userResponse = await fetch(`${server.baseUrl}/_test/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ControlUser' }),
    })
    expect(userResponse.status).toBe(201)
    const user = (await userResponse.json()) as { id: string }

    const injected = await fetch(
      `${server.baseUrl}/_test/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'injected from a user',
          author: { id: user.id },
        }),
      }
    )
    expect(injected.status).toBe(201)

    const webhookResponse = await fetch(
      `${server.baseUrl}/channels/${channelId}/webhooks`,
      {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Control Webhook' }),
      }
    )
    expect(webhookResponse.status).toBe(200)
    const webhook = (await webhookResponse.json()) as { id: string }

    const webhooks = await fetch(
      `${server.baseUrl}/_test/webhooks/${channelId}`
    )
    expect(webhooks.status).toBe(200)
    await expect(webhooks.json()).resolves.toMatchObject({
      webhooks: [{ id: webhook.id, name: 'Control Webhook' }],
    })

    const messages = await fetch(
      `${server.baseUrl}/_test/messages/${channelId}`
    )
    expect(messages.status).toBe(200)
    await expect(messages.json()).resolves.toMatchObject({
      messages: [{ content: 'injected from a user' }],
    })

    const reset = await fetch(`${server.baseUrl}/_test/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(reset.status).toBe(204)
    await expect(
      fetch(`${server.baseUrl}/_test/messages/${channelId}`).then((response) =>
        response.json()
      )
    ).resolves.toEqual({ messages: [] })
    await expect(
      fetch(`${server.baseUrl}/_test/webhooks/${channelId}`).then((response) =>
        response.json()
      )
    ).resolves.toEqual({ webhooks: [] })
  })

  it('serves message attachments and accepts a poll vote', async () => {
    const server = await createRealServer()
    close = server.close

    const setup = await fetch(`${server.baseUrl}/_test/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        user: { id: applicationId, username: 'ControlBot' },
        guilds: [
          {
            id: guildId,
            name: 'Control Guild',
            channels: [{ id: channelId, name: 'control', type: 0 }],
          },
        ],
      }),
    })
    expect(setup.status).toBe(201)

    const attachmentForm = new FormData()
    attachmentForm.set('payload_json', JSON.stringify({ content: 'with file' }))
    attachmentForm.set(
      'files[0]',
      new File(['attachment body'], 'proof#?.txt', { type: 'image/png' })
    )
    const attachmentMessage = await fetch(
      `${server.baseUrl}/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: token },
        body: attachmentForm,
      }
    )
    expect(attachmentMessage.status).toBe(200)
    const uploaded = (await attachmentMessage.json()) as {
      attachments: { url: string }[]
    }
    const attachment = await fetch(uploaded.attachments[0].url)
    expect(attachment.status).toBe(200)
    expect(attachment.headers.get('content-type')).toContain('image/png')
    await expect(attachment.text()).resolves.toBe('attachment body')

    const pollMessage = await fetch(
      `${server.baseUrl}/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poll: {
            question: { text: 'Approve?' },
            answers: [
              { poll_media: { text: 'Yes' } },
              { poll_media: { text: 'No' } },
            ],
            duration: 24,
            allow_multiselect: false,
          },
        }),
      }
    )
    expect(pollMessage.status).toBe(200)
    const poll = (await pollMessage.json()) as { id: string }

    const voterResponse = await fetch(`${server.baseUrl}/_test/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Voter' }),
    })
    expect(voterResponse.status).toBe(201)
    const voter = (await voterResponse.json()) as { id: string }
    const vote = await fetch(`${server.baseUrl}/_test/polls/${poll.id}/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer_id: 1, user_id: voter.id }),
    })
    expect(vote.status).toBe(204)

    const voters = await fetch(
      `${server.baseUrl}/channels/${channelId}/polls/${poll.id}/answers/1`,
      { headers: { Authorization: token } }
    )
    expect(voters.status).toBe(200)
    await expect(voters.json()).resolves.toMatchObject({
      users: [{ id: voter.id }],
    })
  })

  it('delivers a simulated interaction to a real Gateway client', async () => {
    const server = await createRealServer()
    close = server.close

    const setup = await fetch(`${server.baseUrl}/_test/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        user: { id: applicationId, username: 'ControlBot' },
        guilds: [
          {
            id: guildId,
            name: 'Control Guild',
            channels: [{ id: channelId, name: 'control', type: 0 }],
          },
        ],
      }),
    })
    expect(setup.status).toBe(201)

    const command = await fetch(
      `${server.baseUrl}/applications/${applicationId}/guilds/${guildId}/commands`,
      {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'ping', description: 'Replies pong' }),
      }
    )
    expect(command.status).toBe(201)

    const ws = new WebSocket(server.baseUrl.replace('http:', 'ws:'))
    await new Promise((resolve) => ws.once('message', resolve))
    ws.send(
      JSON.stringify({ op: GatewayOp.Identify, d: { token, intents: 0 } })
    )
    await new Promise((resolve) => ws.once('message', resolve))
    const dispatched = new Promise<{
      t?: string
      d?: { data?: { name?: string } }
    }>((resolve) => {
      ws.once('message', (raw: Buffer) => {
        resolve(JSON.parse(raw.toString()))
      })
    })

    const interaction = await fetch(`${server.baseUrl}/_test/interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        application_id: applicationId,
        command_name: 'ping',
        guild_id: guildId,
        channel_id: channelId,
      }),
    })
    expect(interaction.status).toBe(201)
    await expect(dispatched).resolves.toMatchObject({
      t: 'INTERACTION_CREATE',
      d: { data: { name: 'ping' } },
    })
  })
})
