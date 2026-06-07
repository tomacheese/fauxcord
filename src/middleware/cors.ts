/**
 * CORS middleware
 *
 * Adds CORS headers to all requests.
 * Allows any origin for Discord bot test environments.
 */

import { cors } from 'hono/cors'

/**
 * Returns the CORS configuration middleware.
 * Allows access from any origin.
 */
export const corsMiddleware = cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'X-RateLimit-Reset-After',
    'X-RateLimit-Bucket',
    'X-RateLimit-Scope',
  ],
})
