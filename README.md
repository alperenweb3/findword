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
