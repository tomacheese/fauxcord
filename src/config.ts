/**
 * Environment variable loading and configuration management
 *
 * Loads the settings required for server operation from environment variables.
 */

/** Server configuration interface */
export interface Config {
  /** Listen port */
  port: number
  /** Bind address */
  host: string
  /** SQLite file path */
  dbPath: string
  /** Attachment storage directory */
  uploadPath: string
  /** Base URL used to generate attachment URLs */
  baseUrl: string
  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  /** When true, any token is allowed */
  disableAuth: boolean
  /** Artificial latency added to all responses (ms) */
  latencyMs: number
  /** Path to a JSON file loaded automatically at startup */
  seedFile: string | undefined
}

/**
 * Validates whether a log level value is valid.
 * @param level - Log level string to validate
 * @returns true if the log level is valid
 */
function isValidLogLevel(level: string): level is Config['logLevel'] {
  return ['debug', 'info', 'warn', 'error'].includes(level)
}

/**
 * Loads configuration from environment variables.
 * @returns Configuration object
 */
export function loadConfig(): Config {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10)
  const latencyMs = Number.parseInt(process.env.LATENCY_MS ?? '0', 10)
  const logLevel = process.env.LOG_LEVEL ?? 'info'

  return {
    port: Number.isNaN(port) ? 3000 : port,
    host: process.env.HOST ?? '0.0.0.0',
    dbPath: process.env.DB_PATH ?? '/data/mock.db',
    uploadPath: process.env.UPLOAD_PATH ?? '/data/uploads',
    baseUrl: process.env.BASE_URL ?? 'http://localhost:3000',
    logLevel: isValidLogLevel(logLevel) ? logLevel : 'info',
    disableAuth: process.env.DISABLE_AUTH === 'true',
    latencyMs: Number.isNaN(latencyMs) ? 0 : latencyMs,
    seedFile: process.env.SEED_FILE,
  }
}
