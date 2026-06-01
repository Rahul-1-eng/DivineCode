import { Router } from 'express';
import { prisma } from '../prisma/client';

export const interviewRouter = Router();

// 1. Fetch Tracks
interviewRouter.get('/tracks', async (req, res) => {
  try {
    const tracks = await prisma.interviewTrack.findMany({
      orderBy: { order: 'asc' }
    });
    return res.json(tracks);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 2. Fetch Approved Questions (Optionally filtered by track)
interviewRouter.get('/questions', async (req, res) => {
  try {
    const { trackId } = req.query;
    const questions = await prisma.interviewQuestion.findMany({
      where: { 
        isApproved: true,
        ...(trackId ? { trackId: String(trackId) } : {})
      },
      include: { track: true }
    });
    return res.json(questions);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. User Submits a New Question (Goes to Pending)
interviewRouter.post('/submit-question', async (req, res) => {
  try {
    const email = req.headers['x-user-email'] as string;
    const { trackId, title, prompt, options, correctIndex, expectedAnswer } = req.body;

    // Optional: Auto-approve if it's the platform owner/admin submitting
    let isApproved = false;
    
    if (email) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user && (user.role === 'ADMIN' || user.role === 'PROBLEM_SETTER')) {
        isApproved = true;
      }

      const question = await prisma.interviewQuestion.create({
        data: {
          trackId,
          title,
          prompt,
          options,
          correctIndex,
          expectedAnswer,
          isApproved,
          submittedById: user?.id
        }
      });
      return res.json({ success: true, message: isApproved ? 'Question added directly!' : 'Question submitted for review!', question });
    }

    return res.status(401).json({ error: 'Unauthorized to submit questions.' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});