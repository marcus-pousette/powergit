import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DaemonAuthManager } from '../auth/manager.js';

async function createTempSessionPath(): Promise<{ dir: string; sessionPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'daemon-auth-'));
  const sessionPath = join(dir, 'session.json');
  return { dir, sessionPath };
}

async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

const createdDirs: string[] = [];

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      await cleanupTempDir(dir);
    }
  }
});

describe('DaemonAuthManager', () => {
  it('loads credentials from disk when present', async () => {
    const { dir, sessionPath } = await createTempSessionPath();
    createdDirs.push(dir);
    const stored = {
      endpoint: 'https://example.local',
      token: 'stored-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      obtainedAt: '2098-01-01T00:00:00.000Z',
      authType: 'guest',
    };
    await writeFile(sessionPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');

    const manager = await DaemonAuthManager.create({ sessionPath });
    const status = manager.getStatusPayload();
    expect(status.status).toBe('ready');
    expect(manager.getReadyCredentials()).not.toBeNull();
    expect(manager.getReadyCredentials()).toMatchObject({
      endpoint: stored.endpoint,
      token: stored.token,
      expiresAt: stored.expiresAt,
      obtainedAt: stored.obtainedAt,
      authType: stored.authType,
    });
  });

  it('persists credentials when setReadyCredentials is called', async () => {
    const { dir, sessionPath } = await createTempSessionPath();
    createdDirs.push(dir);

    const now = new Date('2025-10-18T12:00:00.000Z');
    const manager = await DaemonAuthManager.create({
      sessionPath,
      defaultEndpoint: 'https://persist.local',
      now: vi.fn(() => now),
    });

    await manager.setReadyCredentials(
      {
        endpoint: 'https://persist.local',
        token: 'fresh-token',
        expiresAt: '2025-12-01T00:00:00.000Z',
      },
      { source: 'guest' },
    );

    const written = JSON.parse(await readFile(sessionPath, 'utf8')) as Record<string, unknown>;
    expect(written.endpoint).toBe('https://persist.local');
    expect(written.token).toBe('fresh-token');
    expect(written.expiresAt).toBe('2025-12-01T00:00:00.000Z');
    expect(written.obtainedAt).toBe(now.toISOString());
    expect(written.authType).toBe('guest');
    expect(manager.getStatusPayload().status).toBe('ready');

    // Ensure obtainedAt is populated even when omitted
    expect(manager.getReadyCredentials()).toMatchObject({
      obtainedAt: now.toISOString(),
    });
  });

  it('waits for credentials when none are available', async () => {
    const { dir, sessionPath } = await createTempSessionPath();
    createdDirs.push(dir);

    const manager = await DaemonAuthManager.create({
      sessionPath,
      defaultEndpoint: 'https://wait.local',
    });

    const waitPromise = manager.waitForCredentials();

    await manager.setReadyCredentials(
      {
        endpoint: 'https://wait.local',
        token: 'later-token',
      },
      { source: 'device' },
    );

    const credentials = await waitPromise;
    expect(credentials).not.toBeNull();
    expect(credentials).toMatchObject({
      endpoint: 'https://wait.local',
      token: 'later-token',
      authType: 'device',
    });
  });

  it('clears credentials on logout', async () => {
    const { dir, sessionPath } = await createTempSessionPath();
    createdDirs.push(dir);

    const manager = await DaemonAuthManager.create({
      sessionPath,
      initialCredentials: {
        endpoint: 'https://logout.local',
        token: 'logout-token',
      },
    });

    expect(manager.getStatusPayload().status).toBe('ready');

    await manager.logout('test logout');
    const status = manager.getStatusPayload();
    expect(status.status).toBe('auth_required');
    expect(status.reason).toBe('test logout');

    await expect(readFile(sessionPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
