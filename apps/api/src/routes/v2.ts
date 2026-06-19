import { Express, NextFunction, Request, Response, Router } from 'express';
import { Server } from 'socket.io';
import { prisma } from '../prisma/client';
import { enqueueJudgeSubmission } from '../queues/queues';
import { canManageContest, sanitizeContestForViewer, viewerFromRequest } from '../modules/contests/contestRules';
import { 
  createContestV2, listContestsV2, loadContestForViewer, reorderContestProblemV2, 
  addContestProblemV2, removeContestProblemV2, replaceContestProblemV2, registerForContestV2, approveParticipant,
  createTeamForContest, joinTeamWithInviteCode, requestToJoinTeam,
  updateContestSettingsV2, deleteContestV2, extendContestV2, getContestSubmissionsV2, overrideSubmissionPoints
} from '../modules/contests/contestService';
import { syncCodeforcesContest } from '../modules/external-sync/codeforcesSyncService';
import { createQueuedContestSubmission, unlockHiddenTestCase } from '../modules/contests/submissionService';
import { judgeQueuedSubmission, executeSubmission } from '../modules/judge/judge0Service';
import { recomputeContestStandings } from '../modules/standings/standingService';
import { processContestRewards } from '../modules/ratings/ratingService';
import { scrapeProblemFromUrl } from '../modules/external-sync/problemScraper'; 
import { generateTestCasesWithAI, debugCodeWithAI, generateToughTestCases } from '../modules/ai/aiService'; 
import { ContestStatus } from '@prisma/client';
import axios from 'axios';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import express from 'express';
import { submissionRouter } from './submissionRoutes';
import { profileRouter } from './profileRoutes';
import { interviewRouter } from './interviewRoutes'; 
import crypto from 'crypto';
import { mcqQuestions } from '../data/mcq'; // Added import for Logical Games

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
  if (/only|owner|permission|registered contest players|unauthorized|forbidden/i.test(error.message)) return 403;
  if (/required|needs|cannot|at least|already/i.test(error.message)) return 400;
  return 500;
}

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'user';
}

async function resolveViewerUserId(viewer: ReturnType<typeof viewerFromRequest>, createIfMissing = false) {
  if (viewer.userId) {
    const byId = await prisma.user.findUnique({ where: { id: viewer.userId } });
    if (byId) return byId.id;
  }

  const email = viewer.email?.trim().toLowerCase();
  if (!email) return undefined;

  const byEmail = await prisma.user.findUnique({ where: { email } });
  if (byEmail || !createIfMissing) return byEmail?.id;

  const usernameSeed = slugify(viewer.name || email.split('@')[0] || 'user');
  const created = await prisma.user.upsert({
    where: { email },
    update: { name: viewer.name || undefined },
    create: {
      email,
      name: viewer.name || email.split('@')[0],
      username: `${usernameSeed}_${Math.random().toString(36).slice(2, 8)}`
    }
  });
  return created.id;
}

async function resolvedViewerFromRequest(req: Request, createIfMissing = false) {
  const viewer = viewerFromRequest(req);
  const resolvedUserId = await resolveViewerUserId(viewer, createIfMissing);
  return { ...viewer, userId: resolvedUserId || viewer.userId };
}

