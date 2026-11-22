/**
 * File attachment service
 *
 * Handles saving and serving attachments.
 */

import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import path from 'node:path'
import { constants } from 'node:fs'
import type { Database } from '../db'

/** Maximum attachment size (25MB) */
export const MAX_FILE_SIZE = 25 * 1024 * 1024

/** Attachment information type */
export interface AttachmentInfo {
  id: string
  filename: string
  size: number
  contentType: string
  url: string
  proxyUrl: string
}

/**
 * Saves a file and records the attachment information in the DB.
 * @param db - Database
 * @param uploadPath - Upload base directory
 * @param baseUrl - Base URL
 * @param channelId - Channel ID
 * @param messageId - Message ID
 * @param attachmentId - Attachment ID
 * @param filename - File name
 * @param contentType - Content-Type
 * @param data - File data
 * @returns Attachment information
 */
export async function saveAttachment(
  db: Database,
  uploadPath: string,
  baseUrl: string,
  channelId: string,
  messageId: string,
  attachmentId: string,
  filename: string,
  contentType: string,
  data: ArrayBuffer | Uint8Array
): Promise<AttachmentInfo> {
  const dir = path.join(uploadPath, channelId, messageId)
  await mkdir(dir, { recursive: true })

  // Normalize to Buffer so both ArrayBuffer and Uint8Array are accepted
  const buffer = Buffer.from(
    data instanceof Uint8Array ? data : new Uint8Array(data)
  )

  const filePath = path.join(dir, filename)
  await writeFile(filePath, buffer)

  const size = buffer.byteLength

  const relativePath = path.join(channelId, messageId, filename)
  db.prepare(
    `INSERT INTO attachments (id, message_id, filename, size, content_type, file_path)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(attachmentId, messageId, filename, size, contentType, relativePath)

  const url = `${baseUrl}/_mock/attachments/${channelId}/${messageId}/${encodeURIComponent(filename)}`

  return {
    id: attachmentId,
    filename,
    size,
    contentType,
    url,
    proxyUrl: url,
  }
}

/**
 * Resolves the on-disk location of an attachment from untrusted URL parameters.
 * @param uploadPath - Upload base directory
 * @param channelId - Channel ID (a single path segment)
 * @param messageId - Message ID (a single path segment)
 * @param filename - File name (a single path segment)
 * @returns Absolute path strictly inside `uploadPath`, or null if any component
 * is empty, `.`, `..`, or contains `/`, `\` or NUL
 */
export function resolveAttachmentPath(
  uploadPath: string,
  channelId: string,
  messageId: string,
  filename: string
): string | null {
  const components = [channelId, messageId, filename]
  if (
    components.some(
      (component) =>
        component === '' ||
        component === '.' ||
        component === '..' ||
        /[/\\\0]/.test(component)
    )
  ) {
    return null
  }

  const root = path.resolve(uploadPath)
  const target = path.resolve(root, ...components)
  const relative = path.relative(root, target)
  return relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
    ? null
    : target
}

/**
 * Reads an attachment file.
 * @param uploadPath - Upload base directory
 * @param channelId - Channel ID
 * @param messageId - Message ID
 * @param filename - File name
 * @returns File data, or null if it does not exist or a parameter is not a
 * safe single path segment
 */
export async function getAttachment(
  uploadPath: string,
  channelId: string,
  messageId: string,
  filename: string
): Promise<Buffer | null> {
  const filePath = resolveAttachmentPath(
    uploadPath,
    channelId,
    messageId,
    filename
  )
  if (filePath === null) {
    return null
  }
  try {
    await access(filePath, constants.R_OK)
    return await readFile(filePath)
  } catch {
    return null
  }
}

/**
 * Guesses the Content-Type from a file name.
 * @param filename - File name
 * @returns Content-Type string
 */
export function guessContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const types: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    pdf: 'application/pdf',
    txt: 'text/plain',
    json: 'application/json',
    zip: 'application/zip',
  }
  return types[ext ?? ''] ?? 'application/octet-stream'
}
