# Database Linking

DivineCode V2 uses PostgreSQL through Prisma. The API now loads environment variables from:

1. repo root `.env`
2. `apps/api/.env`, overriding root values

## Local Database

If you have Docker:

```powershell
docker compose -f infra/docker-compose.local.yml up -d
npm run prisma:deploy
npm run db:check
```

If you use Neon, Supabase, Railway, Render, or another hosted Postgres:

1. Copy the pooled or direct Postgres connection string.
2. Put it in `apps/api/.env`:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public"
```

3. Apply migrations:

```powershell
npm run prisma:deploy
npm run db:check
```

## Required Runtime Services

- `DATABASE_URL`: required for all `/api/v2` routes.
- `REDIS_URL`: required when `ENABLE_API_WORKERS=true`.
- `JUDGE0_URL`: required to judge internal coding submissions.

## Local Placeholder

The checked setup uses this local placeholder:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/divinecode?schema=public"
```

It works only after Postgres is running locally.

If `npm run db:check` says it cannot reach `localhost:5432`, the code is configured but the database server is not running yet.
