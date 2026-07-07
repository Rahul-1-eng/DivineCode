/**
 * @file feedbackRoutes.ts
 * @author Rahul
 * @description Post-experience feedback collection — AI interviews, live
 * recruiter calls, and contests. One rating per user per experience; admins
 * can read the aggregate stream.
 */

import { Router } from 'express';
import { prisma } from '../prisma/client';
import { resolvedViewerFromRequest } from '../modules/contests/contestRules';

export const feedbackRouter = Router();

const VALID_KINDS = ['AI_INTERVIEW', 'HUMAN_INTERVIEW', 'CONTEST', 'PLATFORM'] as const;

// Submit (or update) feedback for an experience.
feedbackRouter.post('/', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { kind, refId, rating, comments } = req.body || {};
    if (!VALID_KINDS.includes(kind)) return res.status(400).json({ error: 'Invalid feedback kind.' });
    const stars = Number(rating);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'Rating must be an integer from 1 to 5.' });
    }

    const feedback = await prisma.feedback.upsert({
      where: { userId_kind_refId: { userId: user.id, kind, refId: refId || '' } },
      update: { rating: stars, comments: String(comments || '').slice(0, 2000) || null },
      create: {
        userId: user.id,
        kind,
        refId: refId || '',
        rating: stars,
        comments: String(comments || '').slice(0, 2000) || null
      }
    });

    res.json({ success: true, feedback });
  } catch (err: any) {
    console.error('[Feedback Submit Error]', err);
    res.status(500).json({ error: 'Failed to save feedback.' });
  }
});

// Has the viewer already left feedback for this experience? (UI uses this to
// decide whether to show the form.)
feedbackRouter.get('/mine', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });
    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const kind = String(req.query.kind || '');
    const refId = String(req.query.refId || '');
    if (!VALID_KINDS.includes(kind as any)) return res.status(400).json({ error: 'Invalid feedback kind.' });

    const existing = await prisma.feedback.findUnique({
      where: { userId_kind_refId: { userId: user.id, kind: kind as any, refId } }
    });
    res.json({ success: true, submitted: !!existing, feedback: existing });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to check feedback.' });
  }
});

// Admin: aggregate view of everything users have said.
feedbackRouter.get('/all', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });
    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin access required.' });

    const feedbacks = await prisma.feedback.findMany({
      take: 200,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { username: true, email: true } } }
    });

    // Star averages per kind so the admin sees the health at a glance
    const grouped = await prisma.feedback.groupBy({
      by: ['kind'],
      _avg: { rating: true },
      _count: { _all: true }
    });

    res.json({ success: true, feedbacks, summary: grouped });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load feedback.' });
  }
});
