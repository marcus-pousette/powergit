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

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const consoleLines: string[] = []
    const pageErrors: string[] = []
    let fatalError: Error | null = null
    let rejectFatal: ((error: Error) => void) | null = null

    const fatalConsolePatterns: Array<{ regex: RegExp; message: string }> = [
      {
        regex: /ERR_CONNECTION_REFUSED/i,
        message: 'Browser failed to reach the dev server (ERR_CONNECTION_REFUSED)',
      },
      {
        regex: /server connection lost/i,
        message: 'Vite dev server reported a lost connection; it likely crashed or restarted',
      },
    ]

    const fatalPromise = new Promise<never>((_, reject) => {
      rejectFatal = reject
    })

    const triggerFatal = (reason: string, detail: string) => {
      if (fatalError) return
      fatalError = new Error(`${reason}. Latest message: ${detail}`)
      if (rejectFatal) {
        rejectFatal(fatalError)
        rejectFatal = null
      }
      void page.close().catch(() => undefined)
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
