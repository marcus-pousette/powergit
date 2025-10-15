import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DaemonAuthManager } from '../auth/manager.js';
import { DeviceAuthCoordinator } from '../auth/device-flow.js';

describe('DeviceAuthCoordinator', () => {
  let sessionDir: string;
  let sessionPath: string;

  beforeEach(async () => {
    sessionDir = await mkdtemp(join(tmpdir(), 'daemon-device-test-'));
    sessionPath = join(sessionDir, 'session.json');
  });

  afterEach(async () => {
    await rm(sessionDir, { recursive: true, force: true });
  });

  it('creates and completes a device challenge', async () => {
    const authManager = await DaemonAuthManager.create({ sessionPath, defaultEndpoint: 'https://endpoint.dev' });
    const coordinator = new DeviceAuthCoordinator({
      authManager,
      verificationUrl: 'http://localhost:5173/auth',
      autoLaunch: false,
    });

    await coordinator.begin({ endpoint: 'https://endpoint.dev' });
    const pending = authManager.getStatusPayload();
    expect(pending.status).toBe('pending');
    expect(pending.context).not.toBeNull();
    const challengeId = (pending.context as { challengeId?: string }).challengeId;
    expect(typeof challengeId).toBe('string');

    const completed = await coordinator.complete({
      challengeId: challengeId!,
      token: 'device-token',
      endpoint: 'https://endpoint.dev',
    });
    expect(completed).toBe(true);
    const ready = authManager.getStatusPayload();
    expect(ready.status).toBe('ready');
    expect(ready.token).toEqual({ value: 'device-token', token: 'device-token' });
  });
});
