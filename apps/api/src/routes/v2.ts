import { Express, NextFunction, Request, Response, Router } from 'express';
import { Server } from 'socket.io';
import { prisma } from '../prisma/client';
import { enqueueJudgeSubmission } from '../queues/queues';
import { canManageContest, sanitizeContestForViewer, viewerFromRequest } from '../modules/contests/contestRules';
import { 
  createContestV2, listContestsV2, loadContestForViewer, reorderContestProblemV2, 
  addContestProblemV2, removeContestProblemV2, replaceContestProblemV2, registerForContestV2, approveParticipant 
} from '../modules/contests/contestService';
import { createQueuedContestSubmission, unlockHiddenTestCase } from '../modules/contests/submissionService';
import { judgeQueuedSubmission, executeSubmission } from '../modules/judge/judge0Service';
import { recomputeContestStandings } from '../modules/standings/standingService';
import { scrapeProblemFromUrl } from '../modules/external-sync/problemScraper'; 
import { generateTestCasesWithAI, debugCodeWithAI } from '../modules/ai/aiService'; 
import { ContestStatus } from '@prisma/client';
import axios from 'axios';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import express from 'express';
import { submissionRouter } from './submissionRoutes';
import { profileRouter } from './profileRoutes';
import { interviewRouter } from './interviewRoutes'; 

