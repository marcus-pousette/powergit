import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import type { PowerSyncDatabase, SyncStreamSubscription } from '@powersync/node';
import { DaemonAuthManager, type AuthStatusPayload } from './auth/index.js';
import { DeviceAuthCoordinator } from './auth/device-flow.js';
import { resolveDaemonConfig, type ResolveDaemonConfigOptions } from './config.js';
import { DaemonPowerSyncConnector } from './connector.js';
import { connectWithSchemaRecovery, createPowerSyncDatabase } from './database.js';
import { ensureLocalSchema } from './local-schema.js';
import { createDaemonServer } from './server.js';
import { getLatestPack, getRepoSummary, listRefs, listRepos, persistPush } from './queries.js';
import type { PersistPushResult, PushUpdateRow } from './queries.js';
import { SupabaseWriter } from './supabase-writer.js';

function normalizePackBytes(raw: unknown): { base64: string; size: number } | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const trimmed = raw.trim();

  if (trimmed.startsWith('\\x')) {
    const hex = trimmed.slice(2);
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
      const buffer = Buffer.from(hex, 'hex');
      if (buffer.length === 0) return null;
      return { base64: buffer.toString('base64'), size: buffer.length };
    }
  }

  if (isLikelyBase64(trimmed)) {
    try {
      const buffer = Buffer.from(trimmed, 'base64');
      if (buffer.length === 0) return null;
      return { base64: buffer.toString('base64'), size: buffer.length };
    } catch {
      // fall through to binary conversion
    }
  }

  const fallbackBuffer = Buffer.from(trimmed, 'binary');
  if (fallbackBuffer.length === 0) return null;
  return { base64: fallbackBuffer.toString('base64'), size: fallbackBuffer.length };
}

function isLikelyBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function buildPushErrorResults(updates: PushUpdateRow[], message: string) {
  return Object.fromEntries(
    updates.map((update) => [update.dst ?? '', { status: 'error' as const, message }]),
  );
}

class StreamSubscriptionManager {
  private readonly desired = new Set<string>();
  private readonly active = new Map<string, SyncStreamSubscription>();

  constructor(private readonly database: PowerSyncDatabase) {}

  trackDesired(streamIds: readonly string[]): string[] {
    const added: string[] = [];
    for (const rawId of streamIds) {
      const streamId = rawId.trim();
      if (!streamId) continue;
      if (!this.desired.has(streamId)) {
        this.desired.add(streamId);
        added.push(streamId);
      }
    }
    return added;
  }

  listDesired(): string[] {
    return Array.from(this.desired);
  }

  getActiveCount(): number {
    return this.active.size;
  }

  async add(streamIds: readonly string[]): Promise<{ added: string[]; alreadyActive: string[] }> {
    const added: string[] = [];
    const alreadyActive: string[] = [];

    for (const rawId of streamIds) {
      const streamId = rawId.trim();
      if (!streamId) continue;

      this.desired.add(streamId);

      if (this.active.has(streamId)) {
        alreadyActive.push(streamId);
        continue;
      }

      try {
        const stream = this.database.syncStream(streamId);
        const subscription = await stream.subscribe();
        this.active.set(streamId, subscription);
        console.info(`[powersync-daemon] subscribed stream ${streamId}`);
        added.push(streamId);
      } catch (error) {
        console.error(`[powersync-daemon] failed to subscribe stream ${streamId}`, error);
        alreadyActive.push(streamId);
      }
    }

    return { added, alreadyActive };
  }

  async remove(streamIds: readonly string[]): Promise<{ removed: string[]; notFound: string[] }> {
    const removed: string[] = [];
    const notFound: string[] = [];

    for (const rawId of streamIds) {
      const streamId = rawId.trim();
      if (!streamId) continue;

      this.desired.delete(streamId);
      const subscription = this.active.get(streamId);
      if (!subscription) {
        notFound.push(streamId);
        continue;
      }
      try {
        subscription.unsubscribe();
      } catch (error) {
        console.warn('[powersync-daemon] failed to unsubscribe stream', error);
      } finally {
        this.active.delete(streamId);
      }
      removed.push(streamId);
    }

    return { removed, notFound };
  }

