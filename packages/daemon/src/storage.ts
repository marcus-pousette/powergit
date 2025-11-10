import type { SupabaseClient } from '@supabase/supabase-js'

export interface PackStorageOptions {
  bucket: string
  baseUrl: string
  signExpiresIn?: number
}

const MIN_SIGN_TTL = 15

export class PackStorage {
  private readonly bucket: string
  private readonly baseUrl: string
  private readonly signTtl: number

  constructor(private readonly client: SupabaseClient, options: PackStorageOptions) {
    this.bucket = options.bucket
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.signTtl = Math.max(MIN_SIGN_TTL, options.signExpiresIn ?? 60)
  }

  async ensureBucket(): Promise<void> {
    const { data, error } = await this.client.storage.getBucket(this.bucket)
    if (data) return
    if (error && !String(error.message ?? '').toLowerCase().includes('not found')) {
      throw error
    }
    const { error: createError } = await this.client.storage.createBucket(this.bucket, { public: false })
    if (createError && !String(createError.message ?? '').includes('already exists')) {
      throw createError
    }
  }

  async uploadPack(key: string, contents: Uint8Array | Buffer): Promise<number> {
    const payload = contents instanceof Uint8Array ? contents : new Uint8Array(contents)
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(key, payload, { contentType: 'application/octet-stream', upsert: true })
    if (error) {
      throw error
    }
    return payload.byteLength
  }

  async createSignedUrl(key: string): Promise<{ url: string; expiresAt: string } | null> {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(key, this.signTtl)
    if (error || !data?.signedUrl) {
      return null
    }
    const signedUrl = data.signedUrl.startsWith('http') ? data.signedUrl : `${this.baseUrl}${data.signedUrl}`
    const expiresAt = new Date(Date.now() + this.signTtl * 1000).toISOString()
    return { url: signedUrl, expiresAt }
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (!keys.length) return
    const { error } = await this.client.storage.from(this.bucket).remove(keys)
    if (error) {
      throw error
    }
  }
}
