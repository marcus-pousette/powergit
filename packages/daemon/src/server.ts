import http from 'node:http';
import type { AddressInfo } from 'node:net';
import busboy from 'busboy';
import type { GitPushSummary, RefRow, RepoSummaryRow } from '@shared/core';
import type { PersistPushResult, PushUpdateRow } from './queries.js';
import type { AuthStatusPayload } from './auth/index.js';

export type DaemonAuthResponse = AuthStatusPayload & { httpStatus?: number };

export interface DaemonStatusSnapshot {
  startedAt: string;
  connected: boolean;
  connectedAt?: string;
  streamCount: number;
}

export interface DaemonCorsOptions {
  origins?: string | string[];
  allowMethods?: string[];
  allowHeaders?: string[];
  allowCredentials?: boolean;
  maxAgeSeconds?: number;
}

export interface DaemonServerOptions {
  host: string;
  port: number;
  getStatus: () => DaemonStatusSnapshot;
  getAuthStatus?: () => AuthStatusPayload;
  onShutdownRequested?: () => Promise<void> | void;
  handleAuthGuest?: (payload: Record<string, unknown>) => Promise<DaemonAuthResponse>;
  handleAuthDevice?: (payload: Record<string, unknown>) => Promise<DaemonAuthResponse>;
  handleAuthLogout?: () => Promise<DaemonAuthResponse>;
  fetchRefs?: (params: { orgId: string; repoId: string; limit?: number }) => Promise<RefRow[]>;
  listRepos?: (params: { orgId: string; limit?: number }) => Promise<RepoSummaryRow[]>;
  fetchPack?: (params: { orgId: string; repoId: string; wants?: string[] }) => Promise<DaemonPackResponse | null>;
  pushPack?: (params: { orgId: string; repoId: string; payload: DaemonPushRequest }) => Promise<DaemonPushResponse>;
  getRepoSummary?: (params: { orgId: string; repoId: string }) => Promise<{ orgId: string; repoId: string; counts: Record<string, number> }>;
  cors?: DaemonCorsOptions;
}

export interface DaemonServer {
  listen: () => Promise<AddressInfo>;
  close: () => Promise<void>;
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

async function readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks);
}

async function readJsonBody<T = unknown>(req: http.IncomingMessage): Promise<T | null> {
  const raw = await readRequestBody(req);
  if (!raw || raw.length === 0) return null;
  try {
    return JSON.parse(raw.toString('utf8')) as T;
  } catch (error) {
    console.warn('[powersync-daemon] failed to parse JSON body', error);
    return null;
  }
}

function resolveAuthStatusCode(payload: DaemonAuthResponse, fallback = 200): number {
  if (typeof payload.httpStatus === 'number' && Number.isFinite(payload.httpStatus) && payload.httpStatus > 0) {
    return Math.floor(payload.httpStatus);
  }
  switch (payload.status) {
    case 'ready':
      return fallback;
    case 'pending':
      return 202;
    case 'auth_required':
      return 401;
    case 'error':
      return 400;
    default:
      return fallback;
  }
}

function toAuthStatusPayload(payload: DaemonAuthResponse): AuthStatusPayload {
  const { httpStatus, ...rest } = payload;
  return rest;
}

function normalizeCorsOrigins(origins?: string | string[] | null): '*' | string[] {
  if (!origins || (Array.isArray(origins) && origins.length === 0)) {
    return '*';
  }
  if (typeof origins === 'string') {
    const trimmed = origins.trim();
    if (!trimmed) return '*';
    if (trimmed === '*') return '*';
    return [trimmed];
  }
  const normalized = origins
    .map((origin) => origin?.trim())
    .filter((origin): origin is string => Boolean(origin && origin !== '*'));
  return normalized.length === 0 ? '*' : Array.from(new Set(normalized));
}

function formatHeaderList(values: string[]): string {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).join(', ');
}

export interface DaemonPackResponse {
  packBase64: string;
  encoding?: string;
  packOid?: string | null;
  createdAt?: string | null;
  size?: number;
}

export interface DaemonPushRequest {
  updates: PushUpdateRow[];
  packBase64?: string;
  packEncoding?: string;
  packOid?: string;
  summary?: GitPushSummary | null;
  dryRun?: boolean;
}

export type DaemonPushResponse = PersistPushResult & { message?: string };

