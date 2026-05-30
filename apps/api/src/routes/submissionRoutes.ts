import { Router } from 'express';
import { prisma } from '../prisma/client';
import { executeSubmission } from '../modules/judge/judge0Service';

export const submissionRouter = Router();

// Endpoint for LeetCode style "Run Code" (Runs against only sample test cases)
submissionRouter.post('/run-samples', async (req, res) => {
  const { problemId, code, language } = req.body;

  try {
    const samples = await prisma.testcase.findMany({
      where: { problemId, isSample: true }
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