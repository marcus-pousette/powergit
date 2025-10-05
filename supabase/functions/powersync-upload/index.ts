import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

interface UploadPayload {
  operations: unknown[]
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    const body = (await req.json()) as UploadPayload
    if (!body || !Array.isArray(body.operations)) {
      return new Response('Invalid payload', { status: 400 })
    }

    console.log('[powersync-upload] received operations', body.operations.length)

    // TODO: Forward operations to PowerSync backend once available

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error('[powersync-upload] error', error)
    return new Response('Internal Server Error', { status: 500 })
  }
})


