import { test, expect } from '@playwright/test'
import { BASE_URL } from 'playwright.config'
import { seedRepoFixtures, type RepoFixturePayload } from './utils'

const ORG_ID = 'acme'
const REPO_ID = 'infra'

const REPO_FIXTURE: RepoFixturePayload = {
  orgId: ORG_ID,
  repoId: REPO_ID,
  branches: [
    { name: 'main', target_sha: 'f00baa11', updated_at: '2024-09-01T12:34:56Z' },
    { name: 'develop', target_sha: 'f00baa22', updated_at: '2024-09-02T08:15:00Z' },
  ],
  commits: [
    {
      sha: 'f00baa22deadbeef000000000000000000000002',
      author_name: 'Grace Hopper',
      author_email: 'grace@example.com',
      authored_at: '2024-09-03T09:00:00Z',
      message: 'Add replication logic',
      tree_sha: 'f00baa44',
    },
    {
      sha: 'f00baa11deadbeef000000000000000000000001',
      author_name: 'Ada Lovelace',
      author_email: 'ada@example.com',
      authored_at: '2024-09-01T12:34:56Z',
      message: 'Initial commit',
      tree_sha: 'f00baa33',
    },
  ],
  fileChanges: [
    {
      commit_sha: 'f00baa22deadbeef000000000000000000000002',
      path: 'src/replication.ts',
      additions: 120,
      deletions: 8,
    },
    {
      commit_sha: 'f00baa22deadbeef000000000000000000000002',
      path: 'README.md',
      additions: 10,
      deletions: 2,
    },
  ],
}

test.describe('Explorer smoke', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (message) => {
      console.log('[browser]', message.type(), message.text())
    })
  })

  test('shows repo branches from seeded data', async ({ page }) => {
    await page.goto(`${BASE_URL}/org/${ORG_ID}/repo/${REPO_ID}/branches`)
    await seedRepoFixtures(page, REPO_FIXTURE)
    console.log('branches url', await page.url())
    console.log('branches html snippet', (await page.content()).slice(0, 200))
    console.log('branches body', (await page.innerText('body')).slice(0, 200))
    console.log('branches matches', await page.evaluate(() => {
      const router = (window as typeof window & { __appRouter?: any }).__appRouter
      return router?.state?.matches?.map((match: any) => match.id)
    }))
    console.log('branches component', await page.evaluate(() => {
      const router = (window as typeof window & { __appRouter?: any }).__appRouter
      return router?.state?.matches?.[1]?.route?.options?.component ?? null
    }))

    await expect(page.getByText('Branches (acme/infra)')).toBeVisible()
    const branchItems = page.locator('ul.space-y-1 li')
    await expect(branchItems.filter({ hasText: 'main' })).toBeVisible()
    await expect(branchItems.filter({ hasText: 'develop' })).toBeVisible()

    const hashPrefixes = await branchItems.locator('span.font-mono').allTextContents()
    expect(hashPrefixes[0]).toContain('f00baa11'.slice(0, 7))
  })

  test('lists commits with author and message', async ({ page }) => {
    await page.goto(`${BASE_URL}/org/${ORG_ID}/repo/${REPO_ID}/commits`)
    await seedRepoFixtures(page, REPO_FIXTURE)
    console.log('commits url', await page.url())
    console.log('commits body', (await page.innerText('body')).slice(0, 200))
    console.log('commits matches', await page.evaluate(() => {
      const router = (window as typeof window & { __appRouter?: any }).__appRouter
      return router?.state?.matches?.map((match: any) => match.id)
    }))

    await expect(page.getByText('Commits (acme/infra)')).toBeVisible()
    const commitItems = page.locator('ul.space-y-2 li')
    const firstCommit = commitItems.first()
    await expect(firstCommit).toContainText('Add replication logic')
    await expect(firstCommit).toContainText('Grace Hopper')
    const commitHash = await firstCommit.locator('span.font-mono').innerText()
    expect(commitHash).toContain('f00baa22deadbeef000000000000000000000002'.slice(0, 7))
  })

  test('renders file changes summary', async ({ page }) => {
    await page.goto(`${BASE_URL}/org/${ORG_ID}/repo/${REPO_ID}/files`)
    await seedRepoFixtures(page, REPO_FIXTURE)
    console.log('files url', await page.url())
    console.log('files body', (await page.innerText('body')).slice(0, 200))
    console.log('files matches', await page.evaluate(() => {
      const router = (window as typeof window & { __appRouter?: any }).__appRouter
      return router?.state?.matches?.map((match: any) => match.id)
    }))

    await expect(page.getByText('Recent file changes (acme/infra)')).toBeVisible()
    await expect(page.locator('li').filter({ hasText: 'src/replication.ts' })).toContainText('+120')
    await expect(page.locator('li').filter({ hasText: 'README.md' })).toContainText('-2')
  })
})
