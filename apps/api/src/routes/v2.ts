import { Express, NextFunction, Request, Response, Router } from 'express';
import { Server } from 'socket.io';
import { prisma } from '../prisma/client';
import { enqueueJudgeSubmission } from '../queues/queues';
import { canManageContest, sanitizeContestForViewer, viewerFromRequest } from '../modules/contests/contestRules';
import { 
  createContestV2, 
  listContestsV2, 
  loadContestForViewer 
} from '../modules/contests/contestService';
import { createQueuedContestSubmission } from '../modules/contests/submissionService';
import { judgeQueuedSubmission, executeSubmission } from '../modules/judge/judge0Service';
import { recomputeContestStandings } from '../modules/standings/standingService';
import { scrapeProblemFromUrl } from '../modules/external-sync/problemScraper'; 
import { ContestStatus } from '@prisma/client';
import axios from 'axios';

import { submissionRouter } from './submissionRoutes';
import { profileRouter } from './profileRoutes';
import { interviewRouter } from './interviewRoutes'; 

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;

function asyncRoute(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

function statusFromError(error: Error) {
  console.error("API Error Log:", error);
  if (/not found/i.test(error.message)) return 404;
  if (/only|owner|permission|registered contest players/i.test(error.message)) return 403;
  if (/required|needs|cannot|at least|already/i.test(error.message)) return 400;
  return 500;
}

// 👉 FIX: User who wrote the code is allowed to execute the judge
async function requireJudgeAccess(submissionId: string, req: Request) {
  const workerSecret = process.env.JUDGE_WORKER_SECRET;
  const providedSecret = String(req.headers['x-worker-secret'] || '').trim();
  if (workerSecret && providedSecret && workerSecret === providedSecret) return;

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { 
      user: true, 
      contest: { include: { createdBy: true, participants: { include: { user: true, externalHandle: true } } } } 
    }
  });

  if (!submission) throw new Error('Submission not found');
  const viewer = viewerFromRequest(req);
  if (viewer.email && submission.user?.email === viewer.email) return;
  if (viewer.userId && submission.userId === viewer.userId) return;
  
  if (submission.contest) {
    if (!canManageContest(submission.contest, viewer)) throw new Error('Only the contest owner can perform this action');
  }
}

