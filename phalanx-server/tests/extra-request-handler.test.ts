import { describe, it, expect, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Phalanx } from '../src/Phalanx.js';

describe('extraRequestHandler', () => {
  let server: Phalanx;

  afterEach(async () => {
    await server.stop();
  });

  it('should allow a custom handler to consume a matching request', async () => {
    server = new Phalanx({
      port: 0,
      extraRequestHandler: async (
        req: IncomingMessage,
        res: ServerResponse
      ): Promise<boolean> => {
        if (req.url === '/custom') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ custom: true }));
          return true;
        }
        return false;
      },
    });
    await server.start();

    const response = await fetch(
      `http://localhost:${String(server.getPort())}/custom`
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { custom: boolean };
    expect(body.custom).toBe(true);
  });

  it('should fall through to built-in routes when the custom handler returns false', async () => {
    server = new Phalanx({
      port: 0,
      extraRequestHandler: async (): Promise<boolean> => false,
    });
    await server.start();

    const response = await fetch(
      `http://localhost:${String(server.getPort())}/health`
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('should return 404 for unhandled routes when the custom handler returns false', async () => {
    server = new Phalanx({
      port: 0,
      extraRequestHandler: async (): Promise<boolean> => false,
    });
    await server.start();

    const response = await fetch(
      `http://localhost:${String(server.getPort())}/does-not-exist`
    );
    expect(response.status).toBe(404);
  });

  it('should return 500 and not hang when the custom handler throws', async () => {
    server = new Phalanx({
      port: 0,
      extraRequestHandler: async (): Promise<boolean> => {
        throw new Error('boom');
      },
    });
    await server.start();

    const response = await fetch(
      `http://localhost:${String(server.getPort())}/custom`
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Internal server error');
  });
});