const uploadDir = path.join(process.cwd(), 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } 
});

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

  io.on('connection', (socket) => {
    socket.on('joinContest', (contestId) => socket.join(`contest:${contestId}`));
    socket.on('joinTeam', (teamId) => socket.join(`team:${teamId}`));
    
    socket.on('sendLobbyMessage', (data) => {
      io.to(`contest:${data.contestId}`).emit('lobbyMessage', data);
    });

    socket.on('sendTeamMessage', async (data) => {
      try {
        const message = await prisma.teamMessage.create({
          data: { contestId: data.contestId, teamId: data.teamId, senderId: data.senderId, content: data.content },
          include: { sender: { select: { id: true, username: true, avatarUrl: true } } }
        });
        io.to(`team:${data.teamId}`).emit('teamMessage', message);
      } catch (err) {}
    });

    socket.on('join-voice', (teamId) => {
      socket.join(`voice:${teamId}`);
      socket.to(`voice:${teamId}`).emit('user-joined-voice', socket.id);
    });

    socket.on('voice-offer', ({ to, offer }) => {
      io.to(to).emit('voice-offer', { from: socket.id, offer });
    });

    socket.on('voice-answer', ({ to, answer }) => {
      io.to(to).emit('voice-answer', { from: socket.id, answer });
    });

    socket.on('voice-ice-candidate', ({ to, candidate }) => {
      io.to(to).emit('voice-ice-candidate', { from: socket.id, candidate });
    });

    socket.on('leave-voice', (teamId) => {
      socket.leave(`voice:${teamId}`);
      socket.to(`voice:${teamId}`).emit('user-left-voice', socket.id);
    });
  });

  // 👉 FIXED: The Missing AI Chatbot Route that powers your Avatar
  router.post('/ai/chat', asyncRoute(async (req, res) => {
    const { message, history } = req.body;
    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) return res.json({ reply: "I am unable to think right now. Please check the AI_API_KEY in the environment variables." });

    try {
      const contents = [];
      
      // Parse history if it was sent by the frontend
      if (Array.isArray(history)) {
         history.forEach(msg => {
            contents.push({
               role: msg.role === 'user' ? 'user' : 'model',
               parts: [{ text: msg.text || msg.content || msg.parts?.[0]?.text || '' }]
            });
         });
      }
      
      // Append the latest user message
      contents.push({ role: 'user', parts: [{ text: message || 'Hello' }] });

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const { data } = await axios.post(url, { contents });
      
      res.json({ reply: data.candidates[0].content.parts[0].text });
    } catch (e: any) {
      console.error('[AI Chat] Error:', e.response?.data || e.message);
      res.json({ reply: "My neural pathways are a bit tangled right now due to a network timeout. Please try asking again!" });
    }
  }));

  router.post('/contests/:id/register', asyncRoute(async (req, res) => {
    const viewer = viewerFromRequest(req);
    const contest = await registerForContestV2(req.params.id, {
      ...req.body,
      userId: viewer.userId,
      email: viewer.email,
      name: viewer.name
    });
    res.json(sanitizeContestForViewer(contest!, viewer));
  }));
  
  router.post('/contests/:id/participants/:participantId/approve', asyncRoute(async (req, res) => {
    const viewer = viewerFromRequest(req);
    if (!viewer.userId) throw new Error("Unauthorized");
    const updated = await approveParticipant(req.params.id, req.params.participantId, viewer.userId);
    res.json({ success: true, participant: updated });
  }));

  router.post('/contests/:id/unregister', asyncRoute(async (req, res) => {
    const viewer = viewerFromRequest(req);
    const contestId = req.params.id;
    
    const participant = await prisma.contestParticipant.findFirst({
        where: { contestId, userId: viewer.userId }
    });

    if (participant) {
        await prisma.contestParticipant.delete({ where: { id: participant.id } });
        await recomputeContestStandings(contestId);
    }
    
    const updatedContest = await loadContestForViewer(contestId);
    res.json(sanitizeContestForViewer(updatedContest!, viewer));
  }));

  router.post('/upload-image', upload.single('image'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    const imageUrl = `/uploads/${req.file.filename}`;
    res.status(200).json({ success: true, url: imageUrl });
  }));

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
      res.json({ requiresRedirect: true, url }); 
    }
  });

  router.get('/problems/lookup', asyncRoute(async (req, res) => {
    const { platform, code } = req.query;
    const cleanCode = String(code).replace(/\s+/g, '').toUpperCase();
    
    res.json({ 
      title: `${platform} Problem ${cleanCode}`, 
      platform, 
      code: cleanCode, 
      externalId: cleanCode, 
      url: platform === 'Codeforces' 
        ? `https://codeforces.com/problemset/problem/${cleanCode.match(/^\d+/)?.[0]}/${cleanCode.match(/[A-Z0-9]+$/)?.[0]}` 
        : '' 
    });
  }));

  router.post('/contests/:id/problems', asyncRoute(async (req, res) => {
    const viewer = viewerFromRequest(req);
    const contest = await addContestProblemV2(req.params.id, req.body, viewer.userId);
    res.json(sanitizeContestForViewer(contest!, viewer));
  }));

  router.put('/contests/:id/problems/:problemId', asyncRoute(async (req, res) => {
    const viewer = viewerFromRequest(req);
    const contest = await replaceContestProblemV2(req.params.id, req.params.problemId, req.body, viewer.userId);
    res.json(sanitizeContestForViewer(contest!, viewer));
  }));

  router.delete('/contests/:id/problems/:problemId', asyncRoute(async (req, res) => {
    const viewer = viewerFromRequest(req);
    const contest = await removeContestProblemV2(req.params.id, req.params.problemId, viewer.userId);
    res.json(sanitizeContestForViewer(contest!, viewer));
  }));

  router.get('/contests', async (req, res) => {
    const contests = await listContestsV2();
    res.json(contests.map(c => sanitizeContestForViewer(c, viewerFromRequest(req))));
  });

  router.post('/contests', asyncRoute(async (req, res) => {
    const contest = await createContestV2(req.body);
    res.status(201).json(sanitizeContestForViewer(contest, viewerFromRequest(req)));
  }));

  router.get('/contests/:id', asyncRoute(async (req, res) => {
    const contest = await loadContestForViewer(req.params.id);
    if (!contest) throw new Error('Contest not found');
    res.json(sanitizeContestForViewer(contest, viewerFromRequest(req)));
  }));

