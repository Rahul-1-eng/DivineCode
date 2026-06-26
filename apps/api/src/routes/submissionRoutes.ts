import { Router } from 'express';
import { prisma } from '../prisma/client';
import { executeSubmission } from '../modules/judge/judge0Service';
import { getContestSubmissions } from '../modules/contests/submissionService';
import { resolvedViewerFromRequest } from '../modules/contests/contestRules';

export const submissionRouter = Router();

submissionRouter.get('/contest/:contestId', async (req, res) => {
  try {
    const { contestId } = req.params;
    const viewer = await resolvedViewerFromRequest(req, true);
    const email = viewer.email;
    const userId = viewer.userId;

    const submissions = await getContestSubmissions({
      contestId,
      viewer: { userId, email }
    });

    return res.json(submissions);
  } catch (err: any) {
    return res.status(403).json({ error: err.message });
  }
});

submissionRouter.post('/run-samples', async (req, res) => {
  const { problemId, code, language } = req.body;

  if (!problemId || !code || !language) {
    return res.status(400).json({ error: 'problemId, code, and language are required' });
  }

  try {
    let samples = await prisma.testcase.findMany({
      where: { problemId, isPublic: true, type: 'SAMPLE' },
      orderBy: { order: 'asc' }
    });

    if (samples.length === 0) {
      const aiProblem = await prisma.aiProblemDataset.findUnique({ where: { id: problemId } });

      if (aiProblem && aiProblem.testcases) {
        try {
          const parsedCases = typeof aiProblem.testcases === 'string'
            ? JSON.parse(aiProblem.testcases) : (aiProblem.testcases as any);

          if (Array.isArray(parsedCases) && parsedCases.length > 0) {
            samples = parsedCases.map((tc: any, idx: number) => ({
              id: `ai-sample-${idx}`,
              problemId,
              input: tc.input || tc.stdin || '',
              expectedOutput: tc.expectedOutput || tc.output || '',
              order: idx + 1,
              type: 'SAMPLE',
              isPublic: true,
              createdAt: new Date(),
              updatedAt: new Date()
            })) as any;
          }
        } catch (jsonErr) {}
      }
    }

    if (samples.length === 0) {
      return res.status(404).json({ error: 'No sample test cases configured for this problem.' });
    }

    const evaluations = [];
    
    for (const test of samples) {
      try {
        const result = await executeSubmission(code, language, test.input, test.expectedOutput);
        evaluations.push({ 
          testCaseId: test.id,
          testCaseNumber: samples.indexOf(test) + 1,
          input: test.input.substring(0, 100),
          ...result 
        });
      } catch (execErr: any) {
        evaluations.push({
          testCaseId: test.id,
          testCaseNumber: samples.indexOf(test) + 1,
          verdict: 'RUNTIME_ERROR',
          compileError: execErr.message
        });
      }
    }

    return res.json({ success: true, results: evaluations });
    
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to execute code' });
  }
});

submissionRouter.post('/execute-raw', async (req, res) => {
  const { code, language, stdin } = req.body;

  if (!code || !language) {
    return res.status(400).json({ error: 'code and language are required' });
  }

  try {
    const result = await executeSubmission(code, language, stdin || '', '');
    
    return res.json({ 
      success: true, 
      verdict: result.verdict,
      stdout: (result as any).stdout || '',
      stderr: (result as any).stderr || '',
      compileError: (result as any).compileError || '',
      runtimeMs: (result as any).runtimeMs || 0,
      memoryMb: (result as any).memoryMb || 0
    });
    
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to execute code' });
  }
});

submissionRouter.post('/:id/report', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const viewer = await resolvedViewerFromRequest(req, true);
    const email = viewer.email;

    if (!email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const report = await prisma.submissionReport.create({
      data: { submissionId: id, reporterId: user.id, reason }
    });

    const submission = await prisma.submission.findUnique({ where: { id } });
    if (submission && submission.contestId) {
      const io = req.app.get('io');
      if (io) {
        io.to(`contest:${submission.contestId}`).emit('standings:update');
      }
    }

    return res.json({ success: true, report });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});