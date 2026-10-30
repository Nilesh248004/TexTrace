// Central server configuration (env-driven). Import `config` instead of reading process.env elsewhere.
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(here, '..');

function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : d;
}

export const config = {
  port: num(process.env.API_PORT || process.env.PORT, 4000),
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.VITEST === 'true' || process.env.NODE_ENV === 'test',
  dbFile: path.resolve(PROJECT_ROOT, process.env.DB_FILE ?? 'server/data/textrace.db'),
  databaseUrl: process.env.DATABASE_URL ?? '',
  uploadsDir: path.resolve(PROJECT_ROOT, process.env.UPLOADS_DIR ?? 'server/data/uploads'),
  distDir: path.resolve(PROJECT_ROOT, 'dist'),
  millName: process.env.MILL_NAME ?? 'Model Spinning Mill — Unit 1',
  ledger: {
    adapter: process.env.LEDGER_ADAPTER ?? 'simulated',
    validatorSecret: process.env.LEDGER_VALIDATOR_SECRET ?? 'textrace-demo-validators',
  },
  ai: {
    provider: (process.env.AI_PROVIDER ?? 'anthropic') as 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.AI_MODEL ?? 'claude-opus-5-5',
    effort: (process.env.AI_EFFORT ?? 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 60000),
    fallbacks: (process.env.AI_FALLBACKS ?? 'default') as 'default' | 'off',
    get enabled(): boolean {
      return !!this.apiKey;
    },
  },
  /** Zeon, the in-app assistant. It reuses the `ai` settings above (key, model, timeout, fallbacks); these only tune the chat. */
  zeon: {
    effort: (process.env.ZEON_EFFORT ?? 'low') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
    maxSteps: num(process.env.ZEON_MAX_STEPS, 6),
    perMinute: num(process.env.ZEON_PER_MINUTE, 12),
    perDay: num(process.env.ZEON_PER_DAY, 300),
    timeoutMs: num(process.env.ZEON_TIMEOUT_MS, 30000),
  },
  gemini: {
    apiKey: process.env.Gemini_API_KEY ?? '',
    model: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash',
    /** tried in order when the main model is overloaded */
    fallbackModels: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'],
    get enabled(): boolean {
      return !!this.apiKey;
    },
  },
  /** Demo "today" used for dashboards and default dates; seed data is generated relative to it. */
  defaultBusinessDate: '2026-10-28',
  /** Demo clock at seed time (15:10 IST on the business date). */
  seedNowIso: '2026-10-28T09:40:00.000Z',
};