router.post('/contests/:id/problems/mashup', asyncRoute(async (req, res) => {
    const { type, url, customData, mcqData } = req.body;
    const contestId = req.params.id;

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

      const updatedProblem = await prisma.contestProblem.create({
        data: { contestId, problemId: problem.id, points: 100, titleSnapshot: problem.title, index: existingCount, label: nextLabel, platform: platform as any }
      });
      return res.json({ success: true, problem: updatedProblem });
    }

    if (type === 'MCQ' && mcqData) {
      let defaultTrack = await prisma.interviewTrack.findFirst();
      if (!defaultTrack) defaultTrack = await prisma.interviewTrack.create({ data: { slug: 'theory', title: 'Theory Track', type: 'DSA' } });

      const newMcqRow = await prisma.interviewQuestion.create({
        data: { 
          title: mcqData.prompt.substring(0, 30) + '...', 
          prompt: mcqData.prompt, 
          trackId: defaultTrack.id, 
          options: mcqData.options, 
          correctIndices: mcqData.correctIndices, 
          isMultiple: mcqData.correctIndices.length > 1, 
          difficulty: 'Medium' 
        }
      });

      await prisma.contestProblem.create({
        data: { 
          contestId, 
          interviewQuestionId: newMcqRow.id, 
          points: 50, 
          titleSnapshot: newMcqRow.title, 
          index: existingCount, 
          label: nextLabel, 
          platform: 'DIVINECODE', 
          isMCQ: true 
        } as any 
      });
      return res.json({ success: true });
    }

    if (type === 'CUSTOM' && customData) {
      const problem = await prisma.problem.create({
        data: {
          title: customData.title, description: customData.description, platform: 'DIVINECODE', source: 'INTERNAL', problemCode: `CUSTOM-${Date.now()}`, visibility: 'PUBLIC',
          testcases: { 
            create: (customData.testcases || []).map((c: any, i: number) => ({ 
              input: c.input, 
              expectedOutput: c.expectedOutput, 
              order: i, 
              isPublic: c.isPublic !== false, 
              type: c.isPublic === false ? 'HIDDEN' : 'SAMPLE' 
            })) 
          }
        }
      });
      await prisma.contestProblem.create({
        data: { 
          contestId, 
          problemId: problem.id, 
          points: 100, 
          titleSnapshot: problem.title, 
          index: existingCount, 
          label: nextLabel, 
          platform: 'DIVINECODE',
          isMCQ: false 
        } as any
      });
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Bad type parsing' });
  }));

  router.put('/contests/:id/problems/:problemId/reorder', asyncRoute(async (req, res) => {
    const { direction } = req.body;
    const contest = await reorderContestProblemV2(req.params.id, req.params.problemId, direction);
    res.json(sanitizeContestForViewer(contest!, viewerFromRequest(req)));
  }));

  router.post('/contests/:id/problems/:problemId/unlock-testcase', asyncRoute(async (req, res) => {
    const testcase = await unlockHiddenTestCase(req.params.id, req.params.problemId, viewerFromRequest(req));
    res.json({ success: true, testcase });
  }));

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

  router.get('/ai-dataset', asyncRoute(async (req, res) => {
    const problems = await prisma.aiProblemDataset.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50 
    });
    
    const count = await prisma.aiProblemDataset.count();
    
    res.json({ 
      success: true, 
      count: count, 
      message: `${count} Curated DSA and System Design questions loaded.`, 
      problems 
    });
  }));

  router.post('/problems/:id/generate-ai-testcases', asyncRoute(async (req, res) => {
     const cp = await prisma.contestProblem.findUnique({ where: { id: req.params.id }, include: { problem: true } });
     if (!cp || !cp.problem) return res.status(404).json({ error: 'Problem not found' });

     const description = cp.customDescription || cp.problem.description || cp.titleSnapshot;
     const testCases = await generateTestCasesWithAI(description, req.body.masterSolution);

     await prisma.testcase.createMany({
       data: testCases.map((tc: any, i: number) => ({
         problemId: cp.problemId!,
         input: tc.input,
         expectedOutput: tc.expectedOutput,
         explanation: tc.explanation || '',
         type: 'HIDDEN',
         order: i + 10
       }))
     });
     res.json({ success: true, generatedCount: testCases.length });
  }));

  router.post('/contests/:id/ai-recommendations', asyncRoute(async (req, res) => {
    const problems = await prisma.aiProblemDataset.findMany({
      take: 3,
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, recommendations: problems });
  }));
  
  router.post('/contests/:id/recommend-problems', asyncRoute(async (req, res) => {
    const problems = await prisma.aiProblemDataset.findMany({
      take: 2,
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, recommendations: problems });
  }));

  // 👉 ADD THIS ROUTE: Fixes the 404 error when clicking "Find Flaw"
router.post('/contests/:id/problems/:problemId/ai-debug', asyncRoute(async (req, res) => {
    const { userCode, problemDescription } = req.body;
    
    // Call the real service function defined in aiService.ts
    const aiDebugData = await debugCodeWithAI(userCode, problemDescription);
    
    if (!aiDebugData || !aiDebugData.hint) {
        return res.status(500).json({ error: "AI failed to generate a debug response." });
    }

    res.json({ success: true, aiDebugData });
  }));

  router.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(statusFromError(error)).json({ ok: false, error: error.message || 'Unexpected V2 API error' });
  });
  
  app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')));
  
  // Base Routes
  app.use('/api/v2', router);
  app.use('/api/v2/submissions', submissionRouter); 
  app.use('/api/v2/interview', interviewRouter);
  app.use('/api/v2/profile', profileRouter);
}