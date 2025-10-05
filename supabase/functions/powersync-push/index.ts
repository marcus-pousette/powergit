import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

interface PushMetadata {
  org: string
  repo: string
  updates: Array<{ src: string; dst: string; force?: boolean }>
  pack?: string
  packEncoding?: string
}

interface PushResponse {
  ok: boolean
  results: Record<string, { status: 'ok' | 'error'; message?: string }>
}


serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const expected = Deno.env.get('POWERSYNC_SUPABASE_SERVICE_ROLE_KEY')
  if (!token || (expected && token !== expected)) {
    return Response.json({ msg: 'Invalid token' }, { status: 401 })
  }

  // Skip Supabase JWT verification locally (handled via function.toml verify_jwt=false).

  const contentType = (req.headers.get('content-type') ?? '').replace(/;.*$/, '').trim()

  try {
    let metadata: PushMetadata | null = null
    let packFile: File | null = null

    if (contentType === 'application/json') {
      metadata = await req.json() as PushMetadata
    } else {
      if (!contentType.includes('multipart/form-data')) {
        return new Response('Expected multipart/form-data payload', { status: 400 })
      }
      const form = await req.formData()
      const metadataRaw = form.get('metadata')
      const pack = form.get('pack')

      if (typeof metadataRaw !== 'string') {
        return new Response('Missing metadata field', { status: 400 })
      }

      try {
        metadata = JSON.parse(metadataRaw) as PushMetadata
      } catch (error) {
        console.error('[powersync-push] failed to parse metadata', error)
        return new Response('Invalid metadata JSON', { status: 400 })
      }

      if (pack instanceof File) packFile = pack
    }

    if (!metadata) {
      return new Response('Invalid metadata payload', { status: 400 })
    }

    const updates = Array.isArray(metadata.updates) ? metadata.updates : []
    console.log('[powersync-push] received push', {
      org: metadata.org,
      repo: metadata.repo,
      updates: updates.length,
      hasPack: Boolean(packFile || metadata.pack),
    })

    if (packFile) {
      console.log('[powersync-push] pack size bytes', packFile.size)
      await packFile.arrayBuffer()
    } else if (metadata.pack) {
      const buffer = Buffer.from(metadata.pack, (metadata.packEncoding as BufferEncoding) || 'base64')
      console.log('[powersync-push] decoded inline pack bytes', buffer.length)
    }

    const response: PushResponse = {
      ok: true,
      results: Object.fromEntries(
        updates.map((update) => [update.dst ?? '', { status: 'ok' as const }])
      ),
    }

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error('[powersync-push] error', error)
    return new Response('Internal Server Error', { status: 500 })
  }
})

