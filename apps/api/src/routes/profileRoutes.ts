// apps/api/src/routes/profileRoutes.ts

import { Router } from 'express';
import { prisma } from '../prisma/client';
import { Platform } from '@prisma/client';

export const profileRouter = Router();

// Get current user profile (Aggregated with Stats & Match History)
profileRouter.get('/me', async (req, res) => {
  try {
    const email = req.headers['x-user-email'] as string;
    if (!email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({
      where: { email },
      include: { 
        externalHandles: true,
        // Fetch Elo trajectory (including synced Codeforces rating updates and internal contests)
        ratingHistory: { 
          orderBy: { createdAt: 'asc' },
          include: { contest: { select: { title: true } } }
        },
        // Fetch minimal submission data to calculate global accuracy
        submissions: { select: { verdict: true } },
        // Fetch detailed match history
        contestParticipants: {
          where: { standing: { isNot: null } },
          include: {
            contest: { select: { id: true, title: true, startTime: true, isRated: true } },
            standing: true
          },
          orderBy: { joinedAt: 'desc' }
        }
      }
    });
    
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Aggregate Global Accuracy & Stats
    const totalAttempts = user.submissions.length;
    const totalAccepted = user.submissions.filter(s => s.verdict === 'ACCEPTED' || String(s.verdict) === 'OK').length;
    const accuracy = totalAttempts > 0 ? Math.round((totalAccepted / totalAttempts) * 100) : 0;

    // Transform Participants into a clean Match History feed
    const matchHistory = user.contestParticipants.map(p => {
      const rBefore = p.ratingBefore ?? user.rating;
      const rAfter = p.ratingAfter ?? user.rating;
      
      return {
        contestId: p.contest.id,
        contestName: p.contest.title,
        date: p.contest.startTime,
        isRated: p.contest.isRated,
        rank: p.standing?.rank || '-',
        score: p.standing?.score || 0,
        solved: p.standing?.solved || 0,
        ratingDelta: rAfter - rBefore,
        ratingAfter: rAfter
      };
    });

    return res.json({
      ...user,
      stats: {
        totalAttempts,
        totalAccepted,
        accuracy
      },
      matchHistory
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

profileRouter.delete('/handles/:platform/:handle', async (req, res) => {
  // ... (Keep existing delete logic)
});

profileRouter.post('/claim-username', async (req, res) => {
  // ... (Keep existing claim logic)
});

profileRouter.post('/save-handles', async (req, res) => {
  try {
    const email = req.headers['x-user-email'] as string;
    const { codeforcesHandle, leetcodeHandle } = req.body;
    if (!email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (codeforcesHandle) {
      // Step 1: Ensure handle is not used by another DivineCode email
      const existing = await prisma.externalHandle.findFirst({
        where: { platform: Platform.CODEFORCES, handle: { equals: codeforcesHandle, mode: 'insensitive' } }
      });
      if (existing && existing.userId !== user.id) {
        return res.status(400).json({ error: `The Codeforces handle "${codeforcesHandle}" is already linked to another DivineCode account.` });
      }

      // Step 2: Validate against CF API (Ensures handle actually exists)
      const cfCheck = await fetch(`https://codeforces.com/api/user.info?handles=${codeforcesHandle}`);
      const cfData = await cfCheck.json();
      if (cfData.status !== "OK") {
        return res.status(400).json({ error: `Codeforces account "${codeforcesHandle}" does not exist.` });
      }

      // Save to database
      await prisma.externalHandle.upsert({
        where: { userId_platform: { userId: user.id, platform: Platform.CODEFORCES } },
        create: { userId: user.id, platform: Platform.CODEFORCES, handle: codeforcesHandle },
        update: { handle: codeforcesHandle }
      });
    }

    if (leetcodeHandle) {
      await prisma.externalHandle.upsert({
        where: { userId_platform: { userId: user.id, platform: Platform.LEETCODE } },
        create: { userId: user.id, platform: Platform.LEETCODE, handle: leetcodeHandle },
        update: { handle: leetcodeHandle }
      });
    }

    return res.json({ success: true, message: 'Handles linked successfully!' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});