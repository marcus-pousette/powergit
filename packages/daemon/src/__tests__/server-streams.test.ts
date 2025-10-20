import { describe, expect, it } from 'vitest';
import { createDaemonServer } from '../server.js';

async function listenForStreams(options: Parameters<typeof createDaemonServer>[0]) {
  const server = createDaemonServer(options);
  const address = await server.listen();
  const host = address.address === '::' ? '127.0.0.1' : address.address;
  const baseUrl = `http://${host}:${address.port}`;
  return {
    baseUrl,
    close: () => server.close(),
  };
}

describe('createDaemonServer stream routes', () => {
  it('allows listing, subscribing, and unsubscribing streams', async () => {
    const desired = new Set<string>();

    const { baseUrl, close } = await listenForStreams({
      host: '127.0.0.1',
      port: 0,
      getStatus: () => ({
        startedAt: new Date().toISOString(),
        connected: true,
        streamCount: desired.size,
        connectedAt: new Date().toISOString(),
      }),
      listStreams: () => Array.from(desired),
      subscribeStreams: async (streams) => {
        const added: string[] = [];
        streams.forEach((stream) => {
          const id = stream.id;
          if (!desired.has(id)) {
            desired.add(id);
            added.push(id);
          }
        });
        const alreadyActive = streams
          .map((stream) => stream.id)
          .filter((id) => !added.includes(id));
        return { added, alreadyActive, queued: [] };
      },
      unsubscribeStreams: async (streams) => {
        const removed: string[] = [];
        const notFound: string[] = [];
        streams.forEach((stream) => {
          const id = stream.id;
          if (desired.has(id)) {
            desired.delete(id);
            removed.push(id);
          } else {
            notFound.push(id);
          }
        });
        return { removed, notFound };
      },
    });

    try {
      const baseStream = 'orgs/demo/repos/infra/refs';

      const initialList = await fetch(`${baseUrl}/streams`);
      expect(initialList.status).toBe(200);
      expect(await initialList.json()).toEqual({ streams: [] });

      const subscribeRes = await fetch(`${baseUrl}/streams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streams: [baseStream, ' '] }),
      });
      expect(subscribeRes.status).toBe(200);
      const subscribePayload = (await subscribeRes.json()) as { added: string[]; alreadyActive: string[]; queued: string[] };
      expect(subscribePayload.added).toEqual([baseStream]);
      expect(subscribePayload.alreadyActive).toEqual([]);
      expect(subscribePayload.queued).toEqual([]);

      const afterSubscribe = await fetch(`${baseUrl}/streams`);
      expect(afterSubscribe.status).toBe(200);
      expect(await afterSubscribe.json()).toEqual({ streams: [baseStream] });

      const unsubscribeRes = await fetch(`${baseUrl}/streams`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streams: [baseStream, 'unused-stream'] }),
      });
      expect(unsubscribeRes.status).toBe(200);
      const unsubscribePayload = (await unsubscribeRes.json()) as { removed: string[]; notFound: string[] };
      expect(unsubscribePayload.removed).toEqual([baseStream]);
      expect(unsubscribePayload.notFound).toEqual(['unused-stream']);

      const finalList = await fetch(`${baseUrl}/streams`);
      expect(finalList.status).toBe(200);
      expect(await finalList.json()).toEqual({ streams: [] });
    } finally {
      await close();
    }
  });
});
