import { Router } from 'express';
import { prisma } from '../prisma/client';
import { Platform } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { resolvedViewerFromRequest } from '../modules/contests/contestRules';

export const profileRouter = Router();

profileRouter.get('/me', async (req, res) => {
  try {
    let viewer;
    try {
      viewer = await resolvedViewerFromRequest(req, true);
    } catch (authError) {
      console.error('❌ [AUTH] Viewer resolution failed:', authError);
      return res.status(401).json({ error: 'Authentication failed' });
    }
    const email = viewer?.email;
    
    console.log('📊 [PROFILE] GET /me request received');
    console.log(`   📧 Email from session: ${email}`);
    
    if (!email) {
      console.error('❌ [PROFILE] Unauthorized: No email found');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log(`🔍 [PROFILE] Searching for user with email: ${email}`);
    
    let user = await prisma.user.findUnique({
      where: { email },
      include: { 
        externalHandles: true,
        // 👉 FIXED: Explicitly include the topic relations for the Radar Chart
        topicMastery: { include: { topic: true } }, 
        activityLog: {
          orderBy: { date: 'desc' }
        },
        ratingHistory: { 
          orderBy: { createdAt: 'asc' }, 
          include: { contest: { select: { title: true } } } 
        },
        submissions: { 
          select: { id: true, verdict: true, createdAt: true },
          orderBy: { createdAt: 'desc' }
        },
        contestParticipants: {
          where: { standing: { isNot: null } },
          include: { 
            contest: { select: { id: true, title: true, startTime: true, isRated: true } }, 
            standing: true 
          },
          orderBy: { contest: { startTime: 'desc' } }
        }
      }
    });
    
    if (!user) {
      console.warn(`⚠️ [PROFILE] User not found for email: ${email}`);
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`✅ [PROFILE] User found: ${user.username}`);

    const [totalAttempts, totalAccepted] = await Promise.all([
      prisma.submission.count({ where: { userId: user.id } }),
      prisma.submission.count({
        where: {
          userId: user.id,
          verdict: 'ACCEPTED',
          status: 'FINISHED'
        }
      })
    ]);

    const accuracy = totalAttempts > 0 ? Math.round((totalAccepted / totalAttempts) * 100) : 0;

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
        ratingAfter: rAfter,
        coinsEarned: (p as any).coinsEarned || 0 
      };
    });

    // 👉 FIXED: Map relational TopicMastery to the clean {subject, score} format expected by the frontend
    const formattedTopicMastery = user.topicMastery?.map((tm: any) => ({
      subject: tm.topic.name,
      score: tm.ability
    })) || [];

    const responseData = { 
      ...user, 
      topicMastery: formattedTopicMastery, 
      submissions: user.submissions || [],
      stats: { totalAttempts, totalAccepted, accuracy }, 
      matchHistory 
    };

    return res.json(responseData);
    
  } catch (err: any) {
    console.error('❌ [PROFILE] GET /me error:', err);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

profileRouter.post('/claim-username', async (req, res) => {
  try {
    let viewer;
    try {
      viewer = await resolvedViewerFromRequest(req, true);
    } catch (authError) {
      return res.status(401).json({ error: 'Authentication failed' });
    }
    const email = viewer?.email;
    const name = viewer.name; 
    const { username } = req.body;
    
    if (!email) return res.status(401).json({ error: 'Unauthorized: No email provided.' });
    if (!username || username.trim().length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
    }

    const targetUsername = username.trim();

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

    const existingUser = await prisma.user.findUnique({ where: { username: targetUsername } });
    if (existingUser && existingUser.id !== currentUser.id) {
      return res.status(400).json({ error: `The username "${targetUsername}" is already taken.` });
    }

    const updatedUser = await prisma.user.update({
      where: { id: currentUser.id },
      data: { username: targetUsername }
    });

    return res.json({ success: true, username: updatedUser.username });
  } catch (err: any) {
    return res.status(500).json({ error: `Database Error: ${err.message}` });
  }
});

profileRouter.post('/update-password', async (req, res) => {
  try {
    let viewer;
    try {
      viewer = await resolvedViewerFromRequest(req, true);
    } catch (authError) {
      return res.status(401).json({ error: 'Authentication failed' });
    }
    const email = viewer?.email;
    const { currentPassword, newPassword } = req.body;
    
    if (!email) return res.status(401).json({ error: 'Unauthorized' });
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.passwordHash) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password is required to change it.' });
      const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isValid) return res.status(400).json({ error: 'Incorrect current password.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashedPassword }
    });

    return res.json({ success: true, message: 'Password updated successfully!' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

profileRouter.post('/save-handles', async (req, res) => {
  try {
    let viewer;
    try {
      viewer = await resolvedViewerFromRequest(req, true);
    } catch (authError) {
      return res.status(401).json({ error: 'Authentication failed' });
    }
    const email = viewer?.email;
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
    let viewer;
    try {
      viewer = await resolvedViewerFromRequest(req, true);
    } catch (authError) {
      return res.status(401).json({ error: 'Authentication failed' });
    }
    const email = viewer?.email;
    const { platform, handle } = req.params;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    await prisma.externalHandle.deleteMany({
      where: { userId: user.id, platform: platform as Platform, handle }
    });
    
    return res.json({ success: true });
  } catch (err: any) { 
    return res.status(500).json({ error: err.message }); 
  }
});

profileRouter.get('/u/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    const user = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      include: { 
        externalHandles: true,
        // 👉 FIXED: Map relations for public profiles too
        topicMastery: { include: { topic: true } }, 
        activityLog: {
          orderBy: { date: 'desc' }
        },
        submissions: { 
          select: { id: true, verdict: true, createdAt: true },
          orderBy: { createdAt: 'desc' }
        },
        contestParticipants: {
          where: { standing: { isNot: null } },
          include: { 
            contest: { select: { id: true, title: true, startTime: true, isRated: true } }, 
            standing: true 
          },
          orderBy: { contest: { startTime: 'desc' } }
        }
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'Coder not found in the DivineCode database.' });
    }

    const [totalAttempts, totalAccepted] = await Promise.all([
      prisma.submission.count({ where: { userId: user.id } }),
      prisma.submission.count({
        where: {
          userId: user.id,
          verdict: 'ACCEPTED',
          status: 'FINISHED'
        }
      })
    ]);

    const accuracy = totalAttempts > 0 ? Math.round((totalAccepted / totalAttempts) * 100) : 0;

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
        ratingAfter: rAfter,
        coinsEarned: (p as any).coinsEarned || 0 
      };
    });

    const formattedTopicMastery = user.topicMastery?.map((tm: any) => ({
      subject: tm.topic.name,
      score: tm.ability
    })) || [];

    const { passwordHash, email, ...safeProfile } = user as any;

    return res.json({ 
      ...safeProfile, 
      topicMastery: formattedTopicMastery, 
      submissions: user.submissions || [],
      stats: { totalAttempts, totalAccepted, accuracy }, 
      matchHistory 
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});