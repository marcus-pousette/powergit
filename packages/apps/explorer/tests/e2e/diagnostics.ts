import { test as base, expect, type ConsoleMessage } from '@playwright/test'

function formatConsoleMessage(message: string, type: string, location?: string) {
  const prefix = `[console.${type}]`
  return location ? `${prefix} ${message} (@ ${location})` : `${prefix} ${message}`
}

function formatLocation(url?: string, lineNumber?: number, columnNumber?: number) {
  if (!url) return undefined
  const parts = [url]
  if (typeof lineNumber === 'number') {
    const line = lineNumber + 1
    if (typeof columnNumber === 'number') {
      const column = columnNumber + 1
      parts.push(`${line}:${column}`)
    } else {
      parts.push(`${line}`)
    }
  }
  return parts.join(':')
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function isHttpReachable(url: string, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    })
    return res.ok || (res.status >= 300 && res.status < 500)
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const consoleLines: string[] = []
    const pageErrors: string[] = []
    let fatalError: Error | null = null
    let resolveFatal: (() => void) | null = null
    let active = true
    let viteLostConnectionCheckInFlight = false

    const fatalConsolePatterns: Array<{ regex: RegExp; message: string }> = [
      {
        regex: /ERR_CONNECTION_REFUSED/i,
        message: 'Browser failed to reach the dev server (ERR_CONNECTION_REFUSED)',
      },
    ]

    const fatalPromise = new Promise<void>((resolve) => {
      resolveFatal = resolve
    })

    const triggerFatal = (reason: string, detail: string) => {
      if (!active || fatalError) return
      fatalError = new Error(`${reason}. Latest message: ${detail}`)
      if (resolveFatal) {
        resolveFatal()
        resolveFatal = null
      }
      void page.close().catch(() => undefined)
    }

    const checkViteConnectionLoss = async (detail: string) => {
      if (viteLostConnectionCheckInFlight) return
      viteLostConnectionCheckInFlight = true
      try {
        const pageUrl = page.url()
        if (!pageUrl.startsWith('http')) return
        const origin = new URL(pageUrl).origin

        const deadline = Date.now() + 15_000
        while (active && Date.now() < deadline) {
          if (await isHttpReachable(origin, 1_500)) {
            return
          }
          await sleep(500)
        }

        triggerFatal(
          'Vite dev server reported a lost connection and remained unreachable',
          detail,
        )
      } finally {
        viteLostConnectionCheckInFlight = false
      }
    }

    const handleConsole = (msg: ConsoleMessage) => {
      const loc = msg.location()
      const formattedLocation = formatLocation(loc?.url, loc?.lineNumber, loc?.columnNumber)
      const text = msg.text()
      const type = msg.type()
      const formatted = formatConsoleMessage(text, type, formattedLocation)
      if (type === 'error' || type === 'warning') {
        consoleLines.push(formatted)
      }
      for (const pattern of fatalConsolePatterns) {
        if (pattern.regex.test(text)) {
          triggerFatal(pattern.message, formatted)
          break
        }
      }
      if (/server connection lost/i.test(text)) {
        void checkViteConnectionLoss(formatted)
      }
      // Always surface the message in the worker output for quick diagnosis
      console.log(formatted)
    }

    const handlePageError = (error: Error) => {
      const formatted = `[pageerror] ${error.message}`
      pageErrors.push(formatted)
      console.log(formatted)
      if (error.stack) {
        console.log(error.stack)
      }
      if (/ERR_CONNECTION_REFUSED/i.test(error.message)) {
        triggerFatal('Page error indicates the dev server became unavailable', formatted)
      }
    }

    page.on('console', handleConsole)
    page.on('pageerror', handlePageError)

    try {
      await Promise.race([use(page), fatalPromise])
    } catch (error) {
      if (fatalError) {
        throw fatalError
      }
      throw error
    } finally {
      active = false
      page.off('console', handleConsole)
      page.off('pageerror', handlePageError)

      if (consoleLines.length > 0) {
        await testInfo.attach('console-errors', {
          body: consoleLines.join('\n'),
          contentType: 'text/plain',
        })
      }
      if (pageErrors.length > 0) {
        await testInfo.attach('page-errors', {
          body: pageErrors.join('\n'),
          contentType: 'text/plain',
        })
      }
    }

    if (fatalError) {
      throw fatalError
    }
  },
})

export { expect }
