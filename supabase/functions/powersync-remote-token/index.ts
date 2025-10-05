import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

interface RemoteTokenRequest {
  remoteUrl?: string
}

interface RemoteTokenResponse {
  token: string
}

const DEFAULT_REMOTE_TOKEN = Deno.env.get('POWERSYNC_REMOTE_TOKEN') ?? 'remote-token-placeholder'

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as RemoteTokenRequest
    console.log('[powersync-remote-token] request for', body.remoteUrl)

    const result: RemoteTokenResponse = {
      token: DEFAULT_REMOTE_TOKEN,
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error('[powersync-remote-token] error', error)
    return new Response('Internal Server Error', { status: 500 })
  }
})


