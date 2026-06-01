import { Router } from 'express';
import { prisma } from '../prisma/client';
import { Platform } from '@prisma/client';

export const profileRouter = Router();

// Get current user profile
profileRouter.get('/me', async (req, res) => {
  try {
    const email = req.headers['x-user-email'] as string;
    if (!email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({
      where: { email },
      include: { externalHandles: true }
    });
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(user);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Claim DivineCode Username
profileRouter.post('/claim-username', async (req, res) => {
  try {
    const email = req.headers['x-user-email'] as string;
    const { username } = req.body;
    if (!email) return res.status(401).json({ error: 'Unauthorized' });

    // Check if username is taken
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing && existing.email !== email) {
      return res.status(400).json({ error: 'Username is already taken!' });
    }

    const user = await prisma.user.update({
      where: { email },
      data: { username }
    });

    return res.json({ success: true, user });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Save External Handles (Codeforces, LeetCode)
profileRouter.post('/save-handles', async (req, res) => {
  try {
    const email = req.headers['x-user-email'] as string;
    const { codeforcesHandle, leetcodeHandle } = req.body;
    if (!email) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Upsert Codeforces
    if (codeforcesHandle) {
      await prisma.externalHandle.upsert({
        where: { userId_platform: { userId: user.id, platform: Platform.CODEFORCES } },
        create: { userId: user.id, platform: Platform.CODEFORCES, handle: codeforcesHandle },
        update: { handle: codeforcesHandle }
      });
    }

    // Upsert LeetCode
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