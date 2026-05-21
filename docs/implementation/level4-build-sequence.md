# Level 4 Build Sequence

This is the rebuild order for DivineCode V2. Keep V1 working while each V2 slice becomes production-grade.

## Phase 1: Database Foundation

Status: started.

- Use PostgreSQL and Prisma as the source of truth.
- Keep Mongo/in-memory routes only as V1 compatibility.
- Generate Prisma client with `npm run prisma:generate`.
- Validate schema with `npm run prisma:validate`.
- Start local database services with `docker compose -f infra/docker-compose.local.yml up -d`.
- The initial SQL migration is checked in at `prisma/migrations/20260520000000_level4_foundation/migration.sql`.
- Apply migrations with `npm run prisma:migrate -- --name level4_foundation` locally or `npx prisma migrate deploy --schema prisma/schema.prisma` in production.
- Use `/api/v2` for all new production endpoints.

Implemented V2 endpoints:

- `GET /api/v2/health`
- `POST /api/v2/problems`
- `GET /api/v2/problems/:id`
- `POST /api/v2/contests`
- `GET /api/v2/contests/:id`
- `DELETE /api/v2/contests/:id`
- `POST /api/v2/contests/:id/submissions`
- `POST /api/v2/submissions/:id/judge`
- `GET /api/v2/contests/:id/submissions`
- `POST /api/v2/contests/:id/recompute-standings`
- `POST /api/v2/contests/:id/sync/codeforces`
- `POST /api/v2/recommendations/rating-band`

Background workers:

- Set `ENABLE_API_WORKERS=true` on one API/worker process.
- Judge jobs use the `divinecode:judge` BullMQ queue.
- Codeforces sync jobs use the `divinecode:external-sync` BullMQ queue.
- Use `?wait=true` on judge/sync endpoints only for local debugging without workers.

## Phase 2: Contest Correctness

- Owner is stored on `Contest.createdById`.
- Owner is not inserted as a participant automatically.
- Only owner can delete a contest, sync Codeforces, or recompute standings.
- Players see problem labels and links during a live contest.
- Ratings, tags, editorials, official solutions, and hidden tests stay hidden until the contest ends.
- Players can see their own full submissions.
- Same-team players can see activity/verdict only, not raw code or judge output.
- Other teams cannot see each other's submissions.
- Standings are recomputed from immutable `Submission` rows.

## Phase 3: Judge

- Keep `/api/v2/contests/:id/submissions` as the queue entrypoint.
- Add a worker that reads queued submissions.
- Execute with Judge0 first, then move to a hardened Docker judge later.
- Store one `SubmissionTestResult` per testcase.
- Mark the submission `FINISHED` only after all tests complete.
- Recompute standings after the database commit.

## Phase 4: External Sync

- Move Codeforces polling into a BullMQ worker.
- Store every poll as `ExternalSyncJob`.
- Store every external submission as `ExternalSyncEvent`.
- Deduplicate accepted submissions by `(source, externalSubmissionId)`.
- Emit Socket.IO `standings:update` only after successful database writes.

## Phase 5: Recommendations

- Normalize ratings into one DivineCode scale.
- Build target bands:
  - comfort: slightly below current rating
  - growth: current rating to moderately above
  - duel: above current rating for harder rounds
- Add topic mastery from solved/failed submissions.
- Recommend only problems not solved by the user.
- For group contests, include only problems unsolved by all selected participants.

## Phase 6: Duel

- Persist every duel in `DuelMatch`, `DuelPlayer`, `DuelRound`, and `DuelAnswer`.
- Use server-authoritative timers and scoring.
- Mix MCQ, debugging, counterexample, and short code-sprint rounds.
- Select duel questions from the harder recommendation band.
- Never trust client-side answer correctness.

## Phase 7: Interview Prep

- Seed DSA, OOP, DBMS, compiler, OS, networks, system design, and behavioral tracks.
- Let users select tracks.
- Track confidence and review state per question.
- Use spaced repetition for weak areas.

## Phase 8: Cloud Production

- Web: Vercel or Cloudflare Pages.
- API: Render, Railway, Fly.io, ECS, or Kubernetes.
- PostgreSQL: Neon, Supabase, RDS, or Railway Postgres.
- Redis: Upstash, Railway Redis, or Elasticache.
- Judge0: self-hosted container service.
- Storage: S3 or Cloudflare R2.
- Secrets: environment variables only; never commit `.env`.

## Phase 9: Acceptance Tests

Run these before calling the platform Level 4:

- Creator cannot accidentally become a player.
- Non-owner cannot open edit/delete/sync endpoints.
- Live contest hides rating/tags/editorial/solution/testcases from players.
- Other-team submissions are invisible.
- Team submissions hide raw code and judge output.
- Codeforces sync can run twice without duplicate solves.
- Recomputing standings twice returns the same result.
- Submissions before start and after end do not count.
- Wrong attempts after accepted do not increase penalty.
- Replacing live problems creates an audit log.
