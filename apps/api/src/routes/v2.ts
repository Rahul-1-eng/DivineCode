import { Express, NextFunction, Request, Response, Router } from 'express';
import { Server } from 'socket.io';
import { prisma } from '../prisma/client';
import { enqueueCodeforcesContestSync, enqueueJudgeSubmission } from '../queues/queues';
import { canManageContest, findViewerParticipant, sanitizeContestForViewer, sanitizeSubmissionForViewer, viewerFromRequest } from '../modules/contests/contestRules';
import { addContestProblemV2, createContestV2, deleteContestV2, extendContestV2, listContestsV2, loadContestForViewer, removeContestProblemV2, replaceContestProblemV2, updateContestSettingsV2, getContestSubmissionsV2 } from '../modules/contests/contestService';
import { createQueuedContestSubmission } from '../modules/contests/submissionService';
import { syncCodeforcesContest } from '../modules/external-sync/codeforcesSyncService';
// Find your existing imports and add syncTestCasesFromCodeforces to the list
import { createInternalProblem, syncTestCasesFromCodeforces } from '../modules/problems/problemService';
import { recomputeContestStandings } from '../modules/standings/standingService';
import { recommendationBand } from '../modules/ratings/recommendationMath';
import { judgeQueuedSubmission, executeSubmission } from '../modules/judge/judge0Service';
// 👉 IMPORTS THE SUBMISSION ROUTER
import { submissionRouter } from './submissionRoutes';
import { syncUserRatings } from '../modules/external-sync/profileSyncService';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncRoute(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

function statusFromError(error: Error) {
  if (/not found/i.test(error.message)) return 404;
  if (/only|owner|permission|registered contest players/i.test(error.message)) return 403;
  if (/required|needs|cannot|at least|already/i.test(error.message)) return 400;
  return 500;
}

async function loadContestOrThrow(contestId: string) {
  const contest = await loadContestForViewer(contestId);
  if (!contest) throw new Error('Contest not found');
  return contest;
}

function requireOwner(contest: any, req: Request) {
  const viewer = viewerFromRequest(req);
  if (!canManageContest(contest, viewer)) throw new Error('Only the contest owner can perform this action');
  return viewer;
}

async function requireJudgeAccess(submissionId: string, req: Request) {
  const workerSecret = process.env.JUDGE_WORKER_SECRET;
  const providedSecret = String(req.headers['x-worker-secret'] || '').trim();
  if (workerSecret && providedSecret && workerSecret === providedSecret) return;

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      contest: {
        include: {
          createdBy: true,
          participants: {
            include: {
              user: true,
              externalHandle: true
            }
          }
        }
      }
    }
  });

  if (!submission) throw new Error('Submission not found');
  if (!submission.contest) return;
  requireOwner(submission.contest, req);
}

export function mountV2Routes(app: Express, io: Server) {
  const router = Router();

  router.get('/health', asyncRoute(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, sourceOfTruth: 'postgres-prisma' });
  }));

  // 👉 1. THE AUTOMATED POLLING ENDPOINT (CRON)
  // This route will be pinged every 1 minute to auto-sync all LIVE matches.
  router.post('/cron/sync-live-contests', asyncRoute(async (req, res) => {
    // Basic security so people don't spam your background workers
    if (req.headers['x-cron-secret'] !== (process.env.CRON_SECRET || 'dev-secret')) {
      res.status(401).json({ error: 'Unauthorized CRON trigger' });
      return;
    }
    
    // Find every contest that is currently running
    const liveContests = await prisma.contest.findMany({
      where: { status: 'RUNNING' }
    });

    // Toss them all into the BullMQ worker queue to process silently in the background
    for (const contest of liveContests) {
      await enqueueCodeforcesContestSync(contest.id);
    }

    res.json({ ok: true, status: 'Polling Started', jobsQueued: liveContests.length });
  }));

  // 👉 2. THE RATING SYNC ENDPOINT
  // Frontend calls this when a user links a new handle to calculate their new Global Rating
  router.post('/users/:id/sync-ratings', asyncRoute(async (req, res) => {
    const newRating = await syncUserRatings(req.params.id);
    res.json({ ok: true, globalRating: newRating });
  }));
  
  router.post('/execute', asyncRoute(async (req, res) => {
    const { sourceCode, language, input, expectedOutput } = req.body;
    const result = await executeSubmission(sourceCode, language, input || '', expectedOutput);
    res.json(result);
  }));

  router.post('/problems', asyncRoute(async (req, res) => {
    const problem = await createInternalProblem(req.body);
    res.status(201).json(problem);
  }));
