import { test, expect } from '@playwright/test'
import { BASE_URL } from 'playwright.config'

const ORG_ID = 'acme'

test.describe('Explorer smoke', () => {
  test('navigates from home to org activity', async ({ page }) => {
    await page.goto(BASE_URL)

    await expect(page.getByRole('heading', { level: 2, name: 'Welcome' })).toBeVisible()
    await expect(page.getByText('Pick an org to view activity.')).toBeVisible()

    await page.getByRole('link', { name: 'Go to org "acme" →' }).click()

    await expect(page).toHaveURL(`/org/${ORG_ID}`)
    await expect(page.getByRole('heading', { level: 2, name: `Org: ${ORG_ID} — Activity` })).toBeVisible()
    await expect(page.getByText('Loading…')).toBeVisible()
  })
})
