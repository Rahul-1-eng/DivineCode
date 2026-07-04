/**
 * @file leaderboardRoutes.ts
 * @author Rahul Kumar Sahoo
 * @description Route handlers for the platform API.
 */

import { Router } from 'express';
import { prisma } from '../prisma/client';

export const leaderboardRouter = Router();

// Global Hall of Fame Endpoint (Used by the Homepage)
leaderboardRouter.get('/global', async (req, res) => {
  try {
    const topUsers = await prisma.user.findMany({
      orderBy: { rating: 'desc' },
      take: 10, // Fetch top 10 users for the homepage
      select: {
        id: true,
        name: true,
        username: true,
        rating: true,
        coins: true,
        avatarUrl: true
      }
    });
    
    return res.json(topUsers);
  } catch (err: any) {
    console.error("[Leaderboard API Error /global]:", err);
    return res.status(500).json({ error: "Failed to load global leaderboard." });
  }
});

// Original endpoint (Used for the main Leaderboard page)
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
    console.error('[Leaderboard API Error /]', err);
    return res.status(500).json({ error: 'Failed to fetch leaderboard.' });
  }
});

export default leaderboardRouter;