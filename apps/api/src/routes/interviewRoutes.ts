import { Router } from 'express';
import { prisma } from '../prisma/client';
import { resolvedViewerFromRequest } from '../modules/contests/contestRules';
import { conductAiInterview } from '../modules/ai/aiService';

export const interviewRouter = Router();

// GET all tracks
interviewRouter.get('/tracks', async (req, res) => {
  try {
    const tracks = await prisma.interviewTrack.findMany({
      orderBy: { order: 'asc' }
    });
    res.json(tracks); 
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch tracks' });
  }
});

// GET user progress
interviewRouter.get('/progress', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    const email = viewer.email;
    if (!email) return res.json([]); 
    
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json([]);

    const progress = await prisma.interviewProgress.findMany({
      where: { userId: user.id }
    });
    res.json(progress);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// POST update progress (Mark as REVIEWING, MASTERED, etc)
interviewRouter.post('/progress/:questionId', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    const email = viewer.email;
    if (!email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { status } = req.body; 

    const progress = await prisma.interviewProgress.upsert({
      where: {
        userId_questionId: { userId: user.id, questionId: req.params.questionId }
      },
      update: { status, lastReviewedAt: new Date() },
      create: {
        userId: user.id,
        questionId: req.params.questionId,
        status,
        lastReviewedAt: new Date()
      }
    });

    res.json({ success: true, progress });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update progress' });
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

    const mappedQuestions = questions.map(q => ({
      ...q,
      correctIndex: q.correctIndices && q.correctIndices.length > 0 ? q.correctIndices[0] : 0
    }));

    res.json(mappedQuestions); 
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch questions' });
  }
});

// ADMIN ROUTE: GET all pending questions
interviewRouter.get('/pending', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    const email = viewer.email;
    const user = await prisma.user.findUnique({ where: { email } });
    
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden. Admin access required.' });
    }

    const pendingQuestions = await prisma.interviewQuestion.findMany({
      where: { isApproved: false },
      include: { track: true },
      orderBy: { createdAt: 'asc' }
    });
    
    const mappedPending = pendingQuestions.map(q => ({
      ...q,
      correctIndex: q.correctIndices && q.correctIndices.length > 0 ? q.correctIndices[0] : 0
    }));

    res.json({ success: true, questions: mappedPending });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch pending questions' });
  }
});

// ADMIN ROUTE: Approve a pending question
interviewRouter.patch('/questions/:id/approve', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    const email = viewer.email;
    if (!email) return res.status(401).json({ error: 'Unauthorized' });

    const requester = await prisma.user.findUnique({ where: { email } });
    if (!requester || requester.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only the platform owner can approve questions.' });
    }

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
interviewRouter.post('/questions', async (req, res) => {
  try {
    const { trackId, title, prompt, options, correctIndices, difficulty, tags, sourceCompany, expectedAnswer } = req.body;

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

// NEW: AI Mock Interview Engine Endpoint (With Live Code Support)
interviewRouter.post('/questions/:id/mock', async (req, res) => {
  try {
    // 👉 ADDED: Destructuring `code` from the request body
    const { userResponse, history, code } = req.body;
    const question = await prisma.interviewQuestion.findUnique({
      where: { id: req.params.id }
    });

    if (!question) return res.status(404).json({ error: 'Question not found' });

    // 👉 ADDED: Passing the live code into the AI Engine
    const aiEvaluation = await conductAiInterview(question.prompt, userResponse, history || [], code);
    
    // Auto-update to MASTERED if the AI grades them successfully
    if (aiEvaluation.isPassed) {
       const viewer = await resolvedViewerFromRequest(req, true);
       if (viewer.email) {
         const user = await prisma.user.findUnique({ where: { email: viewer.email } });
         if (user) {
            await prisma.interviewProgress.upsert({
              where: { userId_questionId: { userId: user.id, questionId: question.id } },
              update: { status: 'MASTERED', lastReviewedAt: new Date() },
              create: { userId: user.id, questionId: question.id, status: 'MASTERED', lastReviewedAt: new Date() }
            });
         }
       }
    }

    res.json({ success: true, evaluation: aiEvaluation });
  } catch (err: any) {
    res.status(500).json({ error: 'AI Interview Service Failed' });
  }
});