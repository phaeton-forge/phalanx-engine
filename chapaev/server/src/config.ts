import { z } from 'zod';

export const DEFAULT_WEB_APP_URL = 'https://chapaev.onrender.com';

const Schema = z
  .object({
    PORT: z.coerce.number().default(3000),
    CORS_ORIGINS: z.string().optional(),
    DATABASE_PATH: z.string().default('./data/chapaev.db'),
    BOT_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
    TELEGRAM_WEBHOOK_PATH: z.string().default('/telegram/webhook'),
    PUBLIC_URL: z.string().url().optional(),
    WEB_APP_URL: z.string().url().default(DEFAULT_WEB_APP_URL),
    BOT_USERNAME: z.string().optional(),
    TELEGRAM_APP_NAME: z.string().optional(),
    FEEDBACK_CHAT_ID: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.coerce.number().int().optional(),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.BOT_ENABLED) {
      const required = [
        'TELEGRAM_BOT_TOKEN',
        'TELEGRAM_WEBHOOK_SECRET',
        'PUBLIC_URL',
        'BOT_USERNAME',
        'FEEDBACK_CHAT_ID',
      ] as const;
      for (const k of required) {
        if (!v[k]) {
          ctx.addIssue({
            code: 'custom',
            message: `${k} required when BOT_ENABLED=true`,
            path: [k],
          });
        }
      }
    }
  });

export type Config = z.infer<typeof Schema>;

export function parseConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = Schema.safeParse(env);
  if (!result.success) {
    const messages = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${messages}`);
  }
  return result.data;
}