  async resubscribeAll(): Promise<void> {
    await this.closeAll();
    const desired = Array.from(this.desired);
    if (desired.length === 0) return;
    await this.add(desired);
  }

  async closeAll(): Promise<void> {
    const subscriptions = Array.from(this.active.values());
    this.active.clear();
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          subscription.unsubscribe();
        } catch (error) {
          console.warn('[powersync-daemon] failed to unsubscribe stream', error);
        }
      }),
    );
  }

}

export async function startDaemon(options: ResolveDaemonConfigOptions = {}): Promise<void> {
  const config = await resolveDaemonConfig(options);
  console.info(`[powersync-daemon] starting (db: ${config.dbPath})`);

  const startedAt = new Date();

  const initialCredentials =
    config.endpoint && config.token
      ? {
          endpoint: config.endpoint,
          token: config.token,
          authType: 'env' as const,
        }
      : undefined;

  const authManager = await DaemonAuthManager.create({
    sessionPath: config.authSessionPath,
    defaultEndpoint: config.endpoint,
    initialCredentials,
  });

  const deviceCoordinator = new DeviceAuthCoordinator({
    authManager,
    verificationUrl: config.auth?.deviceVerificationUrl ?? null,
    autoLaunch: config.auth?.deviceAutoLaunch ?? false,
    challengeTtlMs: config.auth?.deviceChallengeTtlMs,
    logger: (message) => console.info('[powersync-daemon][auth]', message),
  });

  let running = true;
  let connectionReady = false;
  let connectedAt: Date | null = null;
  const abortController = new AbortController();
  const requestShutdown = (reason: string) => {
    if (abortController.signal.aborted) return;
    running = false;
    console.info(`[powersync-daemon] shutdown requested (${reason}); shutting down`);
    abortController.abort();
  };

  const authUnsubscribe = authManager.subscribe((state) => {
    switch (state.status) {
      case 'ready':
        console.info('[powersync-daemon] authentication ready; token obtained');
        break;
      case 'pending':
        console.info('[powersync-daemon] authentication pending', state.reason ?? '');
        break;
      case 'auth_required':
        console.info('[powersync-daemon] authentication required', state.reason ?? '');
        break;
      case 'error':
        console.warn('[powersync-daemon] authentication error', state.reason ?? '');
        break;
      default:
        break;
    }
  });

  const database = await createPowerSyncDatabase({ dbPath: config.dbPath });
  const streamManager = new StreamSubscriptionManager(database);
  const initialQueued = streamManager.trackDesired(config.initialStreams);
  if (initialQueued.length > 0) {
    console.info(
      `[powersync-daemon] queued initial streams from config: ${initialQueued.map((s) => `"${s}"`).join(', ')}`,
    );
  }

  const supabaseWriter = config.supabase
    ? new SupabaseWriter({
        database,
        config: config.supabase,
      })
    : null;

  const connector = new DaemonPowerSyncConnector({
    credentialsProvider: async () => {
      const credentials = await authManager.waitForCredentials({ signal: abortController.signal });
      if (!credentials) {
        return null;
      }
      return { endpoint: credentials.endpoint, token: credentials.token };
    },
    uploadHandler: supabaseWriter
      ? async (db) => {
          await supabaseWriter.uploadPending(db);
        }
      : undefined,
  });

  await ensureLocalSchema(database);

  type AuthActionResponse = AuthStatusPayload & { httpStatus?: number };

  const coerceString = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const coerceMetadata = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  };

  const extractChallengeId = (payload: Record<string, unknown>): string | null => {
    const direct =
      coerceString(payload.challengeId) ??
      coerceString(payload.deviceCode) ??
      coerceString((payload as { device_code?: unknown }).device_code) ??
      coerceString(payload.code) ??
      coerceString(payload.state);
    if (direct) return direct;

    const metadata = coerceMetadata(payload.metadata);
    if (!metadata) return null;

    return (
      coerceString(metadata.challengeId) ??
      coerceString(metadata.deviceCode) ??
      coerceString((metadata as { device_code?: unknown }).device_code) ??
      null
    );
  };

  const extractToken = (payload: Record<string, unknown>): string | null => {
    const direct = coerceString(payload.token);
    if (direct) return direct;

    const tokenRecord = coerceMetadata(payload.token);
    if (tokenRecord) {
      const nested = coerceString(tokenRecord.token) ?? coerceString(tokenRecord.value);
      if (nested) return nested;
    }

    const credentialsRecord = coerceMetadata(payload.credentials);
    if (credentialsRecord) {
      const nested = coerceString(credentialsRecord.token) ?? coerceString(credentialsRecord.value);
      if (nested) return nested;
    }

    const accessToken = coerceString(payload.accessToken) ?? coerceString(payload.value);
    if (accessToken) return accessToken;

    return null;
  };

  const extractEndpoint = (payload: Record<string, unknown>): string | null => {
    return (
      coerceString(payload.endpoint) ??
      coerceString(payload.endpointUrl) ??
      coerceString(payload.url) ??
      coerceString(payload.baseUrl) ??
      (() => {
        const credentialsRecord = coerceMetadata(payload.credentials);
        if (!credentialsRecord) return null;
        return (
          coerceString(credentialsRecord.endpoint) ??
          coerceString(credentialsRecord.url) ??
          coerceString(credentialsRecord.baseUrl) ??
          null
        );
      })()
    );
  };

  const fallbackToken = (): string | null => {
    return (
      coerceString(process.env.POWERSYNC_DAEMON_GUEST_TOKEN) ??
      coerceString(process.env.POWERSYNC_DAEMON_TOKEN) ??
      coerceString(process.env.POWERSYNC_TOKEN)
    );
  };

  const fallbackEndpoint = (): string | null => {
    return (
      coerceString(authManager.getDefaultEndpoint()) ??
      coerceString(config.endpoint) ??
      coerceString(process.env.POWERSYNC_DAEMON_ENDPOINT) ??
      coerceString(process.env.POWERSYNC_ENDPOINT)
    );
  };

  const withStatus = (payload: AuthStatusPayload, httpStatus?: number): AuthActionResponse =>
    typeof httpStatus === 'number' ? { ...payload, httpStatus } : payload;

  const handleGuestAuth = async (payload: Record<string, unknown>): Promise<AuthActionResponse> => {
    const token = extractToken(payload) ?? fallbackToken();
    if (!token) {
      await authManager.setAuthRequired('Guest login requires a PowerSync token');
      return withStatus({ status: 'auth_required', reason: 'Guest login requires a PowerSync token' }, 400);
    }

    const endpoint = extractEndpoint(payload) ?? fallbackEndpoint();
    if (!endpoint) {
      await authManager.setAuthRequired('Guest login requires a PowerSync endpoint');
      return withStatus({ status: 'auth_required', reason: 'Guest login requires a PowerSync endpoint' }, 400);
    }

    const expiresAt = coerceString(payload.expiresAt);
    const obtainedAt = coerceString(payload.obtainedAt);
    const metadata = coerceMetadata(payload.metadata);

    try {
      await authManager.setReadyCredentials(
        {
          endpoint,
          token,
          expiresAt: expiresAt ?? undefined,
          obtainedAt: obtainedAt ?? undefined,
          metadata: metadata ?? undefined,
        },
        { source: 'guest' },
      );
      return withStatus(authManager.getStatusPayload(), 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Guest authentication failed';
      await authManager.setError(message);
      return withStatus({ status: 'error', reason: message }, 400);
    }
  };

  const handleDeviceAuth = async (payload: Record<string, unknown>): Promise<AuthActionResponse> => {
    const metadata = coerceMetadata(payload.metadata);
    const challengeId = extractChallengeId(payload);
    const token = extractToken(payload);

    if (token) {
      const endpoint = extractEndpoint(payload) ?? fallbackEndpoint();
      const expiresAt = coerceString(payload.expiresAt);
      const obtainedAt = coerceString(payload.obtainedAt);

      if (challengeId) {
        const ok = await deviceCoordinator.complete({
          challengeId,
          token,
          endpoint,
          expiresAt: expiresAt ?? null,
          obtainedAt: obtainedAt ?? null,
          metadata: metadata ?? undefined,
          source: 'device',
        });
        const status = authManager.getStatusPayload();
        return withStatus(status, ok ? 200 : 400);
      }

      if (!endpoint) {
        await authManager.setError('Device authentication requires a PowerSync endpoint');
        return withStatus({ status: 'error', reason: 'Device authentication requires a PowerSync endpoint' }, 400);
      }

      try {
        await authManager.setReadyCredentials(
          {
            endpoint,
            token,
            expiresAt: expiresAt ?? undefined,
            obtainedAt: obtainedAt ?? undefined,
            metadata: metadata ?? undefined,
          },
          { source: 'device' },
        );
        return withStatus(authManager.getStatusPayload(), 200);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Device authentication failed';
        await authManager.setError(message);
        return withStatus({ status: 'error', reason: message }, 400);
      }
    }

    const mode = coerceString(payload.mode);
    await deviceCoordinator.begin({
      endpoint: extractEndpoint(payload) ?? fallbackEndpoint(),
      metadata: metadata ?? undefined,
      mode,
    });
    return withStatus(authManager.getStatusPayload(), 202);
  };

  const handleAuthLogout = async (): Promise<AuthActionResponse> => {
    await authManager.logout('logout requested');
    return withStatus(authManager.getStatusPayload(), 200);
  };

  const normalizeStreamIds = (ids: readonly string[]): string[] =>
    Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));

  const subscribeStreams = async (streamIds: string[]) => {
    const normalized = normalizeStreamIds(streamIds);
    if (normalized.length === 0) {
      return { added: [], alreadyActive: [], queued: [] };
    }
    if (!connectionReady) {
      const queued = streamManager.trackDesired(normalized);
      return { added: [], alreadyActive: [], queued };
    }
    const result = await streamManager.add(normalized);
    return { ...result, queued: [] };
  };

  const unsubscribeStreams = async (streamIds: string[]) => {
    const normalized = normalizeStreamIds(streamIds);
    if (normalized.length === 0) {
      return { removed: [], notFound: [] };
    }
    return streamManager.remove(normalized);
  };

  const listStreams = () => streamManager.listDesired();

  const server = createDaemonServer({
    host: config.host,
    port: config.port,
    getStatus: () => ({
      startedAt: startedAt.toISOString(),
      connected: connectionReady,
      connectedAt: connectedAt ? connectedAt.toISOString() : undefined,
      streamCount: streamManager.getActiveCount(),
    }),
    getAuthStatus: () => authManager.getStatusPayload(),
    handleAuthGuest: handleGuestAuth,
    handleAuthDevice: handleDeviceAuth,
    handleAuthLogout: handleAuthLogout,
    listStreams,
    subscribeStreams,
    unsubscribeStreams,
    onShutdownRequested: () => {
      requestShutdown('rpc');
    },
    fetchRefs: ({ orgId, repoId, limit }) => listRefs(database, { orgId, repoId, limit }),
    listRepos: ({ orgId, limit }) => listRepos(database, { orgId, limit }),
    getRepoSummary: ({ orgId, repoId }) => getRepoSummary(database, { orgId, repoId }),
    fetchPack: async ({ orgId, repoId }) => {
      let packRow: Awaited<ReturnType<typeof getLatestPack>> = null;
      try {
        packRow = await getLatestPack(database, { orgId, repoId });
      } catch (error) {
        console.error(
          `[powersync-daemon] pack lookup failed for ${orgId}/${repoId}`,
          error,
        );
        return null;
      }
      if (!packRow) return null;
      const normalized = normalizePackBytes(packRow.pack_bytes);
      if (!normalized) {
        console.warn(
          `[powersync-daemon] pack bytes missing or invalid for ${orgId}/${repoId} (oid: ${packRow.pack_oid ?? 'unknown'})`,
        );
        return null;
      }
      return {
        packBase64: normalized.base64,
        encoding: 'base64',
        packOid: packRow.pack_oid,
        createdAt: packRow.created_at,
        size: normalized.size,
      };
    },
    pushPack: async ({ orgId, repoId, payload }) => {
      try {
        const result = await persistPush(database, {
          orgId,
          repoId,
          updates: payload.updates,
          packBase64: payload.packBase64,
          packEncoding: payload.packEncoding,
          packOid: payload.packOid,
          summary: payload.summary ?? undefined,
          dryRun: payload.dryRun === true,
        });
        if (supabaseWriter) {
          await supabaseWriter.uploadPending();
        }
        if (result.packSize !== undefined) {
          console.info(
            `[powersync-daemon] stored pack for ${orgId}/${repoId} (oid: ${result.packOid ?? 'unknown'}, size: ${result.packSize} bytes)`,
          );
        }
        return result;
      } catch (error) {
        console.error(`[powersync-daemon] failed to persist push for ${orgId}/${repoId}`, error);
        const message = error instanceof Error ? error.message : 'Push failed';
        return {
          ok: false,
          message,
          results: buildPushErrorResults(payload.updates, message),
        } as PersistPushResult & { message: string };
      }
    },
  });

  const connectionTask = (async () => {
    try {
      await connectWithSchemaRecovery(database, {
        connector,
        dbPath: config.dbPath,
        includeDefaultStreams: false,
      });
      if (!running && abortController.signal.aborted) {
        return;
      }
      connectionReady = true;
      connectedAt = new Date();
      console.info('[powersync-daemon] connected to PowerSync backend');
      await streamManager.resubscribeAll();
      console.info(
        `[powersync-daemon] active stream subscriptions: ${streamManager.getActiveCount()} (desired: ${streamManager.listDesired().length})`,
      );
      if (supabaseWriter) {
        console.info('[powersync-daemon] Supabase upload handler ready');
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }
      console.error('[powersync-daemon] failed to establish PowerSync connection', error);
      requestShutdown('powersync-connect');
    }
  })();

  const address = await server.listen();
  const listenHost = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  console.info(`[powersync-daemon] listening on http://${listenHost}:${address.port}`);

  process.once('SIGINT', () => requestShutdown('SIGINT'));
  process.once('SIGTERM', () => requestShutdown('SIGTERM'));

  process.stdin.resume();

  await new Promise<void>((resolve) => {
    if (abortController.signal.aborted) {
      resolve();
      return;
    }
    abortController.signal.addEventListener('abort', () => resolve(), { once: true });
  });

  await streamManager.closeAll();
  connectionReady = false;
  connectedAt = null;
  await database.close({ disconnect: true }).catch((error) => {
    console.warn('[powersync-daemon] failed to close database', error);
  });
  await server.close().catch((error) => {
    console.warn('[powersync-daemon] failed to stop HTTP server', error);
  });
  authUnsubscribe();

  if (typeof process.stdin?.pause === 'function') {
    process.stdin.pause();
  }

  console.info('[powersync-daemon] shutdown complete');
}

const entryModulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv?.[1] ? resolvePath(process.argv[1]) : null;
if (invokedPath && entryModulePath === invokedPath) {
  startDaemon().catch((error) => {
    console.error('[powersync-daemon] failed to start', error);
    process.exit(1);
  });
}
