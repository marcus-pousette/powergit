import { gitStore } from './git-store'
import { downloadPackBytes, isDaemonPreferred } from './daemon-client'

const DEFAULT_SUPABASE_URL = 'http://127.0.0.1:55431'
const DEFAULT_PACK_BUCKET = 'git-packs'

function readEnvString(name: string): string | null {
  const env = import.meta.env as Record<string, string | undefined>
  const value = env[name]
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function buildPublicPackUrl(storageKey: string): string {
  const baseUrl = readEnvString('VITE_SUPABASE_URL') ?? DEFAULT_SUPABASE_URL
  const bucket = readEnvString('VITE_SUPABASE_STORAGE_BUCKET') ?? DEFAULT_PACK_BUCKET
  return `${baseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodePath(storageKey)}`
}

if (typeof window !== 'undefined') {
  if (isDaemonPreferred()) {
    gitStore.setPackDownloader(async (pack) => {
      const bytes = await downloadPackBytes(pack.org_id, pack.repo_id, pack.pack_oid)
      if (!bytes) {
        throw new Error(`Failed to download pack ${pack.pack_oid}`)
      }
      return bytes
    })
  } else {
    gitStore.setPackDownloader(async (pack) => {
      const storageKey = pack.storage_key?.trim()
      if (!storageKey) {
        throw new Error(`Missing storage_key for pack ${pack.pack_oid}`)
      }
      const url = buildPublicPackUrl(storageKey)
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`Pack download failed (${res.status})`)
      }
      return new Uint8Array(await res.arrayBuffer())
    })
  }
}
