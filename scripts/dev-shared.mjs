import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const DEFAULT_DAEMON_URL = 'http://127.0.0.1:5030'

export function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '')
}

export function resolveDaemonBaseUrl(env) {
  return (
    env?.POWERSYNC_DAEMON_URL ??
    env?.POWERSYNC_DAEMON_ENDPOINT ??
    process.env.POWERSYNC_DAEMON_URL ??
    process.env.POWERSYNC_DAEMON_ENDPOINT ??
    DEFAULT_DAEMON_URL
  )
}

export async function isDaemonResponsive(baseUrl, timeoutMs = 2000) {
  const target = `${normalizeBaseUrl(baseUrl)}/health`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(target, { signal: controller.signal })
    clearTimeout(timeout)
    return response.ok
  } catch {
    clearTimeout(timeout)
    return false
  }
}

export async function stopDaemon(baseUrl, timeoutMs = 4000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await fetch(`${normalizeBaseUrl(baseUrl)}/shutdown`, {
      method: 'POST',
      signal: controller.signal,
    })
  } catch {
    // daemon may already be offline
  } finally {
    clearTimeout(timeout)
  }
}

export function runGuestLogin({ env, repoRoot, stdio = ['inherit', 'pipe', 'pipe'] }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('pnpm', ['--filter', '@pkg/cli', 'cli', 'login', '--guest'], {
      cwd: repoRoot,
      stdio,
      env,
    })
    child.on('error', (error) => rejectPromise(error))
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise()
      } else {
        rejectPromise(new Error(`pnpm cli login --guest exited with code ${code}`))
      }
    })
  })
}

function normalizeToken(raw) {
  if (!raw) return null
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof raw === 'object') {
    const fromToken = typeof raw.token === 'string' ? raw.token.trim() : ''
    if (fromToken) return fromToken
    const fromValue = typeof raw.value === 'string' ? raw.value.trim() : ''
    if (fromValue) return fromValue
  }
  return null
}

function normalizeContext(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw
}

export function normalizeDaemonStatus(payload) {
  if (!payload) return null
  switch (payload.status) {
    case 'ready': {
      const token = normalizeToken(payload.token)
      if (!token) return null
      return {
        status: 'ready',
        token,
        expiresAt: payload.expiresAt ?? null,
        context: normalizeContext(payload.context),
      }
    }
    case 'pending':
      return { status: 'pending', reason: payload.reason ?? null, context: normalizeContext(payload.context) }
    case 'auth_required':
      return { status: 'auth_required', reason: payload.reason ?? null, context: normalizeContext(payload.context) }
    case 'error':
      return { status: 'error', reason: payload.reason ?? null, context: normalizeContext(payload.context) }
    default:
      return null
  }
}

export async function fetchDaemonStatus(baseUrl) {
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/auth/status`)
    if (!response.ok) return null
    const payload = await response.json()
    return normalizeDaemonStatus(payload)
  } catch {
    return null
  }
}

export function shouldRefreshDaemonStatus(status) {
  if (!status || status.status !== 'ready') return true
  if (status.expiresAt) {
    const expires = Number.isNaN(Date.parse(status.expiresAt)) ? null : Date.parse(status.expiresAt)
    if (expires && expires <= Date.now() + 120000) {
      return true
    }
  }
  return false
}

export function isJwtExpired(token, skewMs = 0) {
  if (!token || typeof token !== 'string') return false
  const parts = token.split('.')
  if (parts.length < 2) return false
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (payload && typeof payload.exp === 'number') {
      const expiresAt = payload.exp * 1000
      return Number.isFinite(expiresAt) && expiresAt <= Date.now() + skewMs
    }
  } catch {
    return false
  }
  return false
}

export async function refreshDaemonToken({ env, repoRoot, logger = console }) {
  const baseUrl = resolveDaemonBaseUrl(env)
  const initialStatus = await fetchDaemonStatus(baseUrl)
  if (!shouldRefreshDaemonStatus(initialStatus)) {
    return { status: initialStatus, refreshed: false }
  }

  logger.info('[dev] refreshing daemon guest credentials…')
  try {
    await runGuestLogin({ env, repoRoot })
  } catch (error) {
    logger.warn('[dev] failed to refresh daemon guest credentials:', error instanceof Error ? error.message : error)
    return { status: initialStatus, refreshed: true }
  }

  const refreshedStatus = await fetchDaemonStatus(baseUrl)
  if (refreshedStatus?.status === 'ready') {
    logger.info('[dev] daemon token refreshed successfully.')
  } else {
    logger.warn('[dev] daemon did not report ready credentials after guest login; Supabase writes may fail.')
  }
  return { status: refreshedStatus, refreshed: true }
}
