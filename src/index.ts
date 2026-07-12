/**
 * Discord Mock Server entry point
 *
 * Starts the Hono app and provides a mock server for Discord REST API v10.
 */

import { loadConfig } from './config'
import { initializeDatabase } from './db'
import { buildApp } from './app'
import { sendReconnect } from './gateway/server'
import { serveWithGateway } from './http-server'
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

// eslint-disable-next-line unicorn/no-top-level-side-effects -- this is the production entry point; starting the server is the module's whole purpose.
console.info(`Discord Mock Server starting on ${hostname}:${port}`)

const server = serveWithGateway({
  fetch: app.fetch,
  port,
  hostname,
  wss,
})

// Gracefully reconnect all Gateway sessions before exiting on termination signals
/** Max time (ms) to wait for a graceful shutdown before forcing exit */
const SHUTDOWN_TIMEOUT_MS = 5000
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    for (const session of sessionManager.getAll()) {
      sendReconnect(session)
    }
    // Close the HTTP server before exiting so the RECONNECT frames and close
    // handshakes have a chance to flush; exit once it drains, with a timeout
    // fallback so a hung connection cannot block shutdown indefinitely.
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS).unref()
  })
}

export { app }
