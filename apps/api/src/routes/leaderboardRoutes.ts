import { Router } from 'express';
import { prisma } from '../prisma/client';

export const leaderboardRouter = Router();

leaderboardRouter.get('/', async (req, res) => {
  try {
    // Fetch the top 100 users sorted by their Elo Rating
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        name: true,
        rating: true,
        coins: true,
        _count: {
          select: {
            // Only count ACCEPTED submissions
            submissions: { where: { verdict: 'ACCEPTED' } },
            contestParticipants: true
          }
        }
      },
      orderBy: { rating: 'desc' },
      take: 100
    });

    return res.json(users);
  } catch (err: any) {
    console.error('[Leaderboard API Error]', err);
    return res.status(500).json({ error: 'Failed to fetch leaderboard.' });
  }
});