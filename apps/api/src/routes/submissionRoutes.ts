import { Router } from 'express';
import { prisma } from '../prisma/client';
import { executeSubmission } from '../modules/judge/judge0Service';
import { recomputeContestStandings } from '../modules/standings/standingService';

export const submissionRouter = Router();

// Endpoint for LeetCode style "Run Code" (Runs against only sample test cases)
submissionRouter.post('/run-samples', async (req, res) => {
  const { problemId, code, language } = req.body;

  try {
    const samples = await prisma.testcase.findMany({
      where: { problemId, isPublic: true }
    });

    if (samples.length === 0) {
      return res.status(400).json({ error: 'No sample test cases configured for this problem.' });
    }

    const evaluations = [];
    for (const test of samples) {
      const result = await executeSubmission(code, language, test.input, test.expectedOutput);
      evaluations.push({ testCaseId: test.id, ...result });
    }

    return res.json({ results: evaluations });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Endpoint to Report a Submission (Peer Review)
submissionRouter.post('/:id/report', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const email = req.headers['x-user-email'] as string;

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

    return res.json({ success: true, report });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Endpoint for Owner to Manually Override Points
submissionRouter.post('/:id/override', async (req, res) => {
  try {
    const { id } = req.params;
    const { manualPoints } = req.body;
    
    // Update the submission with manual points
    const submission = await prisma.submission.update({
      where: { id },
      data: { manualPoints: manualPoints !== null ? Number(manualPoints) : null }
    });

    // Recompute standings so the overridden points immediately reflect on the leaderboard
    if (submission.contestId) {
      await recomputeContestStandings(submission.contestId);
    }

    return res.json({ success: true, submission });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});