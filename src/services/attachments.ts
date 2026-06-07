/**
 * ファイル添付サービス
 *
 * 添付ファイルの保存・配信を処理します。
 */

import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import path from 'node:path'
import { constants } from 'node:fs'
import type { Database } from '../db.js'

/** 添付ファイルの最大サイズ（25MB） */
export const MAX_FILE_SIZE = 25 * 1024 * 1024

/** 添付ファイル情報の型 */
export interface AttachmentInfo {
  id: string
  filename: string
  size: number
  contentType: string
  url: string
  proxyUrl: string
}

/**
 * ファイルを保存して添付ファイル情報をDBに記録します。
 * @param db - データベース
 * @param uploadPath - アップロードベースディレクトリ
 * @param baseUrl - ベースURL
 * @param channelId - チャンネルID
 * @param messageId - メッセージID
 * @param attachmentId - 添付ファイルID
 * @param filename - ファイル名
 * @param contentType - Content-Type
 * @param data - ファイルデータ
 * @returns 添付ファイル情報
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

  // ArrayBuffer / Uint8Array のいずれでも受け取れるよう Buffer に正規化する
  const buffer =
    data instanceof Uint8Array
      ? Buffer.from(data)
      : Buffer.from(new Uint8Array(data))

  const filePath = path.join(dir, filename)
  await writeFile(filePath, buffer)

  const size = buffer.byteLength

  // DBに記録
  const relativePath = path.join(channelId, messageId, filename)
  db.prepare(
    `INSERT INTO attachments (id, message_id, filename, size, content_type, file_path)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(attachmentId, messageId, filename, size, contentType, relativePath)

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
 * 添付ファイルを読み込みます。
 * @param uploadPath - アップロードベースディレクトリ
 * @param channelId - チャンネルID
 * @param messageId - メッセージID
 * @param filename - ファイル名
 * @returns ファイルデータまたはNull（存在しない場合）
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
 * ファイル名からContent-Typeを推定します。
 * @param filename - ファイル名
 * @returns Content-Type文字列
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