export function createDaemonServer(options: DaemonServerOptions): DaemonServer {
  const corsOrigins = normalizeCorsOrigins(options.cors?.origins ?? null);
  const allowMethodsHeader = formatHeaderList(
    (options.cors?.allowMethods && options.cors.allowMethods.length > 0 ? options.cors.allowMethods : ['GET', 'POST', 'OPTIONS']).map(
      (method) => method.toUpperCase(),
    ),
  );
  const defaultAllowHeaders = formatHeaderList(
    options.cors?.allowHeaders && options.cors.allowHeaders.length > 0
      ? options.cors.allowHeaders
      : ['Content-Type', 'Authorization', 'Accept'],
  );
  const allowCredentials = options.cors?.allowCredentials === true;
  const maxAgeSeconds =
    typeof options.cors?.maxAgeSeconds === 'number' && Number.isFinite(options.cors.maxAgeSeconds) && options.cors.maxAgeSeconds >= 0
      ? Math.floor(options.cors.maxAgeSeconds)
      : 600;

  const resolveOrigin = (requestOrigin: string | undefined): string | null => {
    if (!requestOrigin) {
      return corsOrigins === '*' ? '*' : null;
    }
    if (corsOrigins === '*') {
      return '*';
    }
    return corsOrigins.includes(requestOrigin) ? requestOrigin : null;
  };

  const setCorsHeaders = (req: http.IncomingMessage, res: http.ServerResponse, preflight: boolean): void => {
    const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const originHeader = resolveOrigin(requestOrigin);
    if (originHeader) {
      res.setHeader('Access-Control-Allow-Origin', originHeader);
      if (originHeader !== '*') {
        const vary = res.getHeader('Vary');
        res.setHeader('Vary', vary ? `${vary}, Origin` : 'Origin');
      }
      if (allowCredentials && originHeader !== '*') {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    }
    if (allowMethodsHeader) {
      res.setHeader('Access-Control-Allow-Methods', allowMethodsHeader);
    }
    if (preflight) {
      const requestHeaders =
        typeof req.headers['access-control-request-headers'] === 'string' ? req.headers['access-control-request-headers'] : null;
      if (requestHeaders) {
        res.setHeader('Access-Control-Allow-Headers', requestHeaders);
      } else if (defaultAllowHeaders) {
        res.setHeader('Access-Control-Allow-Headers', defaultAllowHeaders);
      }
      if (maxAgeSeconds > 0) {
        res.setHeader('Access-Control-Max-Age', String(maxAgeSeconds));
      }
    } else if (defaultAllowHeaders) {
      res.setHeader('Access-Control-Allow-Headers', defaultAllowHeaders);
    }
  };

  const server = http.createServer((req, res) => {
    if (!req.url) {
      setCorsHeaders(req, res, false);
      res.statusCode = 400;
      res.end();
      return;
    }

    if (req.method === 'OPTIONS') {
      setCorsHeaders(req, res, true);
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? options.host}`);

    setCorsHeaders(req, res, false);

    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz' || url.pathname === '/status')) {
      sendJson(res, 200, options.getStatus());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/auth/status') {
      if (!options.getAuthStatus) {
        res.statusCode = 503;
        res.end();
        return;
      }
      try {
        const payload = options.getAuthStatus();
        sendJson(res, 200, payload);
      } catch (error) {
        console.error('[powersync-daemon] failed to provide auth status', error);
        res.statusCode = 500;
        res.end();
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/auth/logout') {
      if (!options.handleAuthLogout) {
        res.statusCode = 503;
        res.end();
        return;
      }

      Promise.resolve()
        .then(() => options.handleAuthLogout?.())
        .then((payload) => {
          if (!payload) {
            res.statusCode = 204;
            res.end();
            return;
          }
          sendJson(res, resolveAuthStatusCode(payload, 200), toAuthStatusPayload(payload));
        })
        .catch((error) => {
          console.error('[powersync-daemon] failed to process auth logout', error);
          res.statusCode = 500;
          res.end();
        });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/auth/guest') {
      if (!options.handleAuthGuest) {
        res.statusCode = 503;
        res.end();
        return;
      }
      Promise.resolve()
        .then(async () => {
          const body = await readJsonBody<Record<string, unknown>>(req);
          return options.handleAuthGuest?.(body ?? {});
        })
        .then((payload) => {
          if (!payload) {
            res.statusCode = 204;
            res.end();
            return;
          }
          sendJson(res, resolveAuthStatusCode(payload, 200), toAuthStatusPayload(payload));
        })
        .catch((error) => {
          console.error('[powersync-daemon] failed to process auth guest login', error);
          res.statusCode = 500;
          res.end();
        });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/auth/device') {
      if (!options.handleAuthDevice) {
        res.statusCode = 503;
        res.end();
        return;
      }
      Promise.resolve()
        .then(async () => {
          const body = await readJsonBody<Record<string, unknown>>(req);
          return options.handleAuthDevice?.(body ?? {});
        })
        .then((payload) => {
          if (!payload) {
            res.statusCode = 204;
            res.end();
            return;
          }
          sendJson(res, resolveAuthStatusCode(payload, 202), toAuthStatusPayload(payload));
        })
        .catch((error) => {
          console.error('[powersync-daemon] failed to process auth device login', error);
          res.statusCode = 500;
          res.end();
        });
      return;
    }

    if (req.method === 'GET' && options.fetchRefs) {
      const match = /^\/orgs\/([^/]+)\/repos\/([^/]+)\/refs$/.exec(url.pathname);
      if (match) {
        const [, rawOrg, rawRepo] = match;
        const orgId = decodeURIComponent(rawOrg);
        const repoId = decodeURIComponent(rawRepo);
        const limitParam = url.searchParams.get('limit');
        const limit = limitParam ? Number(limitParam) : undefined;

        if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
          res.statusCode = 400;
          res.end();
          return;
        }

        Promise.resolve()
          .then(() => options.fetchRefs?.({ orgId, repoId, limit }))
          .then((rows) => sendJson(res, 200, { orgId, repoId, refs: rows }))
          .catch((error) => {
            console.error('[powersync-daemon] failed to fetch refs', error);
            res.statusCode = 500;
            res.end();
          });
        return;
      }
    }

    if (req.method === 'GET' && options.listRepos) {
      const match = /^\/orgs\/([^/]+)\/repos$/.exec(url.pathname);
      if (match) {
        const [, rawOrg] = match;
        const orgId = decodeURIComponent(rawOrg);
        const limitParam = url.searchParams.get('limit');
        const limit = limitParam ? Number(limitParam) : undefined;

        if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
          res.statusCode = 400;
          res.end();
          return;
        }

        Promise.resolve()
          .then(() => options.listRepos?.({ orgId, limit }))
          .then((rows) => sendJson(res, 200, { orgId, repos: rows }))
          .catch((error) => {
            console.error('[powersync-daemon] failed to list repos', error);
            res.statusCode = 500;
            res.end();
          });
        return;
      }
    }

    if (req.method === 'GET' && options.getRepoSummary) {
      const match = /^\/orgs\/([^/]+)\/repos\/([^/]+)\/summary$/.exec(url.pathname);
      if (match) {
        const [, rawOrg, rawRepo] = match;
        const orgId = decodeURIComponent(rawOrg);
        const repoId = decodeURIComponent(rawRepo);

        Promise.resolve()
          .then(() => options.getRepoSummary?.({ orgId, repoId }))
          .then((summary) => {
            if (!summary) {
              res.statusCode = 404;
              res.end();
              return;
            }
            sendJson(res, 200, summary);
          })
          .catch((error) => {
            console.error('[powersync-daemon] failed to fetch repo summary', error);
            res.statusCode = 500;
            res.end();
          });
        return;
      }
    }

    if (req.method === 'POST' && options.fetchPack) {
      const match = /^\/orgs\/([^/]+)\/repos\/([^/]+)\/git\/fetch$/.exec(url.pathname);
      if (match) {
        const [, rawOrg, rawRepo] = match;
        const orgId = decodeURIComponent(rawOrg);
        const repoId = decodeURIComponent(rawRepo);

        Promise.resolve()
          .then(async () => {
            const body = await readJsonBody<{ wants?: unknown }>(req);
            const wants = Array.isArray(body?.wants) ? body!.wants.filter((value): value is string => typeof value === 'string' && value.length > 0) : undefined;
            return options.fetchPack?.({ orgId, repoId, wants });
          })
          .then((payload) => {
            if (!payload) {
              res.statusCode = 404;
              res.end();
              return;
            }

            const response: Record<string, unknown> = {
              pack: payload.packBase64,
              packEncoding: payload.encoding ?? 'base64',
            };
            if (payload.packOid) {
              response.keep = payload.packOid;
            }
            if (payload.size !== undefined) {
              response.size = payload.size;
            }
            if (payload.createdAt) {
              response.createdAt = payload.createdAt;
            }

            sendJson(res, 200, response);
          })
          .catch((error) => {
            console.error('[powersync-daemon] failed to serve pack', error);
            res.statusCode = 500;
            res.end();
          });
        return;
      }
    }

    if (req.method === 'POST' && options.pushPack) {
      const match = /^\/orgs\/([^/]+)\/repos\/([^/]+)\/git\/push$/.exec(url.pathname);
      if (match) {
        const [, rawOrg, rawRepo] = match;
        const orgId = decodeURIComponent(rawOrg);
        const repoId = decodeURIComponent(rawRepo);
        const contentType = req.headers['content-type'] ?? '';

        parsePushPayload(req, contentType)
          .then((payload) => {
            if (!payload || !Array.isArray(payload.updates) || payload.updates.length === 0) {
              res.statusCode = 400;
              res.end();
              return null;
            }
            return options.pushPack?.({ orgId, repoId, payload });
          })
          .then((result) => {
            if (!result) {
              return;
            }
            sendJson(res, 200, result);
          })
          .catch((error) => {
            console.error('[powersync-daemon] failed to process push', error);
            if (!res.writableEnded) {
              res.statusCode = 500;
              res.end();
            }
          });
        return;
      }
    }

    if (req.method === 'POST' && url.pathname === '/shutdown') {
      if (!options.onShutdownRequested) {
        res.statusCode = 503;
        res.end();
        return;
      }

      Promise.resolve()
        .then(() => options.onShutdownRequested?.())
        .then(() => sendJson(res, 202, { accepted: true }))
        .catch((error) => {
          console.error('[powersync-daemon] failed to process shutdown request', error);
          res.statusCode = 500;
          res.end();
        });
      return;
    }

    res.statusCode = req.method === 'GET' ? 404 : 405;
    if (res.statusCode === 405) {
      res.setHeader('Allow', 'GET, POST');
    }
    res.end();
  });

  return {
    listen: () =>
      new Promise<AddressInfo>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, options.host, () => {
          server.off('error', reject);
          resolve(server.address() as AddressInfo);
        });
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

async function parsePushPayload(req: http.IncomingMessage, contentType: string): Promise<DaemonPushRequest | null> {
  if (/multipart\/form-data/i.test(contentType)) {
    return new Promise<DaemonPushRequest | null>((resolve, reject) => {
      const bb = busboy({ headers: req.headers });
      const packChunks: Buffer[] = [];
      let metadata: unknown = null;
      let metadataError: Error | null = null;

      bb.on('file', (fieldname: string, file: NodeJS.ReadableStream) => {
        if (fieldname === 'pack') {
          file.on('data', (chunk: Buffer) => {
            packChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          file.once('end', () => {
            // no-op; ensures stream fully consumed
          });
          file.once('error', (error: Error) => {
            metadataError = metadataError ?? error;
          });
        } else {
          file.resume();
        }
      });

      bb.on('field', (fieldname: string, value: string) => {
        if (fieldname !== 'metadata') return;
        try {
          metadata = JSON.parse(value);
        } catch (error) {
          metadataError = new Error('Invalid metadata JSON');
        }
      });

      bb.once('error', (error: Error) => {
        reject(error);
      });

      bb.once('finish', () => {
        if (metadataError) {
          reject(metadataError);
          return;
        }
        const packBase64 = packChunks.length > 0 ? Buffer.concat(packChunks).toString('base64') : undefined;
        try {
          resolve(normalizePushPayload(metadata, packBase64));
        } catch (error) {
          reject(error as Error);
        }
      });

      req.pipe(bb);
    });
  }

  const body = await readJsonBody<unknown>(req);
  return normalizePushPayload(body ?? undefined, undefined);
}

function normalizePushPayload(raw: unknown, packFromStream?: string): DaemonPushRequest | null {
  const updates = parseUpdates((raw as { updates?: unknown })?.updates);
  const packBase64 = packFromStream ?? (typeof (raw as any)?.pack === 'string' ? ((raw as any).pack as string) : undefined);
  const packEncoding = typeof (raw as any)?.packEncoding === 'string' ? ((raw as any).packEncoding as string) : undefined;
  const rawOptions = (raw as any)?.options && typeof (raw as any).options === 'object' ? ((raw as any).options as Record<string, unknown>) : undefined;
  const packOidOption = rawOptions && typeof rawOptions.packOid === 'string' ? (rawOptions.packOid as string) : undefined;
  const packOid = typeof (raw as any)?.packOid === 'string' ? ((raw as any).packOid as string) : packOidOption;
  const summaryCandidate = (raw as any)?.summary ?? rawOptions?.summary;
  const summary = summaryCandidate && typeof summaryCandidate === 'object' ? (summaryCandidate as GitPushSummary) : null;
  const dryRunFlag = (raw as any)?.dryRun === true || (rawOptions?.dryRun === true);

  return {
    updates,
    packBase64,
    packEncoding,
    packOid,
    summary,
    dryRun: dryRunFlag ? true : undefined,
  };
}

function parseUpdates(raw: unknown): PushUpdateRow[] {
  if (!Array.isArray(raw)) return [];
  const updates: PushUpdateRow[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const src = typeof (entry as any).src === 'string' ? ((entry as any).src as string) : '';
    const dst = typeof (entry as any).dst === 'string' ? ((entry as any).dst as string) : '';
    if (!dst) continue;
    const update: PushUpdateRow = { src, dst };
    if ((entry as any).force === true) {
      update.force = true;
    }
    updates.push(update);
  }
  return updates;
}
