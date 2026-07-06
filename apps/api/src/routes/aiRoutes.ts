/**
 * @file aiRoutes.ts
 * @author Rahul Kumar Sahoo
 * @description Route handlers for AI-driven features including chat, test-case generation, and performance analysis.
 */
import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { prisma } from '../prisma/client';
import { generateTestCasesWithAI, debugCodeWithAI, generateToughTestCases, analyzeUserWeaknesses, PLATFORM_GUIDE } from '../modules/ai/aiService';
import { resolvedViewerFromRequest } from '../modules/contests/contestRules';

export const aiRouter = Router();

// Chat model chain mirrors the recruiter engine: configured model first, then
// known-good fallbacks. gemini-flash-latest regularly 503s under "high demand"
// spikes — without a fallback the chat dead-airs until the browser aborts.
const CHAT_MODEL_CHAIN = Array.from(new Set([
  (process.env.AI_MODEL || '').trim(),
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite'
].filter(Boolean)));

// Per-model cap; the frontend aborts at 55s, so 4 fallbacks × 12s stays inside it.
const CHAT_TIMEOUT_MS = 12000;

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;

function asyncRoute(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

aiRouter.post('/ai/chat', asyncRoute(async (req, res) => {
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

    // The guide makes the chat useful for "how does the platform work" questions
    // (coins, free interviews, UPI bookings), not just algorithm help.
    let lastErr: any = null;
    for (const modelName of CHAT_MODEL_CHAIN) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const { data } = await axios.post(url, {
          systemInstruction: { parts: [{ text: PLATFORM_GUIDE }] },
          contents
        }, { timeout: CHAT_TIMEOUT_MS });

        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text || !String(text).trim()) throw new Error('Empty candidate (possible safety block).');
        return res.json({ reply: String(text) });
      } catch (e: any) {
        lastErr = e;
        const status = e?.response?.status;
        console.warn(`[AI Chat] Model "${modelName}" failed (${status || e.code || e.message}) — trying next.`);
        // Auth/key problems affect every model in the chain — stop immediately.
        if (status === 400 || status === 401 || status === 403) break;
        // 404 (unknown model), 429 (quota), 5xx (overload), timeout → next model.
      }
    }
    throw lastErr || new Error('All chat models failed.');
  } catch (e: any) {
    console.error('[AI Chat] Error:', e.response?.data || e.message);
    res.json({ reply: "AI Service Error: Failed to generate a response. The model may be rate-limited or unavailable." });
  }
}));

aiRouter.post('/analyze-weaknesses', asyncRoute(async (req, res) => {
  const viewer = await resolvedViewerFromRequest(req, true);
  if (!viewer.userId) return res.status(401).json({ error: 'Unauthorized' });

  const subs = await prisma.submission.findMany({ 
    where: { userId: viewer.userId, verdict: { not: 'ACCEPTED' } },
    take: 5
  });

  const analysis = await analyzeUserWeaknesses(subs.map(s => ({ 
    problemTitle: s.contestProblemId || 'Unknown', 
    code: s.code, 
    verdict: s.verdict 
  })));

  res.json({ success: true, analysis });
}));

aiRouter.post('/ai/generate-testcases', asyncRoute(async (req, res) => {
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

aiRouter.get('/ai-dataset', asyncRoute(async (req, res) => {
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

aiRouter.post('/problems/:id/generate-ai-testcases', asyncRoute(async (req, res) => {
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

// Recommendations must actually relate to the contest. Scores the dataset
// against the contest problems' tags and title words instead of dumping the
// newest rows (which surfaced unrelated "false" questions), and drops entries
// with neither a real link nor a usable description (dead recommendations).
async function recommendProblemsForContest(contestId: string, count: number) {
  const contestProblems = await prisma.contestProblem.findMany({
    where: { contestId },
    include: { problem: true }
  });

  const tagPool = new Set<string>();
  const titleWords = new Set<string>();
  for (const cp of contestProblems) {
    (cp.problem?.tags || []).forEach(t => tagPool.add(String(t).toLowerCase()));
    String(cp.titleSnapshot || cp.problem?.title || '')
      .toLowerCase().split(/[^a-z]+/)
      .filter(w => w.length > 3)
      .forEach(w => titleWords.add(w));
  }

  const candidates = await prisma.aiProblemDataset.findMany({
    take: 300,
    orderBy: { createdAt: 'desc' }
  });

  const scored = candidates
    .filter(p => p.originalUrl || (p.descriptionHtml && p.descriptionHtml.replace(/<[^>]*>/g, '').trim().length > 40))
    .map(p => {
      const tagHits = (p.tags || []).filter(t => tagPool.has(String(t).toLowerCase())).length;
      const titleHits = String(p.title).toLowerCase().split(/[^a-z]+/).filter(w => titleWords.has(w)).length;
      return { p, score: tagHits * 3 + titleHits };
    })
    .sort((a, b) => b.score - a.score);

  // Only fall back to unrelated-but-valid problems when nothing matches at all.
  const pool = scored.some(s => s.score > 0) ? scored.filter(s => s.score > 0) : scored;
  return pool.slice(0, count).map(({ p }) => ({
    ...p,
    requiresRedirect: p.platform !== 'DIVINECODE' && !!p.originalUrl,
    externalUrl: p.originalUrl,
    link: p.originalUrl || '#'
  }));
}

aiRouter.post('/contests/:id/ai-recommendations', asyncRoute(async (req, res) => {
  const recommendations = await recommendProblemsForContest(req.params.id, 3);
  res.json({ success: true, recommendations });
}));

aiRouter.post('/contests/:id/recommend-problems', asyncRoute(async (req, res) => {
  const recommendations = await recommendProblemsForContest(req.params.id, 2);
  res.json({ success: true, recommendations });
}));

aiRouter.post('/contests/:id/problems/:problemId/ai-debug', asyncRoute(async (req, res) => {
  const { userCode, problemDescription } = req.body;
  const aiDebugData = await debugCodeWithAI(userCode, problemDescription);
  if (!aiDebugData || !aiDebugData.hint) {
      return res.status(500).json({ error: "AI failed to generate a debug response." });
  }
  res.json({ success: true, aiDebugData });
}));