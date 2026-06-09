import { Router } from 'express';
import { prisma } from '../prisma/client';
import { interviewMcqs } from '../interviewMcqs';

export const interviewRouter = Router();

// 1. Fetch Tracks (Auto-seeds a default track if database is empty)
interviewRouter.get('/tracks', async (req, res) => {
  try {
    let tracks = await prisma.interviewTrack.findMany({
      orderBy: { order: 'asc' }
    });

    // Auto-seed fallback
    if (tracks.length === 0) {
      const defaultTrack = await prisma.interviewTrack.create({
        data: { slug: 'core-cs', title: 'Core Computer Science', type: 'DSA', order: 1 }
      });
      tracks = [defaultTrack];
    }

    return res.json(tracks);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 2. Fetch Approved Questions (Auto-seeds from your interviewMcqs.ts file if empty!)
interviewRouter.get('/questions', async (req, res) => {
  try {
    const { trackId } = req.query;
    
    let questions = await prisma.interviewQuestion.findMany({
      where: { 
        isApproved: true,
        ...(trackId && trackId !== 'All' ? { trackId: String(trackId) } : {})
      },
      include: { track: true }
    });

    // AUTO-SEED LOGIC: If DB is empty, pull from interviewMcqs.ts and save them!
    if (questions.length === 0 && (!trackId || trackId === 'All')) {
      let defaultTrack = await prisma.interviewTrack.findFirst();
      if (!defaultTrack) {
        defaultTrack = await prisma.interviewTrack.create({ 
          data: { slug: 'core-cs', title: 'Core Computer Science', type: 'DSA', order: 1 } 
        });
      }

      // Map the static file into the database schema
      const seedData = interviewMcqs.map(q => ({
        trackId: defaultTrack!.id,
        title: `${q.topic} Concept`,
        prompt: q.question,
        options: q.options,
        correctIndices: [q.correctIndex],
        isMultiple: false,
        difficulty: q.rating >= 1500 ? 'Hard' : q.rating >= 1200 ? 'Medium' : 'Easy',
        expectedAnswer: q.explanation,
        isApproved: true
      }));

      await prisma.interviewQuestion.createMany({ data: seedData });
      
      // Re-fetch now that they are seeded
      questions = await prisma.interviewQuestion.findMany({
        where: { isApproved: true },
        include: { track: true }
      });
    }

    // Map correctIndices to the old correctIndex format for backward compatibility with the frontend
    const mappedQuestions = questions.map(q => ({
      ...q,
      correctIndex: q.correctIndices && q.correctIndices.length > 0 ? q.correctIndices[0] : 0
    }));

    return res.json(mappedQuestions);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. User Submits a New Question (Goes to Pending)
interviewRouter.post('/submit-question', async (req, res) => {
  try {
    const email = req.headers['x-user-email'] as string;
    const { trackId, title, prompt, options, correctIndex, expectedAnswer } = req.body;

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
          correctIndices: [correctIndex],
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