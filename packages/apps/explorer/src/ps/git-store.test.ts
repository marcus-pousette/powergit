import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GitObjectStore, type IndexProgress, type PackRow } from './git-store'

const BASE_PACK: Omit<PackRow, 'id' | 'pack_oid' | 'created_at'> = {
  org_id: 'org-1',
  repo_id: 'repo-1',
  pack_bytes: 'Zg==', // "f" in base64
}

const createPack = (packOid: string, createdAt = new Date().toISOString()): PackRow => ({
  id: `pack-${packOid}`,
  pack_oid: packOid,
  created_at: createdAt,
  ...BASE_PACK,
})

const cloneProgress = (progress: IndexProgress): IndexProgress => ({ ...progress })

describe('GitObjectStore indexing queue', () => {
  let store: GitObjectStore

  beforeEach(() => {
    store = new GitObjectStore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('processes queued packs sequentially and emits progress updates', async () => {
    const processMock = vi
      .spyOn(store as unknown as { processPack(pack: PackRow): Promise<void> }, 'processPack')
      .mockImplementation(async function mockProcess(this: GitObjectStore, pack: PackRow) {
        ;(this as unknown as { indexedPacks: Set<string> }).indexedPacks.add(pack.pack_oid)
      })
    const yieldMock = vi
      .spyOn(store as unknown as { yieldToBrowser(): Promise<void> }, 'yieldToBrowser')
      .mockResolvedValue(undefined)

    const updates: IndexProgress[] = []
    const unsubscribe = store.subscribe((progress) => {
      updates.push(cloneProgress(progress))
    })

    const packs = [createPack('a'), createPack('b'), createPack('c')]
    await store.indexPacks(packs)
    unsubscribe()

    expect(processMock).toHaveBeenCalledTimes(packs.length)
    expect(yieldMock).toHaveBeenCalledTimes(packs.length)
    expect(store.getProgress().status).toBe('ready')

    expect(updates[0]?.status).toBe('idle')
    const indexingUpdate = updates.find((entry) => entry.status === 'indexing')
    expect(indexingUpdate).toBeDefined()
    expect(indexingUpdate?.total).toBe(packs.length)
    expect(updates.at(-1)?.status).toBe('ready')
  })

  it('skips packs that are already indexed and only processes new oids', async () => {
    const processMock = vi
      .spyOn(store as unknown as { processPack(pack: PackRow): Promise<void> }, 'processPack')
      .mockImplementation(async function mockProcess(this: GitObjectStore, pack: PackRow) {
        ;(this as unknown as { indexedPacks: Set<string> }).indexedPacks.add(pack.pack_oid)
      })
    vi.spyOn(store as unknown as { yieldToBrowser(): Promise<void> }, 'yieldToBrowser').mockResolvedValue(undefined)

    await store.indexPacks([createPack('alpha')])
    expect(processMock).toHaveBeenCalledTimes(1)

    processMock.mockClear()
    const updates: IndexProgress[] = []
    const unsubscribe = store.subscribe((progress) => {
      updates.push(cloneProgress(progress))
    })

    await store.indexPacks([createPack('alpha'), createPack('bravo')])
    unsubscribe()

    expect(processMock).toHaveBeenCalledTimes(1)
    expect(processMock).toHaveBeenCalledWith(expect.objectContaining({ pack_oid: 'bravo' }))
    const indexingTotals = updates
      .filter((entry) => entry.status === 'indexing')
      .map((entry) => entry.total)
    expect(indexingTotals).toContain(1)
    expect(store.getProgress().status).toBe('ready')
  })
})
