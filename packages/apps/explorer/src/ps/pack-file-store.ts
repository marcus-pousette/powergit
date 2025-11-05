type PackEntry = {
  data: Uint8Array
  mtimeMs: number
}

const PACK_SUFFIX = '.pack'

export class PackFileStore {
  private readonly entries = new Map<string, PackEntry>()

  handles(path: string): boolean {
    return path.endsWith(PACK_SUFFIX)
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    this.entries.set(path, {
      data: data.slice(),
      mtimeMs: Date.now(),
    })
  }

  async read(path: string): Promise<Uint8Array> {
    const entry = this.entries.get(path)
    if (!entry) {
      throw this.createError(path, 'ENOENT')
    }
    return entry.data.slice()
  }

  async stat(path: string): Promise<{ size: number; mtimeMs: number }> {
    const entry = this.entries.get(path)
    if (!entry) {
      throw this.createError(path, 'ENOENT')
    }
    return {
      size: entry.data.byteLength,
      mtimeMs: entry.mtimeMs,
    }
  }

  async delete(path: string): Promise<void> {
    this.entries.delete(path)
  }

  async move(oldPath: string, newPath: string): Promise<void> {
    const entry = this.entries.get(oldPath)
    if (!entry) {
      throw this.createError(oldPath, 'ENOENT')
    }
    this.entries.set(newPath, { data: entry.data, mtimeMs: Date.now() })
    this.entries.delete(oldPath)
  }

  private createError(path: string, code: string): NodeJS.ErrnoException {
    const error = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException
    error.code = code
    return error
  }
}