export function mountV2Routes(app: Express, io: Server) {
  const router = Router();

  // 👉 1. SOCKETS
  io.on('connection', (socket) => {
    socket.on('joinContest', (contestId) => socket.join(`contest:${contestId}`));
    socket.on('joinTeam', (teamId) => socket.join(`team:${teamId}`));
    socket.on('sendTeamMessage', async (data) => {
      try {
        const message = await prisma.teamMessage.create({
          data: { contestId: data.contestId, teamId: data.teamId, senderId: data.senderId, content: data.content },
          include: { sender: { select: { id: true, username: true, avatarUrl: true } } }
        });
        io.to(`team:${data.teamId}`).emit('teamMessage', message);
      } catch (err) {}
    });
  });

  // 👉 2. PROXY ROUTE (Unified)
router.get('/proxy/problem', async (req, res) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    const { data } = await axios.get(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)' }, 
      timeout: 5000 
    });
    res.send(data);
  } catch (e) {
    console.warn(`[Proxy] Scrape failed for ${url}, sending fallback.`);
    // Instead of 502, we return a 200 with a flag. The frontend reads this flag and redirects the user.
    res.json({ requiresRedirect: true, url }); 
  }
});

  // 👉 3. CONTEST ROUTES (Unified & De-duplicated)
  router.get('/contests', async (req, res) => {
    const contests = await listContestsV2();
    res.json(contests.map(c => sanitizeContestForViewer(c, viewerFromRequest(req))));
  });

  router.post('/contests', asyncRoute(async (req, res) => {
    console.log("[Contest] Creating Shell:", req.body.title);
    const contest = await createContestV2(req.body);
    res.status(201).json(sanitizeContestForViewer(contest, viewerFromRequest(req)));
  }));

  router.get('/contests/:id', asyncRoute(async (req, res) => {
    const contest = await loadContestForViewer(req.params.id);
    if (!contest) throw new Error('Contest not found');
    res.json(sanitizeContestForViewer(contest, viewerFromRequest(req)));
  }));

  // 👉 4. MASHUP APPEND LOGIC
  router.post('/contests/:id/problems/mashup', asyncRoute(async (req, res) => {
    const { type, url, customData, mcqData } = req.body;
    const contestId = req.params.id;
    console.log(`[Mashup] Appending problem to ${contestId}`);

    const existingCount = await prisma.contestProblem.count({ where: { contestId } });
    const nextLabel = String.fromCharCode(65 + existingCount);

    if (type === 'URL' && url) {
      let scrapedTitle = 'External Problem Resource';
      let scrapedHtml = `<div style="text-align:center;"><a href="${url}">View Problem Here</a></div>`;
      let platform = 'OTHER';

      try {
        const data = await scrapeProblemFromUrl(url);
        if (data && data.title) {
          scrapedTitle = data.title;
          scrapedHtml = data.descriptionHtml;
          platform = data.platform || 'OTHER';
        }
      } catch (err) {}

      const problem = await prisma.problem.create({
        data: {
          title: scrapedTitle, description: scrapedHtml, platform: platform as any, source: 'EXTERNAL', url, problemCode: `SCRAPED-${Date.now()}`, visibility: 'PUBLIC'
        }
      });

      const updated = await prisma.contestProblem.create({
        data: { contestId, problemId: problem.id, points: 100, titleSnapshot: problem.title, index: existingCount, label: nextLabel, platform: platform as any }
      });
      return res.json({ success: true, problem: updated });
    }

    if (type === 'MCQ' && mcqData) {
      let defaultTrack = await prisma.interviewTrack.findFirst();
      if (!defaultTrack) defaultTrack = await prisma.interviewTrack.create({ data: { slug: 'theory', title: 'Theory Track', type: 'DSA' } });

      const newMcq = await prisma.interviewQuestion.create({
        data: { title: mcqData.prompt.substring(0, 30) + '...', prompt: mcqData.prompt, trackId: defaultTrack.id, options: mcqData.options, correctIndices: mcqData.correctIndices, isMultiple: mcqData.correctIndices.length > 1, difficulty: 'Medium' }
      });

      await prisma.contestProblem.create({
        data: { contestId, interviewQuestionId: newMcq.id, points: 50, titleSnapshot: newMcq.title, index: existingCount, label: nextLabel, platform: 'DIVINECODE' }
      });
      return res.json({ success: true });
    }

    if (type === 'CUSTOM' && customData) {
      const problem = await prisma.problem.create({
        data: {
          title: customData.title, description: customData.description, platform: 'DIVINECODE', source: 'INTERNAL', problemCode: `CUSTOM-${Date.now()}`, visibility: 'PUBLIC',
          testcases: { create: customData.testcases.map((c: any, i: number) => ({ input: c.input, expectedOutput: c.output, order: i, isPublic: true, type: 'SAMPLE' })) }
        }
      });
      await prisma.contestProblem.create({
        data: { contestId, problemId: problem.id, points: 100, titleSnapshot: problem.title, index: existingCount, label: nextLabel, platform: 'DIVINECODE' }
      });
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Bad type parsing' });
  }));

  // 👉 5. JUDGE & SUBMISSION ENDPOINTS
  router.post('/contests/:id/submissions', asyncRoute(async (req, res) => {
    const submission = await createQueuedContestSubmission({
      contestId: req.params.id, contestProblemId: String(req.body.contestProblemId || req.body.problemId || ''),
      viewer: viewerFromRequest(req), language: req.body.language, code: req.body.code
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
    if (result.submission.contestId) {
      const standings = await recomputeContestStandings(result.submission.contestId);
      io.to(`contest:${result.submission.contestId}`).emit('standings:update', { contestId: result.submission.contestId, standings });
    }
    io.to(`submission:${result.submission.id}`).emit('submission:judged', result.submission);
    res.json({ ok: true, ...result });
  }));

  router.post('/execute', asyncRoute(async (req, res) => {
    const { sourceCode, language, input, expectedOutput } = req.body;
    const result = await executeSubmission(sourceCode, language, input || '', expectedOutput);
    res.json(result);
  }));

  // 👉 6. AI DATASET
  router.get('/ai-dataset', asyncRoute(async (req, res) => {
     res.json({ success: true, problems: [] });
  }));

  router.post('/contests/:id/ai-recommendations', asyncRoute(async (req, res) => {
    res.json({ success: true, recommendations: [] });
  }));

  // 👉 7. ROUTER MOUNTING
  router.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(statusFromError(error)).json({ ok: false, error: error.message || 'Unexpected V2 API error' });
  });

  app.use('/api/v2', router);
  app.use('/api/v2/submissions', submissionRouter); 
  app.use('/api/v2/interview', interviewRouter);
  app.use('/api/v2/profile', profileRouter);
}