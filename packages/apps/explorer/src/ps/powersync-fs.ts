import { PackFileStore } from './pack-file-store'
import './init-buffer'

type DirectoryNode = {
  type: 'dir'
  entries: Map<string, FsNode>
  mode: number
  mtimeMs: number
}

type FileNode = {
  type: 'file'
  data: Uint8Array | null
  mode: number
  mtimeMs: number
  size: number
  external?: boolean
}

type FsNode = DirectoryNode | FileNode

class FsStat {
  constructor(private readonly node: FsNode) {}

  isFile(): boolean {
    return this.node.type === 'file'
  }

  isDirectory(): boolean {
    return this.node.type === 'dir'
  }

  isSymbolicLink(): boolean {
    return false
  }

  get size(): number {
    return this.node.type === 'file' ? this.node.size : 0
  }

  get mode(): number {
    return this.node.mode
  }

  get mtimeMs(): number {
    return this.node.mtimeMs
  }
}

const ENOENT = 'ENOENT'
const ENOTDIR = 'ENOTDIR'
const EISDIR = 'EISDIR'
const ENOTEMPTY = 'ENOTEMPTY'
const EEXIST = 'EEXIST'
const ENOSYS = 'ENOSYS'

type MkdirOptions = {
  mode?: number
}

export class PowerSyncFs {
  private readonly packStore: PackFileStore | null
  private readonly root: DirectoryNode = {
    type: 'dir',
    entries: new Map(),
    mode: 0o777,
    mtimeMs: Date.now(),
  }

  constructor(options: { packStore?: PackFileStore } = {}) {
    this.packStore = options.packStore ?? null
  }

  private normalize(path: string): string {
    if (!path) return '/'
    let normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/').trim()
    if (normalized === '') return '/'
    if (!normalized.startsWith('/')) {
      normalized = `/${normalized}`
    }
    // collapse "./" segments and resolve ".."
    const segments = [] as string[]
    for (const segment of normalized.split('/')) {
      if (!segment || segment === '.') continue
      if (segment === '..') {
        if (segments.length > 0) segments.pop()
        continue
      }
      segments.push(segment)
    }
    return `/${segments.join('/')}`
  }

  private getParent(path: string): { parent: DirectoryNode; name: string } {
    const normalized = this.normalize(path)
    const parts = normalized.split('/').filter(Boolean)
    if (parts.length === 0) {
      throw this.createError('Invalid path', EEXIST)
    }
    const name = parts.pop()!
    const parentPath = `/${parts.join('/')}`
    const parentNode = this.traverse(parentPath)
    if (!parentNode || parentNode.type !== 'dir') {
      throw this.createError(`Not a directory: ${parentPath || '/'}`, ENOTDIR)
    }
    return { parent: parentNode, name }
  }

  private traverse(path: string): FsNode | null {
    const normalized = this.normalize(path)
    if (normalized === '/') return this.root
    const parts = normalized.split('/').filter(Boolean)
    let current: FsNode = this.root
    for (const part of parts) {
      if (current.type !== 'dir') {
        return null
      }
      const next = current.entries.get(part)
      if (!next) return null
      current = next
    }
    return current
  }

  private createError(message: string, code: string): NodeJS.ErrnoException {
    const error = new Error(message) as NodeJS.ErrnoException
    error.code = code
    return error
  }

  async readFile(path: string, options?: { encoding?: string | null }): Promise<Uint8Array | string> {
    const normalized = this.normalize(path)
    const node = this.traverse(normalized)
    if (!node) {
      throw this.createError(`ENOENT: no such file or directory, read '${path}'`, ENOENT)
    }
    if (node.type !== 'file') {
      throw this.createError(`EISDIR: illegal operation on a directory, read`, EISDIR)
    }
    let view: Uint8Array
    if (node.external) {
      if (!this.packStore) {
        throw this.createError(`ENOENT: no such file or directory, read '${path}'`, ENOENT)
      }
      view = await this.packStore.read(normalized)
      node.size = view.byteLength
    } else {
      if (!node.data) {
        throw this.createError(`ENOENT: no such file or directory, read '${path}'`, ENOENT)
      }
      view = node.data.slice()
    }
    const encoding = typeof options === 'string' ? options : options?.encoding
    if (!encoding || encoding === 'buffer' || encoding === 'binary' || encoding === null) {
      return view
    }
    if (encoding === 'utf8' || encoding === 'utf-8') {
      return new TextDecoder().decode(view)
    }
    throw this.createError(`Unsupported encoding: ${encoding}`, 'ERR_INVALID_OPT_VALUE_ENCODING')
  }

  async writeFile(
    path: string,
    data: Uint8Array | Buffer | string,
    options?: { encoding?: string | null; mode?: number },
  ) {
    const normalized = this.normalize(path)
    const { parent, name } = this.getParent(normalized)
    let buffer: Uint8Array
    if (data instanceof Uint8Array) {
      buffer = data
    } else if (typeof data === 'string') {
      const encoding = options?.encoding ?? 'utf8'
      if (encoding && encoding !== 'utf8' && encoding !== 'utf-8') {
        throw this.createError(`Unsupported encoding: ${encoding}`, 'ERR_INVALID_OPT_VALUE_ENCODING')
      }
      buffer = new TextEncoder().encode(data)
    } else {
      buffer = new Uint8Array(data)
    }
    const now = Date.now()
    const isExternal = this.packStore?.handles(normalized) ?? false
    if (isExternal && this.packStore) {
      const copy = buffer.slice()
      await this.packStore.write(normalized, copy)
      parent.entries.set(name, {
        type: 'file',
        data: null,
        mode: options?.mode ?? 0o666,
        mtimeMs: now,
        size: copy.byteLength,
        external: true,
      })
      parent.mtimeMs = now
      return
    }
    const stored = buffer.slice()
    parent.entries.set(name, {
      type: 'file',
      data: stored,
      mode: options?.mode ?? 0o666,
      mtimeMs: now,
      size: stored.byteLength,
      external: false,
    })
    parent.mtimeMs = now
  }

