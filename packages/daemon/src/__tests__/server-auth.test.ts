import { describe, expect, it } from 'vitest';
import { createDaemonServer, type DaemonAuthResponse } from '../server.js';

async function listenServer(
  options: Parameters<typeof createDaemonServer>[0],
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createDaemonServer(options);
  const address = await server.listen();
  const host = address.address === '::' ? '127.0.0.1' : address.address;
  const baseUrl = `http://${host}:${address.port}`;
  return {
    baseUrl,
    close: () => server.close(),
  };
}

describe('createDaemonServer auth routes', () => {
  it('serves auth status and guest/device/logout handlers', async () => {
    let guestPayload: Record<string, unknown> | null = null;
    let devicePayload: Record<string, unknown> | null = null;

    const { baseUrl, close } = await listenServer({
      host: '127.0.0.1',
      port: 0,
      getStatus: () => ({
        startedAt: new Date().toISOString(),
        connected: true,
        streamCount: 0,
      }),
      getAuthStatus: () => ({ status: 'ready', token: 'cached-token' }),
      handleAuthGuest: async (payload) => {
        guestPayload = payload;
        return { status: 'ready', token: 'guest-token', httpStatus: 201 } satisfies DaemonAuthResponse;
      },
      handleAuthDevice: async (payload) => {
        devicePayload = payload;
        return { status: 'pending', reason: 'waiting' };
      },
      handleAuthLogout: async () => {
        return { status: 'auth_required', reason: 'signed out' };
      },
    });

    try {
      const statusRes = await fetch(`${baseUrl}/auth/status`);
      expect(statusRes.status).toBe(200);
      expect(await statusRes.json()).toEqual({ status: 'ready', token: 'cached-token' });

      const guestRes = await fetch(`${baseUrl}/auth/guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'payload-token', endpoint: 'https://endpoint.local' }),
      });
      expect(guestRes.status).toBe(201);
      expect(await guestRes.json()).toEqual({ status: 'ready', token: 'guest-token' });
      expect(guestPayload).toEqual({ token: 'payload-token', endpoint: 'https://endpoint.local' });

      const deviceRes = await fetch(`${baseUrl}/auth/device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'device-code' }),
      });
      expect(deviceRes.status).toBe(202);
      expect(await deviceRes.json()).toEqual({ status: 'pending', reason: 'waiting' });
      expect(devicePayload).toEqual({ mode: 'device-code' });

      const logoutRes = await fetch(`${baseUrl}/auth/logout`, { method: 'POST' });
      expect(logoutRes.status).toBe(401);
      expect(await logoutRes.json()).toEqual({ status: 'auth_required', reason: 'signed out' });
    } finally {
      await close();
    }
  });
});
