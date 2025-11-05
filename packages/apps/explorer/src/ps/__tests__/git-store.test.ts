import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Buffer } from 'node:buffer'
import * as path from 'node:path'
import * as os from 'node:os'
import * as nodeFs from 'node:fs'
import * as git from 'isomorphic-git'
import { GitObjectStore, type PackRow } from '../git-store'

function installLocalStorageMock() {
  const store = new Map<string, string>()
  const localStorage = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
    removeItem(key: string) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
  ;(globalThis as unknown as { localStorage?: typeof localStorage }).localStorage = localStorage
  return () => store.clear()
}

async function createSamplePackBase64(): Promise<{ base64: string; commitOid: string }> {
  const dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'powersync-pack-'))
  const cleanup = () => {
    nodeFs.rmSync(dir, { recursive: true, force: true })
  }
  try {
    await git.init({ fs: nodeFs, dir })
    const filePath = path.join(dir, 'file.txt')
    await nodeFs.promises.writeFile(filePath, 'hello powersync\n', 'utf8')
    await git.add({ fs: nodeFs, dir, filepath: 'file.txt' })
    const author = {
      name: 'PowerSync',
      email: 'powersync@example.com',
      timestamp: Math.floor(Date.now() / 1000),
      timezoneOffset: 0,
    }
    await git.commit({
      fs: nodeFs,
      dir,
      message: 'Initial commit',
      author,
      committer: author,
    })
    const headOid = await git.resolveRef({ fs: nodeFs, dir, ref: 'HEAD' })
    const packResult = await git.packObjects({
      fs: nodeFs,
      dir,
      oids: [headOid],
    })
    const packfile =
      packResult instanceof Uint8Array ? packResult : (packResult as { packfile: Uint8Array }).packfile
    const base64 = Buffer.from(packfile).toString('base64')
    return { base64, commitOid: headOid }
  } finally {
    cleanup()
  }
}

describe('GitObjectStore', () => {
  let resetLocalStorage: (() => void) | null = null

  beforeEach(() => {
    resetLocalStorage = installLocalStorageMock()
  })

  it('indexes packs emitted by isomorphic-git without LightningFS read errors', async () => {
    const { base64 } = await createSamplePackBase64()
    const store = new GitObjectStore()
    const packRow: PackRow = {
      id: 'sample-pack',
      org_id: 'test-org',
      repo_id: 'test-repo',
      pack_oid: 'sample-pack',
      pack_bytes: base64,
      created_at: new Date().toISOString(),
    }
    await expect(store.indexPacks([packRow])).resolves.not.toThrow()
    expect(store.getProgress().status).toBe('ready')
  })

  it('can re-index the same pack without throwing', async () => {
    const { base64 } = await createSamplePackBase64()
    const store = new GitObjectStore()
    const packRow: PackRow = {
      id: 'sample-pack',
      org_id: 'test-org',
      repo_id: 'test-repo',
      pack_oid: 'repeat-pack',
      pack_bytes: base64,
      created_at: new Date().toISOString(),
    }
    await store.indexPacks([packRow])
    await expect(store.indexPacks([packRow])).resolves.not.toThrow()
    expect(store.getProgress().status).toBe('ready')
  })

  it('re-indexes packs after LightningFS persistence without cached bytes', async () => {
    const { base64 } = await createSamplePackBase64()
    const firstStore = new GitObjectStore()
    const packRow: PackRow = {
      id: 'persisted-pack',
      org_id: 'test-org',
      repo_id: 'test-repo',
      pack_oid: 'persisted-pack',
      pack_bytes: base64,
      created_at: new Date().toISOString(),
    }
    await firstStore.indexPacks([packRow])
    ;(globalThis as unknown as { localStorage: Storage }).localStorage.removeItem('powersync-git-store/indexed-packs')
    const secondStore = new GitObjectStore()
    await expect(secondStore.indexPacks([packRow])).resolves.not.toThrow()
    expect(secondStore.getProgress().status).toBe('ready')
  })

  afterEach(() => {
    if (resetLocalStorage) {
      resetLocalStorage()
    }
  })
})
