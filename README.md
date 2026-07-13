# Kelime Oyunu

A full-stack Turkish word-chain game with ranked solo runs, realtime private two-player rooms, accounts, match history, and daily/weekly/monthly leaderboards.

## Local development

### Docker setup on macOS

Install and start Docker Desktop before using Compose. Installing only the Homebrew `docker` formula provides the CLI but not the Docker daemon or `docker compose` command. Verify the complete installation with:

```bash
docker info
docker compose version
```

Both commands must succeed before starting the application.

1. Copy `.env.example` to `.env` and set `DATABASE_URL` and `AUTH_SECRET`.
2. Start PostgreSQL with `docker compose up -d db` or provide another PostgreSQL database.
3. Run `npm install`, `npm run db:push`, and `npm run dev`.
4. Open `http://localhost:3000`.

The custom Node server hosts Next.js and Socket.IO together. TDK lookups are performed only by the server and cached in memory. Guests can play immediately, while an email/password account is required for match history and leaderboard placement.

## Commands

- `npm run dev` — development server
- `npm run build` — production build
- `npm start` — production server
- `npm test` — unit tests
- `npm run typecheck` — TypeScript validation
- `npm run format` — format source files with Prettier and the Prisma schema with Prisma's formatter
- `npm run format:check` — verify source formatting without changing files
- `npm run db:push` — synchronize the Prisma schema

## Railway deployment

Prisma Postgres hosts only the database; Railway hosts the application. Copy the pooled PostgreSQL connection string from Prisma Console into the Railway application service's `DATABASE_URL` variable.

Add these variables under the Railway service's **Variables** tab:

```text
DATABASE_URL=postgres://...value copied from Prisma Console...
AUTH_SECRET=...output of openssl rand -base64 32...
AUTH_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
TDK_API_URL=https://sozluk.gov.tr/gts_id
```

Do not add quotes, do not expose these variables with a `NEXT_PUBLIC_` prefix, and never commit their real values. Railway supplies `PORT` and `RAILWAY_PUBLIC_DOMAIN` automatically. Generate a public domain under the service's **Settings → Networking** section, then deploy the staged variable changes.

The checked-in `railway.json` selects the Dockerfile, synchronizes the Prisma schema before deployment, health-checks `/`, and restarts failed containers. Keep the service at one replica because active realtime games use in-process state.
