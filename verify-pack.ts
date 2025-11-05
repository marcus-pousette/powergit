import * as git from 'isomorphic-git'
import LightningFS from '@isomorphic-git/lightning-fs'
import fs from 'fs'

const source = fs.readFileSync('tmp.pack')
const memoryFs = new LightningFS('test-pack').promises
await memoryFs.mkdir('/.git').catch(() => undefined)
await memoryFs.mkdir('/.git/objects').catch(() => undefined)

await git.indexPack({
  fs: memoryFs,
  dir: '/',
  gitdir: '/.git',
  packfile: new Uint8Array(source),
})
console.log('index pack succeeded')
