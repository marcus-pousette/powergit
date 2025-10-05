import type { Page } from '@playwright/test'
import type { RepoFixturePayload } from '../../src/testing/fixtures'

export type { RepoFixturePayload } from '../../src/testing/fixtures'

const waitForPowerSync = async (page: Page) => {
  await page.waitForFunction(
    () =>
      typeof window !== 'undefined' &&
      Boolean((window as typeof window & { __powersyncSetRepoFixture?: unknown }).__powersyncSetRepoFixture),
    undefined,
    { timeout: 10_000 }
  )
}

export async function seedRepoFixtures(page: Page, payload: RepoFixturePayload): Promise<void> {
  await waitForPowerSync(page)
  await page.evaluate(({ payload }) => {
    const global = window as typeof window & {
      __powersyncClearRepoFixtures?: () => void
      __powersyncSetRepoFixture?: (fixture: RepoFixturePayload) => void
      __powersyncGetRepoFixtures?: () => Record<string, RepoFixturePayload>
    }
    if (!global.__powersyncSetRepoFixture) {
      throw new Error('PowerSync test fixture bridge is unavailable')
    }
    global.__powersyncClearRepoFixtures?.()
    global.__powersyncSetRepoFixture(payload)
    console.info('[seedRepoFixtures] store', global.__powersyncGetRepoFixtures?.())
  }, { payload })
}
