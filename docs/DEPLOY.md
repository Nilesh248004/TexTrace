# Deploying TexTrace

TexTrace is one long-running Node process (Express + WebSocket) that serves the API and the built UI. Use a host that runs a normal Node server (Render, Railway, Fly.io, a VPS). Serverless-function platforms (Vercel/Netlify functions) will not work because of the WebSocket and the single process.

## Build and start

| Step  | Command                                                                  |
| ----- | ------------------------------------------------------------------------ |
| Build | `npm ci && npm run build`                                                |
| Start | `npm start` (sets `NODE_ENV=production`, serves `dist/` and `/api`)      |
| Health check | `GET /api/health`                                                 |

The host's `PORT` is used automatically (`API_PORT` takes priority if set). Node 20+ is required.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon connection string, pooled host, `?sslmode=verify-full`. Without it the app falls back to a local SQLite file. |
| `LEDGER_VALIDATOR_SECRET` | yes | Private random value. Changing it later invalidates existing ledger signatures, so set it before real data is anchored. The server warns on boot if it is still the demo default. |
| `MILL_NAME` | no | Name shown in the top bar. |
| `ANTHROPIC_API_KEY` | no | Enables the optional LLM narrative on top of the statistical complaint analysis (`AI_MODEL`, `AI_EFFORT`, `AI_FALLBACKS`, `AI_TIMEOUT_MS` tune it). Without a key the full statistical analysis still runs; nothing is invented. |

Never commit `.env`; set variables in the host's dashboard.

## First start

On first start the schema is applied and demo data (≈3,000 records, ≈2,400 ledger transactions in 114 blocks) is seeded automatically if the database is empty. The server opens its port immediately and answers `/api/*` with `503 {"seeding": true}` until seeding has finished — locally that takes about a second; against a remote Neon database it takes a few minutes the first time (the sign-in screen shows a "preparing" notice and retries by itself). You can also run `npm run seed` once beforehand. `npm run seed` wipes the target database; so does *Developer Console → Demo → Reset demo data*.

## Testing against Postgres

`tests/unit/pg.test.ts` runs the API suite on a real Postgres and is skipped unless `TEST_DATABASE_URL` is set. It drops every table in the target, so only point it at a disposable local database:

    docker run -d --name pgtest -e POSTGRES_PASSWORD=test -p 54329:5432 postgres:16-alpine
    TEST_DATABASE_URL=postgresql://postgres:test@localhost:54329/postgres npm test
