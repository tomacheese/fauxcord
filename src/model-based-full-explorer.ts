/* eslint-disable @typescript-eslint/no-use-before-define -- The full coverage runner keeps scenario handlers together. */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { GatewayIntentBits } from 'discord-api-types/v10'
import { MANIFEST } from '../spec/manifest'
import type { SpecEndpoint, SpecSuccessBranch } from '../spec/manifest'
import { createContractFixture, createRealServer } from './test-helpers'
import { GatewayObserver } from './model-based-explorer'

const API_PREFIX = '/api/v10'
const HTTP_TIMEOUT_MS = 5000

interface ContractCoverageOperation {
  kind: 'contract-branch'
  id: string
  endpoint: SpecEndpoint
  branch: SpecSuccessBranch
}

interface SupplementalCoverageOperation {
  kind: 'guild-delete' | 'oauth2-lifecycle' | 'gateway-event-catalog'
  id: string
}

export type FullCoverageOperation =
  ContractCoverageOperation | SupplementalCoverageOperation

export interface FullCoverageObservation {
  index: number
  operation: string
  requests: { method: string; path: string; status: number }[]
  checks: string[]
  outcome: 'passed' | 'failed'
  error?: string
}

export interface FullCoverageResult {
  formatVersion: 1
  mode: 'full'
  seed: string
  passed: boolean
  generatedSteps: number
  executedSteps: number
  coverage: {
    openApiOperations: number
    successBranches: number
    supplementalScenarios: number
  }
  operations: string[]
  trace: FullCoverageObservation[]
  finding?: {
    operation: string
    expected: unknown
    actual: unknown
  }
  minimized?: string[]
}

/** Generates a seeded ordering of every documented success branch and local public API flow. */
export function generateFullCoveragePlan(
  seed: number | string
): FullCoverageOperation[] {
  const state = parseSeed(seed)
  const operations: FullCoverageOperation[] = MANIFEST.flatMap((endpoint) =>
    endpoint.successBranches.map((branch) => ({
      kind: 'contract-branch' as const,
      id: `${endpoint.method.toUpperCase()} ${endpoint.specPath} ${branch.status}`,
      endpoint,
      branch,
    }))
  )
  operations.push(
    { kind: 'guild-delete', id: 'DELETE /guilds/{guild_id} 204' },
    { kind: 'oauth2-lifecycle', id: 'OAuth2 authorize/token/revoke flows' },
    { kind: 'gateway-event-catalog', id: 'Gateway dispatch event catalog' }
  )

  for (let index = operations.length - 1; index > 0; index--) {
    const value = nextRandom()
    const swapIndex = value % (index + 1)
    const operation = operations.at(index)
    const swapped = operations.at(swapIndex)
    if (!operation || !swapped) continue
    operations[index] = swapped
    operations[swapIndex] = operation
  }
  return operations

  function nextRandom(): number {
    let value = state.value
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    state.value = value >>> 0
    return state.value
  }
}

