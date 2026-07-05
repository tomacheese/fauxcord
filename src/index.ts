/**
 * Discord Mock Server entry point
 *
 * Starts the Hono app and provides a mock server for Discord REST API v10.
 */

import { serve } from '@hono/node-server'
import { loadConfig } from './config'
import { initializeDatabase } from './db'
import { buildApp } from './app'
import { sendReconnect } from './gateway/server'
import { readFile } from 'node:fs/promises'
import { setupTestEnvironment } from './services/test-control'

const config = loadConfig()

const db = initializeDatabase(config.dbPath)

const { app, wss, sessionManager } = buildApp(db, config)

// Load SEED_FILE
if (config.seedFile) {
  try {
    const seedData = JSON.parse(await readFile(config.seedFile, 'utf8')) as {
      bots: {
        token: string
        user?: { id?: string; username?: string }
        guilds?: {
          id?: string
          name: string
          channels?: { id?: string; name: string; type?: number }[]
        }[]
      }[]
    }

    for (const bot of seedData.bots) {
      try {
        setupTestEnvironment(db, bot)
        console.info(`Seeded bot: ${bot.token}`)
      } catch (err) {
        if (err instanceof Error && err.message === 'CONFLICT') {
          console.info(`Bot already exists: ${bot.token}, skipping`)
        } else {
          // Log the specific bot that failed and continue seeding the rest,
          // so a single bad entry does not silently skip subsequent bots.
          console.error(`Failed to seed bot: ${bot.token}`, err)
        }
      }
    }
  } catch (err) {
    console.error('Failed to load or parse seed file:', err)
  }
}

// Start the server
const port = config.port
const hostname = config.host

console.info(`Discord Mock Server starting on ${hostname}:${port}`)

serve({
  fetch: app.fetch,
  port,
  hostname,
  websocket: { server: wss },
})

// Gracefully reconnect all Gateway sessions before exiting on termination signals
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    for (const session of sessionManager.getAll()) {
      sendReconnect(session)
    }
    process.exit(0)
  })
}

export { app }
