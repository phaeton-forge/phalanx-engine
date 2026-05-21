import { Phalanx } from 'phalanx-server';

const PORT = Number.parseInt(process.env.PORT ?? '3001', 10);

async function main(): Promise<void> {
  const phalanx = new Phalanx({
    port: PORT,
    cors: {
      origin: [
        'http://localhost:5175',
        'http://localhost:5173',
        'http://localhost:3001',
      ],
      credentials: true,
    },
    auth: {
      enabled: false,
    },
    tickRate: 20,
    gameMode: '1v1',
    countdownSeconds: 3,
    matchmakingIntervalMs: 1000,
  });

  await phalanx.start();
  console.warn(`[abilities-playground] server listening on :${PORT}`);

  const shutdown = async () => {
    await phalanx.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

void main();
