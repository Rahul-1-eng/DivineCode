# DivineCode Final Runbook

This is the shortest path to see the V2 website running.

## Local Preview

You need a PostgreSQL database first.

If Docker is installed:

```powershell
docker compose -f infra/docker-compose.local.yml up -d
npm install
npm run prisma:deploy
npm run db:check
npm run dev
```

Open:

- Web: `http://localhost:3000`
- API health: `http://localhost:4000/api/v2/health`

If Docker is not installed, create a hosted PostgreSQL database and paste its URL into `apps/api/.env`:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public"
```

Then run:

```powershell
npm run prisma:deploy
npm run db:check
npm run dev
```

## Render: API, Worker, Postgres, Redis

Use the root `render.yaml` Blueprint.

It creates:

- `divinecode-api`: Express API
- `divinecode-worker`: BullMQ judge/sync worker
- `divinecode-postgres`: PostgreSQL
- `divinecode-redis`: Redis-compatible Render Key Value

During Blueprint creation, Render asks for:

- `CLIENT_ORIGIN`: your final Vercel URL, for example `https://divinecode.vercel.app`
- `JUDGE0_URL`: your Judge0 service URL

After the API deploys, copy the API URL, for example:

```txt
https://divinecode-api.onrender.com
```

Check:

```txt
https://divinecode-api.onrender.com/api/v2/health
```

## Vercel: Web

Create a Vercel project from the same repository.

Set:

- Root Directory: `apps/web`
- Framework: Next.js
- Build Command: `npm run build`
- Install Command: `npm install`

Environment variables:

```env
NEXT_PUBLIC_API_BASE_URL=https://YOUR_RENDER_API_URL
NEXT_PUBLIC_SOCKET_URL=https://YOUR_RENDER_API_URL
NEXTAUTH_URL=https://YOUR_VERCEL_URL
NEXTAUTH_SECRET=generate-a-long-random-secret
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
```

After Vercel gives you a URL, go back to Render and set:

```env
CLIENT_ORIGIN=https://YOUR_VERCEL_URL
```

Then redeploy the Render API.

## Google Login

In Google Cloud Console OAuth credentials, add:

- Authorized JavaScript origin: `https://YOUR_VERCEL_URL`
- Authorized redirect URI: `https://YOUR_VERCEL_URL/api/auth/callback/google`

## Judge0

For Codeforces-only contests, the platform can update standings through Codeforces sync.

For internal DivineCode problems, set `JUDGE0_URL`. Without it, internal submissions can be stored but not judged.

## Smoke Test

1. Visit the Vercel URL.
2. Sign in with Google.
3. Open `Create Mashup`.
4. Add players with their account emails and Codeforces handles.
5. Add a Codeforces problem like `1805A`.
6. Create the contest.
7. Have a player submit on Codeforces.
8. As owner, click `Sync Codeforces now`.
9. Standings should update after the worker processes the job.

## Current Limitation

The V2 platform is wired for production services, but it still needs a real Judge0 deployment for internal coding problems and a production auth authorization pass before public launch.
