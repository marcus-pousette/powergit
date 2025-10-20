import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const resolveFromRoot = (relativePath: string) =>
  resolve(__dirname, relativePath)

export default defineConfig({
  resolve: {
    alias: {
      '@ps': resolveFromRoot('src/ps'),
      '@tsdb': resolveFromRoot('src/tsdb'),
      '@shared/core/powersync/schema': resolveFromRoot('../../shared/src/powersync/schema.ts'),
      '@shared/core/powersync/raw-tables': resolveFromRoot('../../shared/src/powersync/raw-tables.ts'),
      '@shared/core/powersync/streams': resolveFromRoot('../../shared/src/powersync/streams.ts'),
      '@shared/core/': `${resolveFromRoot('../../shared/src')}/`,
      '@shared/core': resolveFromRoot('../../shared/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: true,
    setupFiles: [],
    coverage: {
      provider: 'istanbul',
    },
  },
})
