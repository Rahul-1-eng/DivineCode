import { Express, NextFunction, Request, Response, Router } from 'express';
import { Server } from 'socket.io';
import { prisma } from '../prisma/client';
import { enqueueCodeforcesContestSync, enqueueJudgeSubmission, getRewardsQueue } from '../queues/queues';
import { canManageContest, sanitizeContestForViewer, viewerFromRequest } from '../modules/contests/contestRules';
import { 
  addContestProblemV2, createContestV2, deleteContestV2, extendContestV2, 
  listContestsV2, loadContestForViewer, removeContestProblemV2, replaceContestProblemV2, 
  updateContestSettingsV2, getContestSubmissionsV2, registerForContestV2, overrideSubmissionPoints 
} from '../modules/contests/contestService';
import { createQueuedContestSubmission } from '../modules/contests/submissionService';
import { syncCodeforcesContest } from '../modules/external-sync/codeforcesSyncService';
import { createInternalProblem, syncTestCasesFromCodeforces, generateAndAppendAITestcases } from '../modules/problems/problemService';
import { recomputeContestStandings } from '../modules/standings/standingService';
import { recommendationBand } from '../modules/ratings/recommendationMath';
import { judgeQueuedSubmission, executeSubmission } from '../modules/judge/judge0Service';
import { syncUserRatings } from '../modules/external-sync/profileSyncService';
import { findFailingTestCaseWithAI, generateTestCasesWithAI } from '../modules/ai/aiService';
import { scrapeProblemFromUrl } from '../modules/external-sync/problemScraper'; 
import { ContestStatus } from '@prisma/client';
import axios from 'axios';
import * as cheerio from 'cheerio';

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

function safeSanitize(contest: any, req: Request) {
  try {
    return sanitizeContestForViewer(contest, viewerFromRequest(req));
  } catch (error) {
    return contest;
  }
}

