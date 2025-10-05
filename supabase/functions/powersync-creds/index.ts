import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

interface CredentialResponse {
  endpoint: string
  token: string
}

const DEFAULT_ENDPOINT = Deno.env.get('POWERSYNC_ENDPOINT') ?? 'http://localhost:8090'
const DEFAULT_TOKEN = Deno.env.get('POWERSYNC_TOKEN') ?? 'dev-token-placeholder'

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    console.log('[powersync-creds] request', body)

    const payload: CredentialResponse = {
      endpoint: DEFAULT_ENDPOINT,
      token: DEFAULT_TOKEN,
    }

    return new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error('[powersync-creds] error', error)
    return new Response('Internal Server Error', { status: 500 })
  }
})


