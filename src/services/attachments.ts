/**
 * File attachment service
 *
 * Handles saving and serving attachments.
 */

import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import path from 'node:path'
import { constants } from 'node:fs'
import type { Database } from '../database'

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
 * @param database - Database
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
  database: Database,
  uploadPath: string,
  baseUrl: string,
  channelId: string,
  messageId: string,
  attachmentId: string,
  filename: string,
  contentType: string,
  data: ArrayBuffer | Uint8Array
): Promise<AttachmentInfo> {
  const direction = path.join(uploadPath, channelId, messageId)
  await mkdir(direction, { recursive: true })

  // Normalize to Buffer so both ArrayBuffer and Uint8Array are accepted
  const buffer =
    data instanceof Uint8Array
      ? Buffer.from(data)
      : Buffer.from(new Uint8Array(data))

  const filePath = path.join(direction, filename)
  await writeFile(filePath, buffer)

  const size = buffer.byteLength

  const relativePath = path.join(channelId, messageId, filename)
  database
    .prepare(
      `INSERT INTO attachments (id, message_id, filename, size, content_type, file_path)
     VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(attachmentId, messageId, filename, size, contentType, relativePath)

  const url = `${baseUrl}/_mock/attachments/${channelId}/${messageId}/${filename}`

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
 * Reads an attachment file.
 * @param uploadPath - Upload base directory
 * @param channelId - Channel ID
 * @param messageId - Message ID
 * @param filename - File name
 * @returns File data, or null if it does not exist
 */
export async function getAttachment(
  uploadPath: string,
  channelId: string,
  messageId: string,
  filename: string
): Promise<Buffer | null> {
  const filePath = path.join(uploadPath, channelId, messageId, filename)
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
  const extension = filename.split('.').pop()?.toLowerCase()
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
  return types[extension ?? ''] ?? 'application/octet-stream'
}
