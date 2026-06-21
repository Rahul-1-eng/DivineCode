import { Router } from 'express';
import { prisma } from '../prisma/client';
import { Platform } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { resolvedViewerFromRequest } from '../modules/contests/contestRules';
export const profileRouter = Router();

profileRouter.get('/me', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
const email = viewer.email;
    if (!email) return res.status(401).json({ error: 'Unauthorized' });

    let user = await prisma.user.findUnique({
      where: { email },
      include: { 
        externalHandles: true,
        ratingHistory: { orderBy: { createdAt: 'asc' }, include: { contest: { select: { title: true } } } },
        submissions: { select: { verdict: true } },
        contestParticipants: {
          where: { standing: { isNot: null } },
          include: { contest: { select: { id: true, title: true, startTime: true, isRated: true } }, standing: true },
          orderBy: { joinedAt: 'desc' }
        }
      }
    });
    
    if (!user) return res.status(404).json({ error: 'User not found' });

    const totalAttempts = user.submissions.length;
    const totalAccepted = user.submissions.filter(s => s.verdict === 'ACCEPTED' || String(s.verdict) === 'OK').length;
    const accuracy = totalAttempts > 0 ? Math.round((totalAccepted / totalAttempts) * 100) : 0;

    const matchHistory = user.contestParticipants.map(p => {
      const rBefore = p.ratingBefore ?? user.rating;
      const rAfter = p.ratingAfter ?? user.rating;
      return {
        contestId: p.contest.id, contestName: p.contest.title, date: p.contest.startTime,
        isRated: p.contest.isRated, rank: p.standing?.rank || '-', score: p.standing?.score || 0,
        solved: p.standing?.solved || 0, ratingDelta: rAfter - rBefore, ratingAfter: rAfter
      };
    });

    return res.json({ ...user, stats: { totalAttempts, totalAccepted, accuracy }, matchHistory });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 👉 THE FIX: Absolute Bulletproof UPSERT logic. It will never fail to find the user.
profileRouter.post('/claim-username', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
const email = viewer.email;
    const name = req.headers['x-user-name'] as string;
    const { username } = req.body;
    
    if (!email) return res.status(401).json({ error: 'Unauthorized: No email provided.' });
    if (!username || username.trim().length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
    }

    const targetUsername = username.trim();

    // 1. Force find or create the user instantly. 
    let currentUser = await prisma.user.findUnique({ where: { email } });
    
    if (!currentUser) {
      currentUser = await prisma.user.create({
        data: {
          email,
          username: `user_${Date.now()}`,
          name: name || email.split('@')[0],
        }
      });
    }

    // 2. Check if the target username is taken by SOMEONE ELSE
    const existingUser = await prisma.user.findUnique({ where: { username: targetUsername } });
    if (existingUser && existingUser.id !== currentUser.id) {
      return res.status(400).json({ error: `The username "${targetUsername}" is already taken.` });
    }

    // 3. Update the username
    const updatedUser = await prisma.user.update({
      where: { id: currentUser.id },
      data: { username: targetUsername }
    });

    return res.json({ success: true, username: updatedUser.username });
  } catch (err: any) {
    console.error('[Profile] Claim Username Error:', err);
    return res.status(500).json({ error: `Database Error: ${err.message}` });
  }
});

// 👉 THE FIX: Secure Password Update Route
profileRouter.post('/update-password', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
const email = viewer.email;
    const { currentPassword, newPassword } = req.body;
    
    if (!email) return res.status(401).json({ error: 'Unauthorized' });
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // VERIFICATION: Check if user has an existing password, verify it first
    if (user.passwordHash) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password is required to change it.' });
      const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isValid) return res.status(400).json({ error: 'Incorrect current password.' });
    }

    // CONSISTENCY: Using bcryptjs to hash, ensuring it matches your auth/register logic
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashedPassword }
    });

    return res.json({ success: true, message: 'Password updated successfully!' });
  } catch (err: any) {
    console.error('[Profile] Update Password Error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

profileRouter.post('/save-handles', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
const email = viewer.email;
    const { codeforcesHandle, leetcodeHandle } = req.body;
    if (!email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (codeforcesHandle) {
      const existing = await prisma.externalHandle.findFirst({
        where: { platform: Platform.CODEFORCES, handle: { equals: codeforcesHandle, mode: 'insensitive' } }
      });
      if (existing && existing.userId !== user.id) return res.status(400).json({ error: `Codeforces handle linked to another user.` });

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

profileRouter.delete('/handles/:platform/:handle', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
const email = viewer.email;
    const { platform, handle } = req.params;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    await prisma.externalHandle.deleteMany({
      where: { userId: user.id, platform: platform as Platform, handle }
    });
    return res.json({ success: true });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});