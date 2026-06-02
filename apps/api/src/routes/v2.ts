import { Express, NextFunction, Request, Response, Router } from 'express';
import { Server } from 'socket.io';
import { prisma } from '../prisma/client';
import { enqueueCodeforcesContestSync, enqueueJudgeSubmission } from '../queues/queues';
import { canManageContest, findViewerParticipant, sanitizeContestForViewer, sanitizeSubmissionForViewer, viewerFromRequest } from '../modules/contests/contestRules';
import { 
  addContestProblemV2, createContestV2, deleteContestV2, extendContestV2, 
  listContestsV2, loadContestForViewer, removeContestProblemV2, replaceContestProblemV2, 
  updateContestSettingsV2, getContestSubmissionsV2,
  registerForContestV2, overrideSubmissionPoints 
} from '../modules/contests/contestService';
import { createQueuedContestSubmission } from '../modules/contests/submissionService';
import { syncCodeforcesContest } from '../modules/external-sync/codeforcesSyncService';
import { createInternalProblem, syncTestCasesFromCodeforces } from '../modules/problems/problemService';
import { recomputeContestStandings } from '../modules/standings/standingService';
import { recommendationBand } from '../modules/ratings/recommendationMath';
import { judgeQueuedSubmission, executeSubmission } from '../modules/judge/judge0Service';
import { submissionRouter } from './submissionRoutes';
import { syncUserRatings } from '../modules/external-sync/profileSyncService';
import { ContestStatus } from '@prisma/client';
import axios from 'axios';
import * as cheerio from 'cheerio';
// 👉 FIX 1: Import getRewardsQueue instead of rewardsQueue
import { getRewardsQueue } from '../queues/queues';

import { profileRouter } from './profileRoutes';
import { interviewRouter } from './interviewRoutes'; 
import { generateAndAppendAITestcases } from '../modules/problems/problemService';
import { findFailingTestCaseWithAI } from '../modules/ai/aiService';


type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;

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

  // Endpoint 1: For the Problem Setter to Auto-Generate Test Cases
router.post('/problems/:id/generate-ai-testcases', asyncRoute(async (req, res) => {
    const { masterSolution } = req.body;
    
    if (!masterSolution) {
      res.status(400).json({ error: "Master solution is required for AI generation." });
      return;
    }
    
    // Now passing BOTH arguments: the problem ID and the master solution
    const testcases = await generateAndAppendAITestcases(req.params.id, masterSolution);
    res.json({ success: true, generatedCount: testcases.length, testcases });
  }));


  // 👉 FIX 1: The Problem Proxy (Bypasses Codeforces Iframe Block)