  async unlink(path: string) {
    const normalized = this.normalize(path)
    const { parent, name } = this.getParent(normalized)
    const node = parent.entries.get(name)
    if (!node) {
      throw this.createError(`ENOENT: no such file or directory, unlink '${path}'`, ENOENT)
    }
    if (node.type === 'dir') {
      throw this.createError('EISDIR: illegal operation on a directory', EISDIR)
    }
    if (node.external && this.packStore) {
      await this.packStore.delete(normalized)
    }
    parent.entries.delete(name)
    parent.mtimeMs = Date.now()
  }

  async readdir(path: string): Promise<string[]> {
    const node = this.traverse(path)
    if (!node) {
      throw this.createError(`ENOENT: no such file or directory, scandir '${path}'`, ENOENT)
    }
    if (node.type !== 'dir') {
      throw this.createError('ENOTDIR: not a directory', ENOTDIR)
    }
    return [...node.entries.keys()]
  }

  async mkdir(path: string, options: MkdirOptions = {}) {
    const normalized = this.normalize(path)
    if (normalized === '/') return
    const parts = normalized.split('/').filter(Boolean)
    let current: DirectoryNode = this.root
    for (const part of parts) {
      let child = current.entries.get(part)
      if (!child) {
        const newDir: DirectoryNode = {
          type: 'dir',
          entries: new Map(),
          mode: options.mode ?? 0o777,
          mtimeMs: Date.now(),
        }
        current.entries.set(part, newDir)
        current = newDir
        continue
      }
      if (child.type !== 'dir') {
        throw this.createError('ENOTDIR: not a directory', ENOTDIR)
      }
      current = child
    }
  }

  async rmdir(path: string) {
    const normalized = this.normalize(path)
    const { parent, name } = this.getParent(normalized)
    const node = parent.entries.get(name)
    if (!node) {
      throw this.createError(`ENOENT: no such file or directory, rmdir '${path}'`, ENOENT)
    }
    if (node.type !== 'dir') {
      throw this.createError('ENOTDIR: not a directory', ENOTDIR)
    }
    if (node.entries.size > 0) {
      throw this.createError('ENOTEMPTY: directory not empty', ENOTEMPTY)
    }
    parent.entries.delete(name)
    parent.mtimeMs = Date.now()
  }

  async rename(oldPath: string, newPath: string) {
    const normalizedOld = this.normalize(oldPath)
    const normalizedNew = this.normalize(newPath)
    const { parent: oldParent, name: oldName } = this.getParent(normalizedOld)
    const node = oldParent.entries.get(oldName)
    if (!node) {
      throw this.createError(`ENOENT: no such file or directory, rename '${oldPath}'`, ENOENT)
    }
    const { parent: newParent, name: newName } = this.getParent(normalizedNew)
    if (newParent.entries.has(newName)) {
      throw this.createError('EEXIST: file already exists', EEXIST)
    }
    if (node.type === 'file' && node.external && this.packStore) {
      await this.packStore.move(normalizedOld, normalizedNew)
    }
    oldParent.entries.delete(oldName)
    newParent.entries.set(newName, node)
    const now = Date.now()
    oldParent.mtimeMs = now
    newParent.mtimeMs = now
  }

  async readlink(): Promise<never> {
    throw this.createError('readlink not implemented', ENOSYS)
  }

  async symlink(): Promise<never> {
    throw this.createError('symlink not implemented', ENOSYS)
  }

  async stat(path: string): Promise<FsStat> {
    const normalized = this.normalize(path)
    const node = this.traverse(normalized)
    if (!node) {
      throw this.createError(`ENOENT: no such file or directory, stat '${path}'`, ENOENT)
    }
    if (node.type === 'file' && node.external && this.packStore) {
      try {
        const { size, mtimeMs } = await this.packStore.stat(normalized)
        node.size = size
        node.mtimeMs = mtimeMs
      } catch {
        // fall through with existing metadata
      }
    }
    return new FsStat(node)
  }

  async lstat(path: string): Promise<FsStat> {
    return this.stat(path)
  }

  async read(path: string, options?: { encoding?: string | null }) {
    return this.readFile(path, options)
  }

  async write(path: string, data: Uint8Array | Buffer | string, options?: { encoding?: string | null; mode?: number }) {
    await this.writeFile(path, data, options)
  }

  async rm(path: string, options?: { recursive?: boolean }) {
    const node = this.traverse(path)
    if (!node) {
      if (options?.recursive) return
      throw this.createError(`ENOENT: no such file or directory, rm '${path}'`, ENOENT)
    }
    if (node.type === 'file') {
      await this.unlink(path)
      return
    }
    if (!options?.recursive && node.entries.size > 0) {
      throw this.createError('ENOTEMPTY: directory not empty', ENOTEMPTY)
    }
    for (const [name] of [...node.entries]) {
      await this.rm(`${this.normalize(path)}/${name}`, options)
    }
    await this.rmdir(path)
  }
}

export type PowerSyncFsPromises = PowerSyncFs
