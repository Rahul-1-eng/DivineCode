import { Router } from 'express';
import { prisma } from '../prisma/client';

export const searchRouter = Router();

searchRouter.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) {
      return res.json({ users: [], contests: [], problems: [] });
    }

    // Run all 3 queries concurrently for maximum speed
    const [users, contests, problemsRaw] = await Promise.all([
      prisma.user.findMany({
        where: {
          OR: [
            { username: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } }
          ]
        },
        select: { id: true, username: true, name: true, rating: true, avatarUrl: true },
        take: 5
      }),
      prisma.contest.findMany({
        where: { title: { contains: q, mode: 'insensitive' } },
        select: { id: true, title: true, status: true, startTime: true },
        take: 5
      }),
      prisma.problem.findMany({
        where: { title: { contains: q, mode: 'insensitive' } },
        // 👉 THE ULTIMATE FIX: Only select id and title. These are 100% guaranteed to exist.
        select: { id: true, title: true },
        take: 5
      })
    ]);

    const problems = problemsRaw.map((p: any) => ({
      ...p,
      // Safely provide a fallback so the frontend Command Palette doesn't break
      difficultyLabel: 'Practice' 
    }));

    return res.json({ users, contests, problems });
  } catch (err: any) {
    console.error('[Search API Error]', err);
    return res.status(500).json({ error: 'Search failed' });
  }
});