// 👉 FIX 1: The Problem Proxy (Bypasses Codeforces Iframe Block)
  router.get('/proxy/problem', asyncRoute(async (req, res, next) => {
    const url = String(req.query.url);
    if (!url || !url.includes('codeforces')) {
      res.status(400).send('Invalid URL');
      return; // Separated the return statement so TypeScript is happy
    }
    
    try {
      const { data } = await axios.get(url);
      const $ = cheerio.load(data);
      const statementHtml = $('.problem-statement').html();
      
      res.send(`
        <html><head>
          <link rel="stylesheet" href="https://codeforces.com/css/font-awesome.min.css" />
          <link rel="stylesheet" href="https://codeforces.com/css/default.css" />
          <script type="text/javascript" async src="https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.7/MathJax.js?config=TeX-MML-AM_CHTML"></script>
          <style>body { padding: 15px; background: #fff; color: #000; font-family: sans-serif; }</style>
        </head>
        <body><div class="problem-statement" style="margin:0;">${statementHtml || 'Problem statement not found.'}</div></body></html>
      `);
    } catch (e) {
      res.status(500).send('Failed to fetch problem statement.');
    }
  }));
  // 👉 FIX 3: AI Testcases (Now accepts masterSolution from body)
  router.post('/problems/:id/generate-ai-testcases', asyncRoute(async (req, res) => {
    const { masterSolution } = req.body;
    if (!masterSolution) throw new Error("Master solution is required for AI generation.");
    
    const testcases = await generateAndAppendAITestcases(req.params.id, masterSolution);
    res.json({ success: true, generatedCount: testcases.length, testcases });
  }));
  // Endpoint 2: For the Contestant to use the AI Debugger (Applies Penalty)
  router.post('/contests/:id/problems/:problemId/ai-debug', asyncRoute(async (req, res) => {
    const viewerEmail = req.headers['x-user-email'] as string;
    const { id: contestId, problemId } = req.params;
    const { userCode, problemDescription } = req.body;

    const user = await prisma.user.findUnique({ where: { email: viewerEmail } });
    if (!user) throw new Error("Unauthorized");

    // 1. Fetch AI response first
    const aiResponse = await findFailingTestCaseWithAI(problemDescription, userCode);

    // 2. Apply the 50-point penalty to their standings
    const participant = await prisma.contestParticipant.findUnique({
      where: { contestId_userId: { contestId, userId: user.id } },
      include: { standing: true }
    });

    if (participant && participant.standing) {
      await prisma.contestStanding.update({
        where: { participantId: participant.id },
        data: { testcasePenalty: participant.standing.testcasePenalty + 50 }
      });
      // Recalculate standings immediately
      await recomputeContestStandings(contestId);
    }

    res.json({ success: true, aiDebugData: aiResponse });
  }));
   // 👉 Add this block INSIDE `mountV2Routes(app: Express, io: Server)` in apps/api/src/routes/v2.ts

  // 👉 FIX: Override submission points authorization fix
  router.post('/contests/:id/submissions/:submissionId/override', asyncRoute(async (req, res) => {
    const viewerEmail = req.headers['x-user-email'] as string;
    if (!viewerEmail) throw new Error("Unauthorized");
    
    // Resolve exact actorId based on email
    const user = await prisma.user.findUnique({ where: { email: viewerEmail } });
    if (!user) throw new Error("Unauthorized: User not found");

    const { manualPoints } = req.body;
    const contest = await overrideSubmissionPoints(
      req.params.id,
      req.params.submissionId,
      manualPoints,
      user.id // Pass the resolved user ID
    );
    res.json(sanitizeContestForViewer(contest, viewerFromRequest(req)));
  }));

  // 👉 FIX: Testcase Penalty Route
  router.post('/contests/:id/problems/:problemId/penalty', asyncRoute(async (req, res) => {
    const viewerEmail = req.headers['x-user-email'] as string;
    const contestId = req.params.id;
    const user = await prisma.user.findUnique({ where: { email: viewerEmail } });
    if (!user) throw new Error("Unauthorized");

    const participant = await prisma.contestParticipant.findUnique({
      where: { contestId_userId: { contestId, userId: user.id } },
      include: { standing: true }
    });

    if (participant && participant.standing) {
      await prisma.contestStanding.update({
        where: { participantId: participant.id },
        data: { testcasePenalty: participant.standing.testcasePenalty + 50 }
      });
      await recomputeContestStandings(contestId);
    }
    res.json({ success: true, message: "Penalty applied" });
  }));

  // 👉 FIX: Mid-Contest Unregister Route
  router.post('/contests/:id/unregister', asyncRoute(async (req, res) => {
    const viewerEmail = req.headers['x-user-email'] as string;
    const contestId = req.params.id;
    
    const user = await prisma.user.findUnique({ where: { email: viewerEmail } });
    if (!user) throw new Error("Unauthorized");

    const contest = await prisma.contest.findUnique({ where: { id: contestId } });
    if (!contest) throw new Error("Contest not found");

    const halfTime = contest.startTime.getTime() + (contest.durationMinutes * 60000 / 2);
    if (Date.now() > halfTime) {
      throw new Error("Cannot unregister after half-time has passed.");
    }

    await prisma.contestParticipant.deleteMany({
      where: { contestId, userId: user.id }
    });
    
    await recomputeContestStandings(contestId);
    res.json({ success: true, message: "Unregistered successfully" });
  }));
  router.post('/cron/sync-live-contests', asyncRoute(async (req, res) => {
    if (req.headers['x-cron-secret'] !== (process.env.CRON_SECRET || 'dev-secret')) {
      res.status(401).json({ error: 'Unauthorized CRON trigger' });
      return;
    }
    const liveContests = await prisma.contest.findMany({ where: { status: 'RUNNING' } });
    for (const contest of liveContests) {
      await enqueueCodeforcesContestSync(contest.id);
    }
    res.json({ ok: true, status: 'Polling Started', jobsQueued: liveContests.length });
  }));

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
    const { url } = req.body; 
    if (!url) throw new Error('Problem URL is required');
    const result = await syncTestCasesFromCodeforces(id, url);
    res.json({ ok: true, problem: result });
  }));

  router.get('/problems/:id', asyncRoute(async (req, res) => {
    const problem = await prisma.problem.findUnique({
      where: { id: req.params.id },
      include: {
        testcases: { where: { isPublic: true }, orderBy: { order: 'asc' } },
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

  router.post('/contests/:id/register', asyncRoute(async (req, res) => {
    const viewer = viewerFromRequest(req);
    const contest = await registerForContestV2(req.params.id, {
      ...req.body,
      email: viewer.email,
      name: viewer.name,
      userId: viewer.userId
    });
    res.json(sanitizeContestForViewer(contest, viewer));
  }));

  router.post('/contests/:id/submissions/:submissionId/override', asyncRoute(async (req, res) => {
    const viewer = viewerFromRequest(req);
    if (!viewer.userId) throw new Error("Unauthorized");
    
    const { manualPoints } = req.body;
    const contest = await overrideSubmissionPoints(
      req.params.id,
      req.params.submissionId,
      manualPoints,
      viewer.userId
    );
    res.json(sanitizeContestForViewer(contest, viewer));
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
      await tx.contestParticipant.deleteMany({ where: { contestId: req.params.id, id: req.params.memberId } });
      await tx.submission.deleteMany({ where: { contestId: req.params.id, participantId: req.params.memberId } });
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

  router.post('/contests/:id/finalize', async (req, res) => {
    try {
      const { id } = req.params;
      const email = req.headers['x-user-email'] as string;

      const contest = await prisma.contest.findUnique({
        where: { id },
        include: { createdBy: true }
      });

      if (!contest) return res.status(404).json({ error: 'Contest not found' });
      
      if (contest.createdBy?.email !== email) {
        return res.status(403).json({ error: 'Only the contest owner can finalize it.' });
      }

      if (contest.status === ContestStatus.ENDED) {
        return res.status(400).json({ error: 'Contest is already finalized.' });
      }

      await prisma.contest.update({
        where: { id },
        data: { status: ContestStatus.ENDED, endTime: new Date() }
      });

      if (contest.isRated) {
        // 👉 FIX 2: Execute getRewardsQueue() as a function
        await getRewardsQueue().add('process-rewards', { contestId: id });
      }

      return res.json({ 
        success: true, 
        message: contest.isRated ? 'Contest finalized. Ratings and coins are calculating in the background.' : 'Unrated contest finalized.' 
      });

    } catch (error: any) {
      console.error('Finalize error:', error);
      return res.status(500).json({ error: 'Failed to finalize contest.' });
    }
  });

  router.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(statusFromError(error)).json({
      ok: false,
      error: error.message || 'Unexpected V2 API error'
    });
  });

  app.use('/api/v2', router);
  app.use('/api/v2/submissions', submissionRouter); 
  app.use('/api/v2/interview', interviewRouter);
  app.use('/api/v2/profile', profileRouter);
}