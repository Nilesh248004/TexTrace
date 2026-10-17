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
| `ANTHROPIC_API_KEY` | no | Enables the AI narrative layer. |

Never commit `.env`; set variables in the host's dashboard.

## First start

On first start the schema is applied and demo data is seeded automatically if the database is empty. From a laptop this takes about 90 seconds over the network to Neon; from a host in the same region it is much faster. Set the host's health-check grace period above that, or run `npm run seed` once beforehand. `npm run seed` wipes the target database.

## Testing against Postgres

`tests/unit/pg.test.ts` runs the API suite on a real Postgres and is skipped unless `TEST_DATABASE_URL` is set. It drops every table in the target, so only point it at a disposable local database:

    docker run -d --name pgtest -e POSTGRES_PASSWORD=test -p 54329:5432 postgres:16-alpine
    TEST_DATABASE_URL=postgresql://postgres:test@localhost:54329/postgres npm test
