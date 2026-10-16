import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/Phalanx.js';
import { unlinkSync, mkdirSync, existsSync, rmdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

interface HealthCheckResponse {
  status: string;
  timestamp: string;
  tls: boolean;
}

/**
 * Tests for Story 2.6.1: TLS/WSS Transport
 */
describe('2.6.1: TLS/WSS Transport', () => {
  let server: Phalanx;
  let clients: Socket[] = [];
  const TEST_PORT = 3400;
  const TEST_CERTS_DIR = join(process.cwd(), 'test-certs');

  // Generate self-signed certificates for testing
  function generateTestCertificates() {
    if (!existsSync(TEST_CERTS_DIR)) {
      mkdirSync(TEST_CERTS_DIR, { recursive: true });
    }

    // Generate self-signed certificate using openssl
    try {
      execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout ${TEST_CERTS_DIR}/key.pem -out ${TEST_CERTS_DIR}/cert.pem -days 1 -nodes -subj "/CN=localhost" 2>/dev/null`
      );
    } catch (error) {
      // If openssl fails, skip TLS tests
      throw new Error('OpenSSL not available for certificate generation');
    }
  }

  function cleanupTestCertificates() {
    try {
      if (existsSync(join(TEST_CERTS_DIR, 'key.pem'))) {
        unlinkSync(join(TEST_CERTS_DIR, 'key.pem'));
      }
      if (existsSync(join(TEST_CERTS_DIR, 'cert.pem'))) {
        unlinkSync(join(TEST_CERTS_DIR, 'cert.pem'));
      }
      if (existsSync(TEST_CERTS_DIR)) {
        rmdirSync(TEST_CERTS_DIR);
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  afterEach(async () => {
    // Disconnect all clients first
    for (const client of clients) {
      if (client.connected) {
        client.disconnect();
      }
    }
    clients = [];
    // Small delay to allow disconnect events to process
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (server) {
      await server.stop();
    }
  });

  describe('Without TLS (development mode)', () => {
    beforeEach(async () => {
      server = new Phalanx({ port: TEST_PORT });
      await server.start();
    });

    function createClient(): Socket {
      const client = io(`http://localhost:${TEST_PORT}`, {
        autoConnect: false,
        forceNew: true,
      });
      clients.push(client);
      return client;
    }

    async function connectClient(client: Socket): Promise<void> {
      return new Promise((resolve) => {
        client.on('connect', () => resolve());
        client.connect();
      });
    }

    it('should start server without TLS config (dev mode)', async () => {
      const config = server.getConfig();
      expect(config.tls).toBeUndefined();
    });

    it('should accept HTTP/WS connections when TLS is disabled', async () => {
      const client = createClient();
      await connectClient(client);
      expect(client.connected).toBe(true);
    });

    it('should return tls: false in health check when TLS is disabled', async () => {
      const response = await fetch(`http://localhost:${TEST_PORT}/health`);
      const data = (await response.json()) as HealthCheckResponse;
      expect(data.status).toBe('ok');
      expect(data.tls).toBe(false);
    });
  });

  describe('With TLS enabled', () => {
    let hasCerts = false;

    beforeEach(async () => {
      try {
        generateTestCertificates();
        hasCerts = true;
      } catch {
        hasCerts = false;
      }
    });

    afterEach(() => {
      cleanupTestCertificates();
    });

    it('should start server with TLS config', async function () {
      if (!hasCerts) {
        console.log('Skipping: OpenSSL not available');
        return;
      }

      server = new Phalanx({
        port: TEST_PORT,
        tls: {
          enabled: true,
          keyPath: join(TEST_CERTS_DIR, 'key.pem'),
          certPath: join(TEST_CERTS_DIR, 'cert.pem'),
        },
      });
      await server.start();

      const config = server.getConfig();
      expect(config.tls?.enabled).toBe(true);
    });

    it('should accept WSS connections when TLS is enabled', async function () {
      if (!hasCerts) {
        console.log('Skipping: OpenSSL not available');
        return;
      }

      server = new Phalanx({
        port: TEST_PORT,
        tls: {
          enabled: true,
          keyPath: join(TEST_CERTS_DIR, 'key.pem'),
          certPath: join(TEST_CERTS_DIR, 'cert.pem'),
        },
      });
      await server.start();

      const client = io(`https://localhost:${TEST_PORT}`, {
        autoConnect: false,
        forceNew: true,
        rejectUnauthorized: false, // Accept self-signed certs for testing
      });
      clients.push(client);

      const connected = await new Promise<boolean>((resolve) => {
        client.on('connect', () => resolve(true));
        client.on('connect_error', () => resolve(false));
        client.connect();
      });

      expect(connected).toBe(true);
    });

  });

  describe('TLS error handling', () => {
    it('should throw error for invalid certificate paths', async () => {
      server = new Phalanx({
        port: TEST_PORT,
        tls: {
          enabled: true,
          keyPath: '/nonexistent/key.pem',
          certPath: '/nonexistent/cert.pem',
        },
      });

      await expect(server.start()).rejects.toThrow(
        'Failed to load TLS certificates'
      );
    });

    it('should not attempt to load certs when TLS is disabled even with paths', async () => {
      server = new Phalanx({
        port: TEST_PORT,
        tls: {
          enabled: false,
          keyPath: '/nonexistent/key.pem',
          certPath: '/nonexistent/cert.pem',
        },
      });

      // Should not throw because enabled is false
      await server.start();
      expect(server.getConfig().tls?.enabled).toBe(false);
    });
  });
});