/** Runs every manifested response branch and every non-manifest public API flow. */
export async function runFullCoverageExploration(
  seed: number | string
): Promise<FullCoverageResult> {
  const normalizedSeed = parseSeed(seed).value
  const operations = generateFullCoveragePlan(normalizedSeed)
  const trace: FullCoverageObservation[] = []
  const coverage = {
    openApiOperations: MANIFEST.length,
    successBranches: MANIFEST.reduce(
      (count, endpoint) => count + endpoint.successBranches.length,
      0
    ),
    supplementalScenarios: 3,
  }

  for (const [index, operation] of operations.entries()) {
    const observation: FullCoverageObservation = {
      index,
      operation: operation.id,
      requests: [],
      checks: [],
      outcome: 'passed',
    }
    trace.push(observation)

    const server = await createRealServer()
    try {
      switch (operation.kind) {
        case 'contract-branch': {
          await runContractBranch(server, operation, observation)
          break
        }
        case 'guild-delete': {
          await runGuildDelete(server, observation)
          break
        }
        case 'oauth2-lifecycle': {
          await runOAuth2Lifecycle(server, observation)
          break
        }
        case 'gateway-event-catalog': {
          await runGatewayEventCatalog(server, observation)
          break
        }
      }
    } catch (error) {
      observation.outcome = 'failed'
      observation.error = error instanceof Error ? error.message : String(error)
      const finding = {
        operation: operation.id,
        expected: 'All operation invariants pass',
        actual: observation.error,
      }
      return {
        formatVersion: 1,
        mode: 'full',
        seed: String(normalizedSeed),
        passed: false,
        generatedSteps: operations.length,
        executedSteps: trace.length,
        coverage,
        operations: operations.map(({ id }) => id),
        trace,
        finding,
        minimized: [operation.id],
      }
    } finally {
      await server.close()
    }
  }

  return {
    formatVersion: 1,
    mode: 'full',
    seed: String(normalizedSeed),
    passed: true,
    generatedSteps: operations.length,
    executedSteps: trace.length,
    coverage,
    operations: operations.map(({ id }) => id),
    trace,
  }
}

