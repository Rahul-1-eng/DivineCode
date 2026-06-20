import { Router } from 'express';
import { prisma } from '../prisma/client';

export const interviewRouter = Router();

// GET all tracks
interviewRouter.get('/tracks', async (req, res) => {
  try {
    const tracks = await prisma.interviewTrack.findMany({
      orderBy: { order: 'asc' }
    });
    // FIXED: Frontend expects a raw array, not an object
    res.json(tracks); 
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch tracks' });
  }
});

// GET all approved questions
interviewRouter.get('/questions', async (req, res) => {
  try {
    const questions = await prisma.interviewQuestion.findMany({
      where: { isApproved: true },
      include: { track: true },
      orderBy: { createdAt: 'desc' }
    });

    // FIXED: Map correctIndices to correctIndex for frontend compatibility
    const mappedQuestions = questions.map(q => ({
      ...q,
      correctIndex: q.correctIndices && q.correctIndices.length > 0 ? q.correctIndices[0] : 0
    }));

    // FIXED: Frontend expects a raw array, not an object
    res.json(mappedQuestions); 
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch questions' });
  }
});

// ADMIN ROUTE: GET all pending questions
interviewRouter.get('/pending', async (req, res) => {
  try {
    const pendingQuestions = await prisma.interviewQuestion.findMany({
      where: { isApproved: false },
      include: { track: true },
      orderBy: { createdAt: 'asc' }
    });
    res.json({ success: true, questions: pendingQuestions });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch pending questions' });
  }
});

// ADMIN ROUTE: Approve a pending question
interviewRouter.patch('/questions/:id/approve', async (req, res) => {
  try {
    const updatedQuestion = await prisma.interviewQuestion.update({
      where: { id: req.params.id },
      data: { isApproved: true }
    });
    res.json({ success: true, message: 'Question approved successfully', question: updatedQuestion });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to approve question' });
  }
});

// GET a specific question by ID
interviewRouter.get('/questions/:id', async (req, res) => {
  try {
    const question = await prisma.interviewQuestion.findUnique({
      where: { id: req.params.id },
      include: { track: true }
    });
    if (!question) return res.status(404).json({ error: 'Question not found' });
    res.json({ success: true, question });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch question' });
  }
});

// POST endpoint for users to contribute questions
// POST endpoint for users to contribute questions
interviewRouter.post('/questions', async (req, res) => {
  try {
    // 👉 FIX: Added expectedAnswer to the destructured body
    const { trackId, title, prompt, options, correctIndices, difficulty, tags, sourceCompany, expectedAnswer } = req.body;

    // Basic validation
    if (!trackId || !title || !prompt || !options || !correctIndices) {
      return res.status(400).json({ error: 'Missing required fields (trackId, title, prompt, options, correctIndices).' });
    }

    if (!Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'At least two options are required.' });
    }

    if (!Array.isArray(correctIndices) || correctIndices.length === 0) {
      return res.status(400).json({ error: 'At least one correct index must be provided.' });
    }

    const trackExists = await prisma.interviewTrack.findUnique({ where: { id: trackId } });
    if (!trackExists) {
      return res.status(400).json({ error: 'Invalid track ID provided.' });
    }

    // Create the question in a pending state
    const newQuestion = await prisma.interviewQuestion.create({
      data: {
        trackId,
        title,
        prompt,
        options,
        correctIndices,
        isMultiple: correctIndices.length > 1,
        difficulty: difficulty || 'Medium',
        tags: tags || [],
        sourceCompany: sourceCompany || null,
        // 👉 FIX: Make sure the expectedAnswer is saved to the database
        expectedAnswer: expectedAnswer || null,
        isApproved: false 
      }
    });

    res.status(201).json({ 
      success: true, 
      message: 'Question submitted successfully for moderator review.',
      question: newQuestion 
    });

  } catch (err: any) {
    console.error("[Interview Submit Error]", err);
    res.status(500).json({ error: 'Failed to submit question.' });
  }
});