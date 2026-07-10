import { STORAGE_ROOT } from '@/config'
import fs from 'node:fs/promises'
import path from 'node:path'

const resolvedStorageRoot = path.resolve(STORAGE_ROOT)

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

/**
 * Join paths safely within STORAGE_ROOT. Rejects attempts to escape root.
 */
export function safeJoin(...segments: string[]) {
  const joined = path.join(resolvedStorageRoot, ...segments)
  const normalized = path.resolve(joined)
  const withinRoot =
    normalized === resolvedStorageRoot ||
    normalized.startsWith(resolvedStorageRoot + path.sep)
  if (!withinRoot) {
    throw new Error('Unsafe path')
  }
  return normalized
}