export function mountV2Routes(app: Express, io: Server) {
  const router = Router();

  // 👉 TEAM COLLABORATION SOCKETS
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

  // ==========================================
  // MASSIVE AI DATASET & MASHUP ENDPOINTS
  // ==========================================
  router.get('/ai-dataset', asyncRoute(async (req, res) => {
    try {
      const problems = [
        { id: 'dp-1', title: 'Maximum Subarray', originalUrl: 'https://leetcode.com/problems/maximum-subarray/', tags: ['DP', 'Arrays'], difficulty: 'Medium', platform: 'LeetCode', rating: 1200 },
        { id: 'dp-2', title: 'Coin Change', originalUrl: 'https://leetcode.com/problems/coin-change/', tags: ['DP'], difficulty: 'Medium', platform: 'LeetCode', rating: 1400 },
        { id: 'graph-1', title: 'Shortest Routes I', originalUrl: 'https://cses.fi/problemset/task/1671', tags: ['Graphs', 'Dijkstra'], difficulty: 'Hard', platform: 'CSES', rating: 1600 },
        { id: 'graph-2', title: 'Building Roads', originalUrl: 'https://cses.fi/problemset/task/1666', tags: ['Graphs', 'DFS', 'DSU'], difficulty: 'Medium', platform: 'CSES', rating: 1400 },
        { id: 'cf-1', title: 'Watermelon', originalUrl: 'https://codeforces.com/problemset/problem/4/A', tags: ['Math', 'Implementation'], difficulty: 'Easy', platform: 'Codeforces', rating: 800 },
        { id: 'cf-2', title: 'Way Too Long Words', originalUrl: 'https://codeforces.com/problemset/problem/71/A', tags: ['Strings'], difficulty: 'Easy', platform: 'Codeforces', rating: 800 },
        { id: 'cf-3', title: 'I Wanna Be the Guy', originalUrl: 'https://codeforces.com/problemset/problem/469/A', tags: ['Greedy'], difficulty: 'Easy', platform: 'Codeforces', rating: 800 },
        { id: 'cf-4', title: 'Puzzles', originalUrl: 'https://codeforces.com/problemset/problem/337/A', tags: ['Sorting', 'Greedy'], difficulty: 'Easy', platform: 'Codeforces', rating: 900 },
        { id: 'lc-1', title: 'Two Sum', originalUrl: 'https://leetcode.com/problems/two-sum/', tags: ['Arrays', 'Hash Table'], difficulty: 'Easy', platform: 'LeetCode', rating: 1000 },
        { id: 'lc-2', title: 'Longest Substring Without Repeating Characters', originalUrl: 'https://leetcode.com/problems/longest-substring-without-repeating-characters/', tags: ['Strings', 'Sliding Window'], difficulty: 'Medium', platform: 'LeetCode', rating: 1500 },
        { id: 'at-1', title: 'Frog 1', originalUrl: 'https://atcoder.jp/contests/dp/tasks/dp_a', tags: ['DP'], difficulty: 'Easy', platform: 'AtCoder', rating: 1000 },
        { id: 'at-2', title: 'Knapsack 1', originalUrl: 'https://atcoder.jp/contests/dp/tasks/dp_d', tags: ['DP'], difficulty: 'Medium', platform: 'AtCoder', rating: 1400 },
        { id: 'cses-1', title: 'Weird Algorithm', originalUrl: 'https://cses.fi/problemset/task/1068', tags: ['Math'], difficulty: 'Easy', platform: 'CSES', rating: 800 },
        { id: 'cses-2', title: 'Missing Number', originalUrl: 'https://cses.fi/problemset/task/1083', tags: ['Math', 'Bit Manipulation'], difficulty: 'Easy', platform: 'CSES', rating: 800 },
        { id: 'cses-3', title: 'Subordinates', originalUrl: 'https://cses.fi/problemset/task/1674', tags: ['Trees', 'DFS'], difficulty: 'Medium', platform: 'CSES', rating: 1500 },
      ];
      res.json({ success: true, problems });
    } catch {
      res.json({ success: true, problems: [] });
    }
  }));

  router.post('/contests/:id/ai-recommendations', asyncRoute(async (req, res) => {
    const recs = [
      { id: 'dp-1', title: 'Dynamic Programming: Kadanes Maximum Array', originalUrl: 'https://leetcode.com/problems/maximum-subarray/', tags: ['DP'], difficulty: 'Medium' },
      { id: 'graph-1', title: 'Graph Theory: Shortest Routes via Dijkstra', originalUrl: 'https://cses.fi/problemset/task/1671', tags: ['Graphs'], difficulty: 'Hard' }
    ];
    res.json({ success: true, recommendations: recs });
  }));

  router.post('/contests/:id/problems/mashup', asyncRoute(async (req, res) => {
    const { type, url, customData, mcqData } = req.body;
    const contestId = req.params.id;

    const existingCount = await prisma.contestProblem.count({ where: { contestId } });
    const nextLabel = String.fromCharCode(65 + existingCount);

    if (type === 'URL' && url) {
      let scrapedTitle = 'External Problem Resource';
      // 👉 NO ERROR THROWN: If scraping fails, it injects this anchor link fallback directly into the HTML
      let scrapedHtml = `<div style="padding:30px;text-align:center;background:#020617;border-radius:12px;border:1px dashed #334155;">
        <h3 style="color:#94a3b8;margin-bottom:15px;">Statement view blocked by host platform</h3>
        <p style="color:#64748b;margin-bottom:25px;">Please read the problem constraints explicitly on the original site.</p>
        <a href="${url}" target="_blank" style="padding:12px 20px;background:#0ea5e9;color:white;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Open Original Problem Link ↗</a>
      </div>`;
      let cases: any[] = [];
      let platform = 'OTHER';

      try {
        const data = await scrapeProblemFromUrl(url);
        if (data && data.title) {
          scrapedTitle = data.title;
          scrapedHtml = data.descriptionHtml;
          cases = data.testcases || [];
          platform = data.platform || 'OTHER';
        }
      } catch (err) {
        // Silently catch the error. Fallback HTML ensures execution pipeline continues smoothly.
      }

      const problem = await prisma.problem.create({
        data: {
          title: scrapedTitle, description: scrapedHtml, platform: platform as any, source: 'EXTERNAL', url, problemCode: `SCRAPED-${Date.now()}`, visibility: 'PUBLIC',
          testcases: { create: cases.map((c, i) => ({ input: c.input, expectedOutput: c.expectedOutput, order: i, isPublic: true, type: 'SAMPLE' })) }
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

  // ==========================================
  // STANDARD CONTEST & SUBMISSION ENDPOINTS
  // ==========================================
  router.get('/health', asyncRoute(async (_req, res) => res.json({ ok: true })));

  router.post('/contests', asyncRoute(async (req, res) => {
    const contest = await createContestV2(req.body);
    res.status(201).json(safeSanitize(contest, req));
  }));

  router.get('/contests/:id', asyncRoute(async (req, res) => {
    const contest = await loadContestOrThrow(req.params.id);
    res.json(safeSanitize(contest, req));
  }));

  router.post('/contests/:id/submissions', asyncRoute(async (req, res) => {
    const submission = await createQueuedContestSubmission({
      contestId: req.params.id, contestProblemId: String(req.body.contestProblemId || req.body.problemId || ''),
      viewer: viewerFromRequest(req), language: req.body.language, code: req.body.code
    });
    res.status(201).json(submission);
  }));

  router.post('/submissions/:id/judge', asyncRoute(async (req, res) => {
    const result = await judgeQueuedSubmission(req.params.id);
    
    if (result.submission.contestId) {
      const standings = await recomputeContestStandings(result.submission.contestId);
      io.to(`contest:${result.submission.contestId}`).emit('standings:update', { contestId: result.submission.contestId, standings });
    }

    if (result.submission.verdict === 'ACCEPTED' && result.submission.teamId) {
      io.to(`team:${result.submission.teamId}`).emit('team_problem_solved', {
         problemId: result.submission.contestProblemId, submissionId: result.submission.id,
         userId: result.submission.userId, teamId: result.submission.teamId
      });
    }

    io.to(`submission:${result.submission.id}`).emit('submission:judged', result.submission);
    res.json({ ok: true, ...result });
  }));

  router.post('/execute', asyncRoute(async (req, res) => {
    const { sourceCode, language, input } = req.body;
    const result = await executeSubmission(sourceCode, language, input || '');
    res.json(result);
  }));

  router.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(statusFromError(error)).json({ ok: false, error: error.message || 'Unexpected V2 API error' });
  });

  app.use('/api/v2', router);
  app.use('/api/v2/submissions', submissionRouter); 
  app.use('/api/v2/interview', interviewRouter);
  app.use('/api/v2/profile', profileRouter);
}