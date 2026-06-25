import { Router } from 'express';
import { prisma } from '../prisma/client';
import { executeSubmission } from '../modules/judge/judge0Service';
import { getContestSubmissions } from '../modules/contests/submissionService';
import { resolvedViewerFromRequest } from '../modules/contests/contestRules';

export const submissionRouter = Router();

// Endpoint to fetch submissions securely based on privacy rules
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

// ✅ FIXED: Endpoint for LeetCode style "Run Code" (Runs against only sample test cases)
submissionRouter.post('/run-samples', async (req, res) => {
  const { problemId, code, language } = req.body;

  if (!problemId || !code || !language) {
    return res.status(400).json({ error: 'problemId, code, and language are required' });
  }

  try {
    console.log(`[Submissions] Running samples for problem: ${problemId}`);

    // 1. First, try fetching from the relational Testcase table (for contest problems)
    let samples = await prisma.testcase.findMany({
      where: { 
        problemId,
        isPublic: true,
        type: 'SAMPLE'
      },
      orderBy: { order: 'asc' }
    });

    console.log(`[Submissions] Found ${samples.length} sample testcases in Testcase table`);

    // 2. Fallback for AI Avatar / Practice Dataset problems
    if (samples.length === 0) {
      console.log(`[Submissions] Trying AI dataset fallback for problem: ${problemId}`);
      
      const aiProblem = await prisma.aiProblemDataset.findUnique({
        where: { id: problemId }
      });

      if (aiProblem && aiProblem.testcases) {
        try {
          const parsedCases = typeof aiProblem.testcases === 'string'
            ? JSON.parse(aiProblem.testcases)
            : (aiProblem.testcases as any);

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
            
            console.log(`[Submissions] Loaded ${samples.length} testcases from AI dataset`);
          }
        } catch (jsonErr) {
          console.error('[Submissions] JSON Parse Error for AI dataset testcases:', jsonErr);
        }
      }
    }

    if (samples.length === 0) {
      console.warn(`[Submissions] No sample test cases found for problem: ${problemId}`);
      return res.status(404).json({ error: 'No sample test cases configured for this problem.' });
    }

    // Execute code against all samples
    console.log(`[Submissions] Executing code against ${samples.length} test cases...`);
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
        console.error(`[Submissions] Execution error for test case ${test.id}:`, execErr);
        evaluations.push({
          testCaseId: test.id,
          testCaseNumber: samples.indexOf(test) + 1,
          verdict: 'RUNTIME_ERROR',
          compileError: execErr.message
        });
      }
    }

    console.log(`[Submissions] Execution complete. Results:`, evaluations);
    return res.json({ success: true, results: evaluations });
    
  } catch (err: any) {
    console.error('[Submissions] run-samples error:', err);
    return res.status(500).json({ error: err.message || 'Failed to execute code' });
  }
});

// ✅ NEW: Terminal Mode - Execute code with custom STDIN (no test cases needed)
// ✅ NEW: Terminal Mode - Execute code with custom STDIN
submissionRouter.post('/execute-raw', async (req, res) => {
  const { code, language, stdin } = req.body;

  if (!code || !language) {
    return res.status(400).json({ error: 'code and language are required' });
  }

  try {
    console.log(`[Submissions] Executing raw code in terminal mode`);
    console.log(`[Submissions] Language: ${language}, Input length: ${(stdin || '').length}`);

    const result = await executeSubmission(code, language, stdin || '', '');
    
    console.log(`[Submissions] Raw execution result: ${result.verdict}`);
    
    // 👉 FIXED: Added (result as any) to stop TypeScript build errors
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
    console.error('[Submissions] execute-raw error:', err);
    return res.status(500).json({ error: err.message || 'Failed to execute code' });
  }
});

// Endpoint to Report a Submission (Peer Review)
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
      data: {
        submissionId: id,
        reporterId: user.id,
        reason
      }
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