async function runContractBranch(
  server: Awaited<ReturnType<typeof createRealServer>>,
  operation: ContractCoverageOperation,
  observation: FullCoverageObservation
): Promise<void> {
  const fixture = await operation.endpoint.createFixture({
    create: () => Promise.resolve(createContractFixture(server.db)),
  })
  const request = operation.branch.request(fixture)
  const headers = new Headers(request.init?.headers)
  if (operation.endpoint.authentication === 'bot') {
    headers.set('Authorization', fixture.token)
  } else if (operation.endpoint.authentication === 'bearer') {
    headers.set('Authorization', `Bearer ${fixture.bearerToken}`)
  }

  const method = request.init?.method ?? operation.endpoint.method.toUpperCase()
  const response = await fetch(new URL(request.path, server.baseUrl), {
    ...request.init,
    method,
    headers,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
  observation.requests.push({
    method,
    path: request.path,
    status: response.status,
  })
  if (response.status !== operation.branch.status) {
    throw new Error(
      `${operation.id} expected HTTP ${operation.branch.status}, got ${response.status}`
    )
  }
  observation.checks.push('Expected HTTP status')

  await operation.branch.assert({
    baseUrl: server.baseUrl,
    fixture,
    response,
  })
  observation.checks.push('Manifest response and state assertions')
}

async function runGuildDelete(
  server: Awaited<ReturnType<typeof createRealServer>>,
  observation: FullCoverageObservation
): Promise<void> {
  const fixture = createContractFixture(server.db)
  const path_ = `${API_PREFIX}/guilds/${fixture.guildId}`
  const response = await request(server.baseUrl, path_, {
    method: 'DELETE',
    headers: { Authorization: fixture.token },
  })
  observe(observation, 'DELETE', path_, response)
  assert(response.status === 204, `Guild delete returned ${response.status}`)
  assert(
    !server.db
      .prepare('SELECT 1 FROM guilds WHERE id = ?')
      .get(fixture.guildId),
    'Guild remained after deletion'
  )
  observation.checks.push('Guild row removed')

  const readPath = `${API_PREFIX}/guilds/${fixture.guildId}`
  const read = await request(server.baseUrl, readPath, {
    headers: { Authorization: fixture.token },
  })
  observe(observation, 'GET', readPath, read)
  assert(read.status === 404, `Deleted guild read returned ${read.status}`)
  observation.checks.push('Deleted guild is no longer readable')
}

async function runOAuth2Lifecycle(
  server: Awaited<ReturnType<typeof createRealServer>>,
  observation: FullCoverageObservation
): Promise<void> {
  const fixture = createContractFixture(server.db)
  const redirectUri = 'https://local.example/callback'
  const authorizePath = `${API_PREFIX}/oauth2/authorize?${new URLSearchParams({
    client_id: fixture.applicationId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify openid',
    state: 'full-coverage-state',
  }).toString()}`
  const authorize = await request(server.baseUrl, authorizePath, {
    redirect: 'manual',
  })
  observe(observation, 'GET', authorizePath, authorize)
  assert(authorize.status === 302, `Authorize returned ${authorize.status}`)
  const location = authorize.headers.get('location')
  assert(location, 'Authorize response omitted Location')
  const authorizationUrl = new URL(location)
  const code = authorizationUrl.searchParams.get('code')
  assert(code, 'Authorize redirect omitted code')
  assert(
    authorizationUrl.searchParams.get('state') === 'full-coverage-state',
    'Authorize redirect did not preserve state'
  )
  observation.checks.push('Authorization code redirect and state')

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  })
  const tokenPath = `${API_PREFIX}/oauth2/token`
  const tokenResponse = await request(server.baseUrl, tokenPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  observe(observation, 'POST', tokenPath, tokenResponse)
  assert(
    tokenResponse.status === 200,
    `Token exchange returned ${tokenResponse.status}`
  )
  const tokenBody = (await tokenResponse.json()) as {
    access_token?: string
    refresh_token?: string
    token_type?: string
  }
  assert(tokenBody.access_token, 'Token response omitted access_token')
  assert(tokenBody.refresh_token, 'Token response omitted refresh_token')
  assert(tokenBody.token_type === 'Bearer', 'Token type was not Bearer')
  observation.checks.push('Authorization code exchanged once')

  const clientCredentials = await request(server.baseUrl, tokenPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: fixture.applicationId,
      scope: 'identify',
    }),
  })
  observe(observation, 'POST', tokenPath, clientCredentials)
  assert(
    clientCredentials.status === 200,
    `Client credentials exchange returned ${clientCredentials.status}`
  )
  const clientToken = (await clientCredentials.json()) as {
    access_token?: string
  }
  assert(clientToken.access_token, 'Client credentials response omitted token')
  observation.checks.push('Client credentials grant issued a token')

  const mePath = `${API_PREFIX}/oauth2/@me`
  const me = await request(server.baseUrl, mePath, {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  })
  observe(observation, 'GET', mePath, me)
  assert(me.status === 200, `OAuth2 identity returned ${me.status}`)
  observation.checks.push('Exchanged token identifies its application')

  const userInfoPath = `${API_PREFIX}/oauth2/userinfo`
  const userInfo = await request(server.baseUrl, userInfoPath, {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  })
  observe(observation, 'GET', userInfoPath, userInfo)
  assert(userInfo.status === 200, `Userinfo returned ${userInfo.status}`)
  observation.checks.push('OpenID token resolves the local user')

  const revokePath = `${API_PREFIX}/oauth2/token/revoke`
  for (const token of [tokenBody.access_token, clientToken.access_token]) {
    const revoke = await request(server.baseUrl, revokePath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    })
    observe(observation, 'POST', revokePath, revoke)
    assert(revoke.status === 200, `Token revoke returned ${revoke.status}`)
    const revokedIdentity = await request(server.baseUrl, mePath, {
      headers: { Authorization: `Bearer ${token}` },
    })
    observe(observation, 'GET', mePath, revokedIdentity)
    assert(
      revokedIdentity.status === 401,
      `Revoked token remained valid (${revokedIdentity.status})`
    )
  }
  observation.checks.push('Revoked tokens can no longer authenticate')
}