router.post('/problems/:id/sync-testcases', asyncRoute(async (req, res) => {
    const { id } = req.params;
    const { url } = req.body; // Frontend sends this from problem.url
    if (!url) throw new Error('Problem URL is required');
    
    // We assume you have permission logic or owner check here
    const result = await syncTestCasesFromCodeforces(id, url);
    res.json({ ok: true, problem: result });
  }));
  router.get('/problems/:id', asyncRoute(async (req, res) => {
    const problem = await prisma.problem.findUnique({
      where: { id: req.params.id },
      include: {
        testcases: {
          where: { isPublic: true },
          orderBy: { order: 'asc' }
        },
        editorial: true
      }
    });
    if (!problem) throw new Error('Problem not found');
    res.json(problem);
  }));

  router.get('/contests', asyncRoute(async (_req, res) => {
    res.json(await listContestsV2());
  }));

  router.post('/contests', asyncRoute(async (req, res) => {
    const contest = await createContestV2(req.body);
    res.status(201).json(sanitizeContestForViewer(contest, viewerFromRequest(req)));
  }));

  router.get('/contests/:id', asyncRoute(async (req, res) => {
    const contest = await loadContestOrThrow(req.params.id);
    res.json(sanitizeContestForViewer(contest, viewerFromRequest(req)));
  }));

  router.delete('/contests/:id', asyncRoute(async (req, res) => {
    const contest = await loadContestOrThrow(req.params.id);
    const viewer = requireOwner(contest, req);
    await deleteContestV2(req.params.id, viewer.userId || contest.createdById);
    io.to(`contest:${req.params.id}`).emit('contest:deleted', { contestId: req.params.id });
    res.json({ ok: true, deletedContestId: req.params.id });
  }));

  router.put('/contests/:id', asyncRoute(async (req, res) => {
    const contest = await loadContestOrThrow(req.params.id);
    const viewer = requireOwner(contest, req);
    const updated = await updateContestSettingsV2(req.params.id, req.body, viewer.userId || contest.createdById);
    res.json(sanitizeContestForViewer(updated, viewerFromRequest(req)));
  }));

  router.post('/contests/:id/extend', asyncRoute(async (req, res) => {
    const contest = await loadContestOrThrow(req.params.id);
    const viewer = requireOwner(contest, req);
    const updated = await extendContestV2(req.params.id, Number(req.body.minutes || 15), viewer.userId || contest.createdById);
    res.json(sanitizeContestForViewer(updated, viewerFromRequest(req)));
  }));

  router.post('/contests/:id/problems', asyncRoute(async (req, res) => {
    const contest = await loadContestOrThrow(req.params.id);
    const viewer = requireOwner(contest, req);
    const updated = await addContestProblemV2(req.params.id, req.body, viewer.userId || contest.createdById);
    res.json(sanitizeContestForViewer(updated, viewerFromRequest(req)));
  }));

  router.delete('/contests/:id/problems/:problemId', asyncRoute(async (req, res) => {
    const contest = await loadContestOrThrow(req.params.id);
    const viewer = requireOwner(contest, req);
    const updated = await removeContestProblemV2(req.params.id, req.params.problemId, viewer.userId || contest.createdById);
    res.json(sanitizeContestForViewer(updated, viewerFromRequest(req)));
  }));

  router.put('/contests/:id/problems/:problemId', asyncRoute(async (req, res) => {
    const contest = await loadContestOrThrow(req.params.id);
    const viewer = requireOwner(contest, req);
    const updated = await replaceContestProblemV2(req.params.id, req.params.problemId, req.body, viewer.userId || contest.createdById);
    res.json(sanitizeContestForViewer(updated, viewerFromRequest(req)));
  }));

  router.delete('/contests/:id/members/:memberId', asyncRoute(async (req, res) => {
    const contest = await prisma.contest.findUnique({
      where: { id: req.params.id },
      include: { participants: true }
    });
    if (!contest) throw new Error('Contest not found');
    requireOwner(contest, req);

    await prisma.$transaction(async (tx) => {
      await tx.contestParticipant.deleteMany({
        where: { contestId: req.params.id, id: req.params.memberId }
      });
      await tx.submission.deleteMany({
        where: { contestId: req.params.id, participantId: req.params.memberId }
      });
    });

    const refreshedStandings = await recomputeContestStandings(req.params.id);
    io.to(`contest:${req.params.id}`).emit('standings:update', { contestId: req.params.id, standings: refreshedStandings });
    
    const updatedContest = await loadContestOrThrow(req.params.id);
    res.json(sanitizeContestForViewer(updatedContest, viewerFromRequest(req)));
  }));

  router.post('/contests/:id/submissions', asyncRoute(async (req, res) => {
    const submission = await createQueuedContestSubmission({
      contestId: req.params.id,
      contestProblemId: String(req.body.contestProblemId || req.body.problemId || ''),
      viewer: viewerFromRequest(req),
      language: req.body.language,
      code: req.body.code
    });
    res.status(201).json(submission);
  }));

  router.post('/submissions/:id/judge', asyncRoute(async (req, res) => {
    await requireJudgeAccess(req.params.id, req);
    if (String(req.query.wait || req.body?.wait || '') !== 'true') {
      const job = await enqueueJudgeSubmission(req.params.id);
      res.status(202).json({ ok: true, queued: true, job });
      return;
    }

    const result = await judgeQueuedSubmission(req.params.id);
    if (result.submission.contestId && result.standings) {
      io.to(`contest:${result.submission.contestId}`).emit('standings:update', {
        contestId: result.submission.contestId,
        standings: result.standings
      });
    }
    io.to(`submission:${result.submission.id}`).emit('submission:judged', result.submission);
    res.json({ ok: true, ...result });
  }));

  router.get('/contests/:id/submissions', asyncRoute(async (req, res) => {
    const viewer = viewerFromRequest(req);
    const emailFallback = (viewer?.email || req.headers['x-user-email'] || req.query.viewerEmail) as string | undefined;
    const submissions = await getContestSubmissionsV2(req.params.id, viewer?.userId, emailFallback);
    res.json(submissions);
  }));

  router.post('/contests/:id/recompute-standings', asyncRoute(async (req, res) => {
    const contest = await loadContestOrThrow(req.params.id);
    requireOwner(contest, req);
    const standings = await recomputeContestStandings(req.params.id);
    io.to(`contest:${req.params.id}`).emit('standings:update', { contestId: req.params.id, standings });
    res.json({ ok: true, standings });
  }));

  router.post('/contests/:id/sync/codeforces', asyncRoute(async (req, res) => {
    const contest = await loadContestOrThrow(req.params.id);
    requireOwner(contest, req);
    if (String(req.query.wait || req.body?.wait || '') !== 'true') {
      const job = await enqueueCodeforcesContestSync(req.params.id);
      res.status(202).json({ ok: true, queued: true, job });
      return;
    }

    const result = await syncCodeforcesContest(req.params.id);
    io.to(`contest:${req.params.id}`).emit('standings:update', {
      contestId: req.params.id,
      standings: result.standings
    });
    res.json({ ok: true, ...result });
  }));

  router.post('/recommendations/rating-band', asyncRoute(async (req, res) => {
    res.json(recommendationBand(req.body));
  }));

  router.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(statusFromError(error)).json({
      ok: false,
      error: error.message || 'Unexpected V2 API error'
    });
  });

  // 👉 MOUNT BOTH ROUTERS SAFELY HERE
  app.use('/api/v2', router);
  app.use('/api/v2/submissions', submissionRouter); 
}