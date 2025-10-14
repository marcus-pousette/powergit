#!/usr/bin/env node
console.error('[bin] using ts entry')

async function main() {
  const moduleUrl = new URL('./index.js', import.meta.url)
  const { runHelper } = await import(moduleUrl.href)
  await runHelper()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
