# Phase 1 Foundation Plan

## Purpose

This phase turns DivineCode from a working prototype into a database-first production foundation. The goal is not to add every feature at once. The goal is to remove the biggest reliability risk: contests and standings depending on memory state.

## Scope

Included:

- PostgreSQL and Prisma as source of truth.
- Production-grade schema for users, handles, problems, tests, contests, submissions, sync, duels, ratings, and interview prep.
- Environment contract for database, Redis, Judge0, OAuth, external sync, and storage.
- Migration path away from MongoDB and in-memory maps.

Not included yet:

- Rewriting all API routes.
- Building the full judge worker.
- Building the full recommendation engine.
- Deploying V2 to production.

## Local Setup Target

Install Prisma tooling:

```bash
npm install --save-dev prisma
npm install --workspace apps/api @prisma/client
```

Validate schema:

```bash
npm run prisma:validate
```

Create local migration:

```bash
npm run prisma:migrate -- --name level4_foundation
```

Generate Prisma client:

```bash
npm run prisma:generate
```

## Implementation Order

1. Keep the current app running as V1 reference.
2. Validate the V2 Prisma schema.
3. Create the first PostgreSQL migration.
4. Add a Prisma client module in `apps/api`.
5. Add repository functions for:
   - users
   - external handles
   - problems
   - contests
   - submissions
   - standings
6. Move contest creation from memory/MongoDB to PostgreSQL.
7. Move submission storage from memory/MongoDB to PostgreSQL.
8. Recompute standings from submissions with one transaction.
9. Move Codeforces sync writes to PostgreSQL.
10. Emit Socket.IO events only after successful database commits.

## Contest Acceptance Tests

Before moving to Phase 2, these scenarios must work:

- A contest cannot start without at least one participant and one problem.
- The creator is stored as the contest owner and is not automatically inserted into `ContestParticipant`.
- Only the owner can edit contest settings, add/remove/replace problems, extend time, or delete the mashup.
- Non-owners cannot see the contest editing surface.
- During a live contest, non-owners cannot see problem rating, tags, tutorials, official solutions, hidden tests, or other players' restricted submission data.
- Same-team players can see team submissions when team visibility is enabled.
- Same-team players cannot fetch another player's raw source code or judge output unless the contest explicitly enables code sharing later.
- Players from other teams cannot see each other's submissions.
- A participant cannot receive two accepted solves for the same problem.
- A submission before contest start is stored but does not count.
- A submission after contest end is stored but does not count.
- Wrong attempts after accepted do not increase penalty.
- External Codeforces sync can be run twice without duplicating solves.
- Recomputing standings twice returns the same result.
- Replacing a live problem creates an audit log.
- Final standings are read-only after contest end.

## Recommended API Refactor

Create these API folders before rewriting endpoints:

```txt
apps/api/src/config
apps/api/src/prisma
apps/api/src/modules/auth
apps/api/src/modules/problems
apps/api/src/modules/contests
apps/api/src/modules/submissions
apps/api/src/modules/standings
apps/api/src/modules/external-sync
apps/api/src/modules/duels
apps/api/src/modules/ratings
apps/api/src/modules/interview
apps/api/src/realtime
apps/api/src/workers
```

Keep route handlers thin. Put business rules in service files and database writes in repository files.

## Phase 1 Definition Of Done

- `npm run build` passes.
- `npm run prisma:validate` passes.
- `npm run prisma:migrate -- --name level4_foundation` creates a migration.
- API has no contest-critical writes that only live in memory.
- Contest standings are deterministic from database submissions.