async function requireContestOwner(req: Request) {
  const viewer = await resolvedViewerFromRequest(req);
  const contest = await prisma.contest.findUnique({
    where: { id: req.params.id },
    include: { createdBy: true, participants: { include: { user: true, externalHandle: true } } }
  });
  if (!contest) throw new Error('Contest not found');
  if (!canManageContest(contest, viewer)) throw new Error('Only the contest owner can perform this action');
  if (!viewer.userId) throw new Error('Unauthorized');
  return viewer;
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
          include: { 
            sender: { 
              select: { 
                id: true, 
                username: true, 
                email: true,
                name: true,
                avatarUrl: true 
              } 
            } 
          }
        });
        const formattedMessage = {
          ...message,
          sender: message.sender ? {
            id: message.sender.id,
            username: message.sender.username,
            email: message.sender.email,
            name: message.sender.name,
            avatarUrl: message.sender.avatarUrl
          } : null
        };
        io.to(`team:${data.teamId}`).emit('teamMessage', formattedMessage);
      } catch (err) { console.error('[TeamMessage Error]', err); }
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

  // 👉 NEW: Logical Games MCQ Dataset Route
  router.get('/mcqs', (req, res) => {
    try {
      res.json(mcqQuestions);
    } catch (error) {
      res.status(500).json({ error: "Failed to load logical games dataset." });
    }
  });

  router.post('/ai/chat', asyncRoute(async (req, res) => {
    const { message, history, image } = req.body;
    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) return res.json({ reply: "I am unable to think right now. Please check the AI_API_KEY in the environment variables." });

    try {
      const contents = [];
      
      if (Array.isArray(history)) {
         history.forEach(msg => {
            contents.push({
               role: msg.role === 'user' ? 'user' : 'model',
               parts: [{ text: msg.text || msg.content || msg.parts?.[0]?.text || '' }]
            });
         });
      }
      
      const currentParts: any[] = [];
      if (message) currentParts.push({ text: message });
      else if (!message && image) currentParts.push({ text: 'Please analyze this image and answer any related questions.' });

      if (image) {
          const mimeType = image.match(/data:(.*?);base64/)?.[1] || 'image/jpeg';
          const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
          currentParts.push({ inlineData: { data: base64Data, mimeType } });
      }

      contents.push({ role: 'user', parts: currentParts });

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const { data } = await axios.post(url, { contents });
      
      res.json({ reply: data.candidates[0].content.parts[0].text });
    } catch (e: any) {
      console.error('[AI Chat] Error:', e.response?.data || e.message);
      res.json({ reply: "My neural pathways are a bit tangled right now. Please try asking again!" });
    }
  }));

  router.post('/ai/generate-testcases', asyncRoute(async (req, res) => {
    const { problemDescription } = req.body;
    
    if (!problemDescription) {
      return res.status(400).json({ error: 'Problem description or image payload required' });
    }

    try {
      const testcases = await generateToughTestCases(problemDescription);
      
      if (!testcases || testcases.length === 0) {
        return res.status(500).json({ error: 'Failed to generate testcases from the provided input' });
      }
      
      res.json({ success: true, testcases });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'AI Generation Failed' });
    }
  }));

  router.post('/auth/register', asyncRoute(async (req, res) => {
    const { username, email, name, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email and password are required fields.' });
    }

    const cleanUsername = String(username).trim();
    const cleanEmail = String(email).trim().toLowerCase();

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: cleanUsername },
          { email: cleanEmail }
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Username or email handle already registered.' });
    }

    const hash = crypto.createHash('sha256').update(password).digest('hex');

    const newUser = await prisma.user.create({
      data: {
        username: cleanUsername,
        email: cleanEmail,
        name: name || cleanUsername,
        passwordHash: hash
      }
    });

    res.status(201).json({ success: true, userId: newUser.id });
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
    const viewer = await resolvedViewerFromRequest(req);
    if (!viewer.userId) throw new Error("Unauthorized");
    const updated = await approveParticipant(req.params.id, req.params.participantId, viewer.userId);
    res.json({ success: true, participant: updated });
  }));

  router.post('/contests/:id/team/create', asyncRoute(async (req, res) => {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.userId) throw new Error("Unauthorized");
    const { teamName, codeforcesHandle, isOfficial } = req.body;
    if (!teamName || !teamName.trim()) throw new Error("Team name is required");
    
    await createTeamForContest(req.params.id, teamName.trim(), viewer.userId, codeforcesHandle, Boolean(isOfficial));
    const contest = await loadContestForViewer(req.params.id);
    res.json(sanitizeContestForViewer(contest!, viewer));
  }));

  router.post('/contests/:id/team/join-invite', asyncRoute(async (req, res) => {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.userId) throw new Error("Unauthorized");
    const { inviteCode, codeforcesHandle, isOfficial } = req.body;
    if (!inviteCode) throw new Error("Invite code is required");
    
    await joinTeamWithInviteCode(req.params.id, inviteCode, viewer.userId, codeforcesHandle, Boolean(isOfficial));
    const contest = await loadContestForViewer(req.params.id);
    res.json(sanitizeContestForViewer(contest!, viewer));
  }));

  router.post('/contests/:id/team/request-join', asyncRoute(async (req, res) => {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.userId) throw new Error("Unauthorized");
    const { teamName, teamId, codeforcesHandle } = req.body;
    const teamTarget = teamId || teamName;
    if (!teamTarget) throw new Error("Team is required");
    
    await requestToJoinTeam(req.params.id, teamTarget, viewer.userId, codeforcesHandle);
    const contest = await loadContestForViewer(req.params.id);
    res.json(sanitizeContestForViewer(contest!, viewer));
  }));

  router.post('/contests/:id/unregister', asyncRoute(async (req, res) => {
    const viewer = await resolvedViewerFromRequest(req);
    if (!viewer.userId) throw new Error("Unauthorized to unregister. User ID missing.");
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
      res.json({ success: true, html: data });
    } catch (e) {
      console.warn(`[Proxy] Scrape failed for ${url}, sending fallback.`);
      res.json({ requiresRedirect: true, url }); 
    }
  });

  router.get('/problems/lookup', asyncRoute(async (req, res) => {
    const { platform, code } = req.query;
    const cleanCode = String(code).replace(/\s+/g, '').toUpperCase();
    const cfMatch = cleanCode.match(/^(\d+)([A-Z][0-9]?)$/);
    
    res.json({ 
      title: `${platform} Problem ${cleanCode}`, 
      platform, 
      code: cleanCode, 
      externalId: cleanCode, 
      contestCode: cfMatch?.[1],
      problemIndex: cfMatch?.[2],
      url: platform === 'Codeforces' 
        ? (cfMatch ? `https://codeforces.com/problemset/problem/${cfMatch[1]}/${cfMatch[2]}` : '') 
        : '' 
    });
  }));

  router.post('/contests/:id/problems', asyncRoute(async (req, res) => {
    const viewer = await requireContestOwner(req);
    const contest = await addContestProblemV2(req.params.id, req.body, viewer.userId);
    res.json(sanitizeContestForViewer(contest!, viewer));
  }));

  router.put('/contests/:id/problems/:problemId', asyncRoute(async (req, res) => {
    const viewer = await requireContestOwner(req);
    const contest = await replaceContestProblemV2(req.params.id, req.params.problemId, req.body, viewer.userId);
    res.json(sanitizeContestForViewer(contest!, viewer));
  }));

  router.delete('/contests/:id/problems/:problemId', asyncRoute(async (req, res) => {
    const viewer = await requireContestOwner(req);
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

  router.put('/contests/:id', asyncRoute(async (req, res) => {
    const viewer = await requireContestOwner(req);
    const contest = await updateContestSettingsV2(req.params.id, req.body, viewer.userId);
    res.json(sanitizeContestForViewer(contest!, viewer));
  }));

  router.delete('/contests/:id', asyncRoute(async (req, res) => {
    const viewer = await requireContestOwner(req);
    await deleteContestV2(req.params.id, viewer.userId);
    res.json({ success: true });
  }));

  router.post('/contests/:id/extend', asyncRoute(async (req, res) => {
    const viewer = await requireContestOwner(req);
    const minutes = Math.max(1, Number(req.body?.minutes || 0));
    const contest = await extendContestV2(req.params.id, minutes, viewer.userId);
    res.json(sanitizeContestForViewer(contest!, viewer));
  }));

  router.post('/contests/:id/finalize', asyncRoute(async (req, res) => {
    const viewer = await requireContestOwner(req);
    const before = await prisma.contest.findUnique({ where: { id: req.params.id } });
    await prisma.contest.update({ where: { id: req.params.id }, data: { status: ContestStatus.ENDED } });
    await recomputeContestStandings(req.params.id);
    const rewards = before?.status === ContestStatus.ENDED ? null : await processContestRewards(req.params.id);
    const contest = await loadContestForViewer(req.params.id);
    io.to(`contest:${req.params.id}`).emit('standings:update', { contestId: req.params.id });
    res.json({ success: true, message: 'Contest finalized.', rewards, contest: sanitizeContestForViewer(contest!, viewer) });
  }));

  router.get('/contests/:id/submissions', asyncRoute(async (req, res) => {
    const viewer = await resolvedViewerFromRequest(req);
    const submissions = await getContestSubmissionsV2(req.params.id, viewer.userId, viewer.email);
    res.json(submissions);
  }));

  router.post('/contests/:id/sync/codeforces', asyncRoute(async (req, res) => {
    const viewer = await resolvedViewerFromRequest(req);
    const contest = await loadContestForViewer(req.params.id);
    if (!contest) throw new Error('Contest not found');
    const sanitized = sanitizeContestForViewer(contest, viewer);
    if (!sanitized?.canManage && !sanitized?.viewerMember) throw new Error('Only registered contest players can sync submissions.');
    const result = await syncCodeforcesContest(req.params.id);
    io.to(`contest:${req.params.id}`).emit('standings:update', { contestId: req.params.id, standings: result.standings });
    res.json(result);
  }));

  router.post('/contests/:id/submissions/:submissionId/override', asyncRoute(async (req, res) => {
    const viewer = await requireContestOwner(req);
    const contest = await overrideSubmissionPoints(req.params.id, req.params.submissionId, Number(req.body.manualPoints), viewer.userId!);
    io.to(`contest:${req.params.id}`).emit('standings:update', { contestId: req.params.id });
    res.json(sanitizeContestForViewer(contest!, viewer));
  }));

  router.get('/contests/:id', asyncRoute(async (req, res) => {
    const contest = await loadContestForViewer(req.params.id);
    if (!contest) throw new Error('Contest not found');
    res.json(sanitizeContestForViewer(contest, viewerFromRequest(req)));
  }));

  router.post('/contests/:id/problems/mashup', asyncRoute(async (req, res) => {
    const viewer = await requireContestOwner(req);
    const { type, url, customData, mcqData, generateAiTests } = req.body;
    const contestId = req.params.id;

    const existingCount = await prisma.contestProblem.count({ where: { contestId } });
    const nextLabel = String.fromCharCode(65 + existingCount);

    if (type === 'URL' && url) {
      let scrapedTitle = 'External Problem Resource';
      let scrapedHtml = `<div style="text-align:center;"><a href="${url}">View Problem Here</a></div>`;
      let platform = 'OTHER';
      let scrapedTestcases: any[] = [];

      try {
        const data = await scrapeProblemFromUrl(url);
        if (data && data.title) {
          scrapedTitle = data.title;
          scrapedHtml = data.descriptionHtml;
          platform = data.platform || 'OTHER';
          scrapedTestcases = data.testcases || [];
        }
      } catch (err) {}

      if (generateAiTests && scrapedHtml.length > 50) {
          const aiCases = await generateToughTestCases(scrapedHtml);
          if (aiCases && aiCases.length > 0) {
             const formattedAiCases = aiCases.map((c: any) => ({ ...c, isPublic: false }));
             scrapedTestcases = [...scrapedTestcases, ...formattedAiCases];
          }
      }

      const problem = await prisma.problem.create({
        data: {
          title: scrapedTitle, description: scrapedHtml, platform: platform as any, source: 'EXTERNAL', url, problemCode: `SCRAPED-${Date.now()}`, visibility: 'PUBLIC',
          testcases: {
             create: scrapedTestcases.map((c: any, i: number) => ({
                input: c.input,
                expectedOutput: c.expectedOutput,
                order: i,
                isPublic: c.isPublic !== false,
                type: c.isPublic === false ? 'HIDDEN' : 'SAMPLE'
             }))
          }
        }
      });

      const updatedProblem = await prisma.contestProblem.create({
        data: { contestId, problemId: problem.id, points: 100, titleSnapshot: problem.title, index: existingCount, label: nextLabel, platform: platform as any, externalUrl: url, requiresRedirect: true }
      });
      const contest = await loadContestForViewer(contestId);
      return res.json(sanitizeContestForViewer(contest!, viewer));
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
          isMCQ: true,
          mcqTimeLimitSeconds: Number(mcqData.timeLimit || req.body.mcqTimeLimitSeconds || 0)
        } as any 
      });
      const contest = await loadContestForViewer(contestId);
      return res.json(sanitizeContestForViewer(contest!, viewer));
    }

    if (type === 'CUSTOM' && customData) {
      let customCases = customData.testcases || [];
      
      if (customData.generateAiTests && customData.description.length > 20) {
         const aiCases = await generateToughTestCases(customData.description);
         if (aiCases && aiCases.length > 0) {
            const formattedAiCases = aiCases.map((c: any) => ({ ...c, isPublic: false }));
            customCases = [...customCases, ...formattedAiCases];
         }
      }

      const problem = await prisma.problem.create({
        data: {
          title: customData.title, description: customData.description, platform: 'DIVINECODE', source: 'INTERNAL', problemCode: `CUSTOM-${Date.now()}`, visibility: 'PUBLIC',
          testcases: { 
            create: customCases.map((c: any, i: number) => ({ 
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
          customDescription: customData.description,
          index: existingCount, 
          label: nextLabel, 
          platform: 'DIVINECODE',
          isMCQ: false,
          mcqTimeLimitSeconds: Number(customData.time || 0)
        } as any
      });
      const contest = await loadContestForViewer(contestId);
      return res.json(sanitizeContestForViewer(contest!, viewer));
    }

    res.status(400).json({ error: 'Bad type parsing' });
  }));

  router.put('/contests/:id/problems/:problemId/reorder', asyncRoute(async (req, res) => {
    const viewer = await requireContestOwner(req);
    const { direction } = req.body;
    const contest = await reorderContestProblemV2(req.params.id, req.params.problemId, direction, viewer.userId);
    res.json(sanitizeContestForViewer(contest!, viewer));
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
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const search = String(req.query.search || '').trim();

    const whereClause: any = search ? {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { tags: { has: search } }
      ]
    } : {};

    const problems = await prisma.aiProblemDataset.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    });
    
    const totalFilteredCount = await prisma.aiProblemDataset.count({ where: whereClause });
    const totalCount = await prisma.aiProblemDataset.count(); 
    
    res.json({ 
      success: true, 
      count: totalFilteredCount,
      totalCount: totalCount, 
      message: `${totalFilteredCount} matching DSA and System Design questions loaded.`, 
      problems,
      totalPages: Math.ceil(totalFilteredCount / limit),
      currentPage: page
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

  router.get('/problems/:id/redirect', asyncRoute(async (req, res) => {
    const problem = await prisma.contestProblem.findUnique({
      where: { id: req.params.id },
      include: { problem: true, interviewQuestion: true }
    });

    if (!problem) {
      return res.status(404).json({ error: 'Problem not found' });
    }

    const response: any = {
      id: problem.id,
      title: problem.titleSnapshot,
      type: problem.isMCQ ? 'MCQ' : problem.externalUrl ? 'EXTERNAL' : 'INTERNAL',
      isMCQ: problem.isMCQ,
      platform: problem.platform,
      externalUrl: problem.externalUrl || null,
      customDescription: problem.customDescription || null,
      customTestCases: problem.customTestCases || null
    };

    if (problem.isMCQ && problem.interviewQuestion) {
      response.interviewQuestion = {
        id: problem.interviewQuestion.id,
        prompt: problem.interviewQuestion.prompt,
        options: problem.interviewQuestion.options || [],
        correctIndices: problem.interviewQuestion.correctIndices || [],
        isMultiple: problem.interviewQuestion.isMultiple,
        mcqTimeLimitSeconds: problem.mcqTimeLimitSeconds
      };
    }

    if (problem.externalUrl && !problem.isMCQ) {
      response.redirectUrl = problem.externalUrl;
      response.requiresRedirect = true;
      try {
        const { status } = await axios.head(problem.externalUrl, { timeout: 5000 });
        response.isAccessible = status >= 200 && status < 400;
      } catch (err) {
        response.isAccessible = false;
        response.error = 'External problem URL is not accessible. Will redirect anyway.';
      }
    }

    res.json(response);
  }));

  router.post('/contests/:id/ai-recommendations', asyncRoute(async (req, res) => {
    const problems = await prisma.aiProblemDataset.findMany({
      take: 3,
      orderBy: { createdAt: 'desc' }
    });
    
    const enriched = problems.map(p => ({
      ...p,
      requiresRedirect: p.platform !== 'DIVINECODE' && !!p.originalUrl,
      externalUrl: p.originalUrl,
      link: p.originalUrl || '#'
    }));
    
    res.json({ success: true, recommendations: enriched });
  }));
  
  router.post('/contests/:id/recommend-problems', asyncRoute(async (req, res) => {
    const problems = await prisma.aiProblemDataset.findMany({
      take: 2,
      orderBy: { createdAt: 'desc' }
    });
    
    const enriched = problems.map(p => ({
      ...p,
      requiresRedirect: p.platform !== 'DIVINECODE' && !!p.originalUrl,
      externalUrl: p.originalUrl,
      link: p.originalUrl || '#'
    }));
    
    res.json({ success: true, recommendations: enriched });
  }));

  router.post('/contests/:id/problems/:problemId/ai-debug', asyncRoute(async (req, res) => {
    const { userCode, problemDescription } = req.body;
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
  
  app.use('/api/v2', router);
  app.use('/api/v2/submissions', submissionRouter); 
  app.use('/api/v2/interview', interviewRouter);
  app.use('/api/v2/profile', profileRouter);
}