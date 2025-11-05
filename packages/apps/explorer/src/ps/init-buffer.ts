import { Buffer as PolyfillBuffer } from 'buffer'

declare global {
  // eslint-disable-next-line no-var
  var Buffer: typeof PolyfillBuffer | undefined
}

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = PolyfillBuffer
}

export const Buffer = globalThis.Buffer

