import { gitStore } from './git-store'
import { downloadPackBytes, isDaemonPreferred } from './daemon-client'

if (typeof window !== 'undefined' && isDaemonPreferred()) {
  gitStore.setPackDownloader(async (pack) => {
    const bytes = await downloadPackBytes(pack.org_id, pack.repo_id, pack.pack_oid)
    if (!bytes) {
      throw new Error(`Failed to download pack ${pack.pack_oid}`)
    }
    return bytes
  })
}
