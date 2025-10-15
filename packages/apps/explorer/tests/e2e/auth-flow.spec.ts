import { expect, test } from './diagnostics'
import { BASE_URL } from 'playwright.config'
import { installDaemonAuthStub, installSupabaseMock } from './utils'

const USER_EMAIL = 'dev@example.com'
const USER_PASSWORD = 'supersecret'
const VAULT_PASSPHRASE = 'correct-horse-battery-staple'

test.describe('Auth + Vault flow with daemon', () => {
  test('sign in, create vault, sign out, re-auth unlock', async ({ page }) => {
    page.on('response', (response) => {
      console.log('response', response.url(), response.status())
    })
    page.on('pageerror', (error) => {
      console.log('pageerror', error?.message ?? String(error))
    })
    await page.addInitScript(() => {
      ;(window as typeof window & { __powersyncRequireVault?: boolean }).__powersyncRequireVault = true
    })
    await installSupabaseMock(page, { email: USER_EMAIL })
    const daemon = await installDaemonAuthStub(page, { initialStatus: 'auth_required' })

    await page.goto(`${BASE_URL}/auth`)
    await page.waitForTimeout(200)
    const hasSupabaseMock = await page.evaluate(() => Boolean((window as typeof window & { __supabaseMock?: unknown }).__supabaseMock))
    expect(hasSupabaseMock).toBe(true)
    const hasRouter = await page.evaluate(() => Boolean((window as typeof window & { __appRouter?: unknown }).__appRouter))
    console.log('router present', hasRouter)
    const missingEnvMessage = await page.locator('text=Supabase environment missing').count()
    if (missingEnvMessage > 0) {
      throw new Error('Supabase environment missing screen rendered; mock configuration failed')
    }
    const authUnavailableMessage = await page.locator('text=Authentication unavailable').count()
    if (authUnavailableMessage > 0) {
      throw new Error('Supabase auth error screen rendered; check mock responses')
    }
    try {
      await expect(page.getByTestId('auth-heading')).toBeVisible()
    } catch (error) {
      const html = await page.content()
      console.log('page content snapshot', html)
      throw error
    }

    await page.fill('input[placeholder="Email"]', USER_EMAIL)
    await page.fill('input[placeholder="Password"]', USER_PASSWORD)
    await page.click('button:has-text("Sign In")')

    await page.waitForURL(`${BASE_URL}/vault`)
    daemon.setStatus('ready')

    const vaultHeading = page.getByTestId('vault-heading')
    await expect(vaultHeading).toContainText('Create your workspace vault')

    await page.fill('[data-testid="vault-passphrase-input"]', VAULT_PASSPHRASE)
    await page.fill('[data-testid="vault-confirm-passphrase-input"]', VAULT_PASSPHRASE)
    await page.click('[data-testid="vault-submit-button"]')

    await page.waitForURL(`${BASE_URL}/`)
    await expect(page.getByRole('heading', { name: 'Repo Explorer' })).toBeVisible()

    await page.click('button:has-text("Sign out")')
    await page.waitForURL(`${BASE_URL}/auth`)
    expect(daemon.getStatus().status).toBe('auth_required')

    await page.fill('input[placeholder="Email"]', USER_EMAIL)
    await page.fill('input[placeholder="Password"]', USER_PASSWORD)
    await page.click('button:has-text("Sign In")')

    await page.waitForURL(`${BASE_URL}/vault`)
    daemon.setStatus('ready')
    await expect(page.getByTestId('vault-heading')).toContainText('Unlock your workspace vault')

    await page.fill('[data-testid="vault-passphrase-input"]', VAULT_PASSPHRASE)
    await page.click('[data-testid="vault-submit-button"]')

    await page.waitForURL(`${BASE_URL}/`)
    await expect(page.getByRole('heading', { name: 'Repo Explorer' })).toBeVisible()
  })
})