async function runGatewayEventCatalog(
  server: Awaited<ReturnType<typeof createRealServer>>,
  observation: FullCoverageObservation
): Promise<void> {
  const gatewayToken = 'Bot model-full-gateway-local-only'
  const token = 'Bot model-full-gateway-operation-token'
  const botId = '111111111111111111'
  const guildId = '222222222222222222'
  const initialChannelId = '333333333333333333'
  const registerBot = await request(server.baseUrl, '/_test/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: gatewayToken,
      user: { id: botId, username: 'Full Coverage Bot' },
    }),
  })
  observe(observation, 'POST', '/_test/setup', registerBot)
  assert(
    registerBot.status === 201,
    `Gateway bot setup returned ${registerBot.status}`
  )
  const observer = await connectFullGateway(server, gatewayToken)
  let lastSequence = 0

  const expectDispatch = async (
    eventName: string,
    expected: Record<string, unknown>
  ): Promise<void> => {
    let payload
    try {
      payload = await observer.waitForDispatch(eventName, HTTP_TIMEOUT_MS)
    } catch (error) {
      throw new Error(
        `Expected Gateway ${eventName}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    assert(payload.op === 0, `${eventName} was not a Dispatch payload`)
    assert(payload.t === eventName, `Expected ${eventName}, got ${payload.t}`)
    const sequence = (payload as { s?: unknown }).s
    assert(
      typeof sequence === 'number' && sequence > lastSequence,
      `${eventName} sequence did not increase`
    )
    lastSequence = sequence
    const data = record(
      payload.d,
      `${eventName} payload data was not an object`
    )
    for (const [key, value] of Object.entries(expected)) {
      assert(
        data[key] === value,
        `${eventName} payload had an unexpected ${key}`
      )
    }
    observation.checks.push(`${eventName} payload and sequence`)
  }

  const call = async (
    method: string,
    path_: string,
    body?: unknown,
    expectedStatus = 200
  ): Promise<Response> => {
    const response = await request(server.baseUrl, path_, {
      method,
      headers: {
        Authorization: token,
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
    observe(observation, method, path_, response)
    assert(
      response.status === expectedStatus,
      `${method} ${path_} returned ${response.status}, expected ${expectedStatus}`
    )
    return response
  }

  try {
    const setup = await request(server.baseUrl, '/_test/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        user: { id: botId, username: 'Full Coverage Bot' },
        guilds: [
          {
            id: guildId,
            name: 'Gateway Event Guild',
            channels: [{ id: initialChannelId, name: 'initial', type: 0 }],
          },
        ],
      }),
    })
    observe(observation, 'POST', '/_test/setup', setup)
    assert(
      setup.status === 201,
      `Gateway fixture setup returned ${setup.status}`
    )
    await expectDispatch('GUILD_CREATE', { id: guildId })
    await expectDispatch('GUILD_MEMBER_ADD', { guild_id: guildId })

    const channelPath = `${API_PREFIX}/guilds/${guildId}/channels`
    const channelResponse = await call(
      'POST',
      channelPath,
      { name: 'generated', type: 0 },
      201
    )
    const channel = record(
      await channelResponse.json(),
      'Channel response was invalid'
    )
    const channelId = String(channel.id)
    await expectDispatch('CHANNEL_CREATE', { id: channelId })

    const updateChannelPath = `${API_PREFIX}/channels/${channelId}`
    await call('PATCH', updateChannelPath, { name: 'updated' })
    await expectDispatch('CHANNEL_UPDATE', { id: channelId, name: 'updated' })

    const messagePath = `${API_PREFIX}/channels/${channelId}/messages`
    const messageResponse = await call(
      'POST',
      messagePath,
      { content: 'gateway coverage' },
      200
    )
    const message = record(
      await messageResponse.json(),
      'Message response was invalid'
    )
    const messageId = String(message.id)
    await expectDispatch('MESSAGE_CREATE', {
      id: messageId,
      channel_id: channelId,
      guild_id: guildId,
    })

    const updateMessagePath = `${messagePath}/${messageId}`
    await call('PATCH', updateMessagePath, { content: 'gateway updated' })
    await expectDispatch('MESSAGE_UPDATE', {
      id: messageId,
      channel_id: channelId,
      guild_id: guildId,
    })

    const emoji = encodeURIComponent('👍')
    const addReactionPath = `${updateMessagePath}/reactions/${emoji}/@me`
    await call('PUT', addReactionPath, undefined, 204)
    await expectDispatch('MESSAGE_REACTION_ADD', {
      message_id: messageId,
      channel_id: channelId,
      guild_id: guildId,
    })
    await call('DELETE', addReactionPath, undefined, 204)
    await expectDispatch('MESSAGE_REACTION_REMOVE', {
      message_id: messageId,
      channel_id: channelId,
      guild_id: guildId,
    })

    await call('DELETE', updateMessagePath, undefined, 204)
    await expectDispatch('MESSAGE_DELETE', {
      id: messageId,
      channel_id: channelId,
      guild_id: guildId,
    })

    const rolePath = `${API_PREFIX}/guilds/${guildId}/roles`
    const roleResponse = await call(
      'POST',
      rolePath,
      { name: 'generated-role' },
      200
    )
    const role = record(await roleResponse.json(), 'Role response was invalid')
    const roleId = String(role.id)
    await expectDispatch('GUILD_ROLE_CREATE', { guild_id: guildId })
    const updateRolePath = `${rolePath}/${roleId}`
    await call('PATCH', updateRolePath, { name: 'updated-role' })
    await expectDispatch('GUILD_ROLE_UPDATE', { guild_id: guildId })
    await call('DELETE', updateRolePath, undefined, 204)
    await expectDispatch('GUILD_ROLE_DELETE', {
      guild_id: guildId,
      role_id: roleId,
    })

    const botMemberPath = `${API_PREFIX}/guilds/${guildId}/members/@me`
    await call('PATCH', botMemberPath, { nick: 'Coverage Bot' })
    await expectDispatch('GUILD_MEMBER_UPDATE', { guild_id: guildId })
    const removeBotMemberPath = `${API_PREFIX}/guilds/${guildId}/members/${botId}`
    await call('DELETE', removeBotMemberPath, undefined, 204)
    await expectDispatch('GUILD_MEMBER_REMOVE', { guild_id: guildId })

    const commandPath = `${API_PREFIX}/applications/${botId}/commands`
    const commandResponse = await call(
      'POST',
      commandPath,
      { name: 'gateway-coverage', description: 'Gateway coverage command' },
      201
    )
    const command = record(
      await commandResponse.json(),
      'Command response was invalid'
    )
    const interactionPath = '/_test/interactions'
    const interactionResponse = await request(server.baseUrl, interactionPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        application_id: botId,
        command_name: 'gateway-coverage',
        guild_id: guildId,
        channel_id: channelId,
        user_id: botId,
      }),
    })
    observe(observation, 'POST', interactionPath, interactionResponse)
    assert(
      interactionResponse.status === 201,
      `Interaction fixture returned ${interactionResponse.status}`
    )
    const interaction = record(
      await interactionResponse.json(),
      'Interaction response was invalid'
    )
    assert(
      record(interaction.data, 'Interaction data was invalid').id ===
        command.id,
      'Interaction referenced a different command'
    )
    await expectDispatch('INTERACTION_CREATE', { application_id: botId })

    await call('DELETE', `${API_PREFIX}/channels/${channelId}`, undefined, 200)
    await expectDispatch('CHANNEL_DELETE', { id: channelId })
    const expectedEvents = [
      'GUILD_CREATE',
      'GUILD_MEMBER_ADD',
      'CHANNEL_CREATE',
      'CHANNEL_UPDATE',
      'MESSAGE_CREATE',
      'MESSAGE_UPDATE',
      'MESSAGE_REACTION_ADD',
      'MESSAGE_REACTION_REMOVE',
      'MESSAGE_DELETE',
      'GUILD_ROLE_CREATE',
      'GUILD_ROLE_UPDATE',
      'GUILD_ROLE_DELETE',
      'GUILD_MEMBER_UPDATE',
      'GUILD_MEMBER_REMOVE',
      'INTERACTION_CREATE',
      'CHANNEL_DELETE',
    ]
    assert(
      new Set(expectedEvents).size === 16,
      'Gateway event catalog contains duplicate names'
    )
    observation.checks.push(
      `All ${expectedEvents.length} Gateway dispatch types`
    )
  } finally {
    await observer.close()
    for (const session of server.sessionManager.getAll()) {
      server.sessionManager.remove(session.sessionId)
    }
  }
}

async function connectFullGateway(
  server: Awaited<ReturnType<typeof createRealServer>>,
  token: string
): Promise<GatewayObserver> {
  const socket = new WebSocket(server.baseUrl.replace(/^http:/, 'ws:'))
  const observer = new GatewayObserver(socket, undefined)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Gateway connection timed out'))
    }, 2000)
    socket.once('open', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
  const hello = await observer.waitFor((payload) => payload.op === 10, 2000)
  assert(hello.op === 10, 'Gateway did not send HELLO')
  socket.send(
    JSON.stringify({
      op: 2,
      d: {
        token,
        intents:
          GatewayIntentBits.Guilds |
          GatewayIntentBits.GuildMembers |
          GatewayIntentBits.GuildMessages |
          GatewayIntentBits.GuildMessageReactions,
      },
    })
  )
  await observer.waitForDispatch('READY', 2000)
  return observer
}

function record(value: unknown, message: string): Record<string, unknown> {
  assert(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    message
  )
  return value as Record<string, unknown>
}

function observe(
  observation: FullCoverageObservation,
  method: string,
  path_: string,
  response: Response
): void {
  observation.requests.push({ method, path: path_, status: response.status })
}

async function request(
  baseUrl: string,
  path_: string,
  init: RequestInit = {}
): Promise<Response> {
  return await fetch(new URL(path_, baseUrl), {
    ...init,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function parseSeed(seed: number | string): { value: number } {
  const text = String(seed)
  if (!/^(?:0[xX][0-9a-fA-F]+|[0-9]+)$/.test(text)) {
    throw new Error(
      'Seed must be an unsigned 32-bit decimal or hexadecimal integer'
    )
  }
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xff_ff_ff_ff) {
    throw new Error(
      'Seed must be an unsigned 32-bit decimal or hexadecimal integer'
    )
  }
  return { value: value >>> 0 || 0x6d_2b_79_f5 }
}

async function runCli(arguments_: string[]): Promise<number> {
  let seed: string | undefined
  let outputPath: string | undefined
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(
        'Usage: pnpm fuzz:full --seed <uint32> [--out <path>]\n'
      )
      return 0
    }
    const equalsIndex = argument.indexOf('=')
    const name = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex)
    if (name !== '--seed' && name !== '--out') {
      throw new Error(`Unknown argument: ${argument}`)
    }
    const value =
      equalsIndex === -1
        ? arguments_.at(++index)
        : argument.slice(equalsIndex + 1)
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${name}`)
    }
    if (name === '--seed') seed = value
    else outputPath = value
  }
  if (seed === undefined)
    throw new Error('--seed is required; use --help for usage')

  const result = await runFullCoverageExploration(seed)
  if (!result.passed) {
    const reportPath = path.resolve(
      outputPath ??
        path.join(
          '.fauxcord-exploration',
          `full-${result.seed}-${Date.now()}-${randomUUID().slice(0, 8)}.json`
        )
    )
    await mkdir(path.dirname(reportPath), { recursive: true })
    await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, {
      flag: 'wx',
    })
    process.stdout.write(
      `${JSON.stringify(
        {
          seed: result.seed,
          passed: false,
          executedSteps: result.executedSteps,
          finding: result.finding,
          minimized: result.minimized,
          report: reportPath,
        },
        null,
        2
      )}\n`
    )
    return 1
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        seed: result.seed,
        passed: true,
        executedSteps: result.executedSteps,
        coverage: result.coverage,
      },
      null,
      2
    )}\n`
  )
  return 0
}

if (
  pathToFileURL(path.resolve(process.argv[1] ?? '')).href === import.meta.url
) {
  try {
    process.exitCode = await runCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  }
}
