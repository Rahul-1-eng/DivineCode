/**
 * @file adminRoutes.ts
 * @author Rahul Kumar Sahoo
 * @description Route handlers for the platform API.
 */

import { Router } from 'express';
import { prisma } from '../prisma/client';
import { resolvedViewerFromRequest } from '../modules/contests/contestRules';
import { normalizeCodeForAST, calculateStructuralSimilarity } from '../utils/plagiarism';
import { sendMail, emailHealth, adminEmail } from '../modules/email/emailService';
import { clearBanCache } from '../modules/moderation/banGuard';
import { getMonitorSnapshot } from '../modules/moderation/activityMonitor';

export const adminRouter = Router();

// 🔒 STRICT ADMIN MIDDLEWARE
const verifyAdmin = async (req: any, res: any, next: any) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });
    
    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',');
    const isAdmin = (user as any)?.role === 'ADMIN' || adminEmails.includes(viewer.email);
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden. Admin access required.' });
    }
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Admin verification failed.' });
  }
};

adminRouter.use(verifyAdmin);

// Gmail pipeline check from the admin panel: verifies SMTP login, and with
// ?test=1 delivers a real mail to the admin inbox so delivery is provably live.
adminRouter.get('/email/health', async (req, res) => {
  try {
    const result = await emailHealth(req.query.test ? adminEmail() : undefined);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// Live monitoring — who is online right now, what every user is doing, and the
// rolling activity feed. The admin panel polls this and offers block/unblock
// directly on each row.
// -----------------------------------------------------------------------------
adminRouter.get('/monitor', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const snapshot = getMonitorSnapshot(300);

    // Resolve every email seen in telemetry to a real account (username, role,
    // ban state) in one query so each feed row can carry a block button.
    const emails = Array.from(new Set([
      ...snapshot.presence.map(p => p.email),
      ...snapshot.events.map(e => e.email)
    ]));
    const users = emails.length === 0 ? [] : await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true, username: true, email: true, name: true, role: true, bannedUntil: true, banReason: true }
    });
    const byEmail = new Map(users.map(u => [u.email.toLowerCase(), u]));
    const now = Date.now();

    const decorate = (email: string) => {
      const u = byEmail.get(email.toLowerCase());
      return {
        userId: u?.id || null,
        username: u?.username || email.split('@')[0],
        email,
        role: u?.role || 'USER',
        isBanned: !!u?.bannedUntil && u.bannedUntil.getTime() > now,
        bannedUntil: u?.bannedUntil || null,
        banReason: u?.banReason || null
      };
    };

    const matches = (d: ReturnType<typeof decorate>) =>
      !search || d.username.toLowerCase().includes(search) || d.email.toLowerCase().includes(search);

    const ONLINE_WINDOW_MS = 5 * 60 * 1000;
    const online = snapshot.presence
      .filter(p => now - p.lastSeen < ONLINE_WINDOW_MS)
      .map(p => ({ ...decorate(p.email), lastSeen: p.lastSeen, lastAction: p.lastAction, lastPath: p.lastPath }))
      .filter(matches);

    const events = snapshot.events
      .map(e => ({ id: e.id, at: e.at, method: e.method, path: e.path, action: e.action, ...decorate(e.email) }))
      .filter(matches);

    return res.json({ success: true, online, events, generatedAt: now });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// User moderation — block / unblock accounts for a chosen duration.
// A blocked user can still browse public pages but every authenticated write
// (submissions, bookings, chat, contests) is rejected until the ban lapses.
// -----------------------------------------------------------------------------

// Paginated user directory for the moderation panel.
adminRouter.get('/users', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const where: any = search ? {
      OR: [
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } }
      ]
    } : {};
    const users = await prisma.user.findMany({
      where,
      take: 50,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, username: true, email: true, name: true, role: true,
        rating: true, coins: true, createdAt: true,
        bannedUntil: true, banReason: true
      }
    });
    const now = Date.now();
    return res.json(users.map(u => ({
      ...u,
      isBanned: !!u.bannedUntil && u.bannedUntil.getTime() > now
    })));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Block a user. durationHours = 0 / omitted → permanent (100 years).
adminRouter.post('/users/:id/block', async (req, res) => {
  try {
    const { durationHours, reason } = req.body || {};
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.role === 'ADMIN') return res.status(400).json({ error: 'Admins cannot be blocked.' });

    const hours = Number(durationHours);
    const bannedUntil = Number.isFinite(hours) && hours > 0
      ? new Date(Date.now() + hours * 3600 * 1000)
      : new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000); // effectively permanent

    await prisma.user.update({
      where: { id: target.id },
      data: { bannedUntil, banReason: String(reason || 'Violation of platform rules.').slice(0, 500) }
    });
    clearBanCache(target.email);

    sendMail(target.email,
      'Your DivineCode account has been restricted',
      'Account restricted by moderation',
      `Your account has been blocked ${Number.isFinite(hours) && hours > 0 ? `until <strong>${bannedUntil.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</strong>` : '<strong>indefinitely</strong>'}.<br/><br/>
       Reason: <em>${String(reason || 'Violation of platform rules.').slice(0, 500)}</em><br/><br/>
       If you believe this is a mistake, reply to this email to appeal.`);

    return res.json({ success: true, bannedUntil });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/users/:id/unblock', async (req, res) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found.' });

    await prisma.user.update({
      where: { id: target.id },
      data: { bannedUntil: null, banReason: null }
    });
    clearBanCache(target.email);

    sendMail(target.email,
      'Your DivineCode account has been restored',
      'Welcome back — restriction lifted',
      'The block on your account has been removed. All platform features are available again.');

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Fetch Platform Metrics
adminRouter.get('/metrics', async (req, res) => {
  try {
    const [userCount, contestCount, submissionCount, reportCount] = await Promise.all([
      prisma.user.count(),
      prisma.contest.count(),
      prisma.submission.count(),
      prisma.submissionReport.count()
    ]);

    return res.json({ userCount, contestCount, submissionCount, reportCount });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Fetch Flagged Submissions
adminRouter.get('/reports', async (req, res) => {
  try {
    const reports = await prisma.submissionReport.findMany({
      include: {
        submission: {
          select: { id: true, code: true, verdict: true, user: { select: { username: true } } }
        },
        reporter: { select: { username: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    return res.json(reports);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Dismiss a Report
adminRouter.delete('/reports/:id', async (req, res) => {
  try {
    await prisma.submissionReport.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Fetch Recent Contests
adminRouter.get('/contests/recent', async (req, res) => {
  try {
    const contests = await prisma.contest.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, startTime: true, status: true, isRated: true }
    });
    return res.json(contests);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 🚀 Execute Plagiarism Batch Scan
adminRouter.get('/plagiarism/scan/:contestId', async (req, res) => {
  try {
    const { contestId } = req.params;
    
    const submissions = await prisma.submission.findMany({
      where: { contestId, verdict: 'ACCEPTED' },
      select: { 
        id: true, 
        code: true, 
        user: { select: { username: true, email: true } }, 
        contestProblem: { select: { titleSnapshot: true, id: true } } 
      }
    });

    const grouped: Record<string, typeof submissions> = {};
    for (const sub of submissions) {
      const pid = sub.contestProblem?.id;
      if (!pid) continue;
      if (!grouped[pid]) grouped[pid] = [];
      grouped[pid].push(sub);
    }

    const suspiciousPairs = [];

    for (const pid in grouped) {
      const subs = grouped[pid];
      for (let i = 0; i < subs.length; i++) {
        for (let j = i + 1; j < subs.length; j++) {
          if (subs[i].user?.email === subs[j].user?.email) continue; 

          const codeA = normalizeCodeForAST(subs[i].code);
          const codeB = normalizeCodeForAST(subs[j].code);
          
          if (codeA.length < 20 || codeB.length < 20) continue; 

          const similarity = calculateStructuralSimilarity(codeA, codeB);
          
          if (similarity > 0.85) { 
            suspiciousPairs.push({
              problemTitle: subs[i].contestProblem?.titleSnapshot || 'Unknown Problem',
              userA: subs[i].user?.username || subs[i].user?.email,
              userB: subs[j].user?.username || subs[j].user?.email,
              similarity: Math.round(similarity * 100),
              codeA: subs[i].code,
              codeB: subs[j].code
            });
          }
        }
      }
    }

    suspiciousPairs.sort((a, b) => b.similarity - a.similarity);

    return res.json({ success: true, pairs: suspiciousPairs });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 🚀 NEW: Finalize Contest & Distribute Ratings/Coins
// 🚀 NEW: Finalize Contest & Distribute Ratings/Coins
adminRouter.post('/contests/:id/finalize', async (req, res) => {
  try {
    const { id } = req.params;

    const contest = await prisma.contest.findUnique({
      where: { id },
      include: {
        participants: {
          include: { user: true, standing: true }
        }
      }
    });

    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    if (!contest.isRated) return res.status(400).json({ error: 'Contest is not marked as Rated.' });
    if (contest.status === 'ENDED') return res.status(400).json({ error: 'Contest is already finalized.' });

    // 1. Sort participants by their final contest score (descending)
    const rankedParticipants = contest.participants
      .filter(p => p.standing)
      .sort((a, b) => {
        if (b.standing!.score === a.standing!.score) {
          return a.standing!.penalty - b.standing!.penalty; // Tie-breaker: lower penalty wins
        }
        return b.standing!.score - a.standing!.score;
      });

    const totalPlayers = rankedParticipants.length;
    if (totalPlayers === 0) return res.status(400).json({ error: 'No participants to rate.' });

    // 2. Loop through and apply Elo Math
    for (let i = 0; i < totalPlayers; i++) {
      const p = rankedParticipants[i];
      if (!p.user) continue;

      // Simple Elo Math: Top 30% gain rating, middle stay similar, bottom lose rating
      const percentile = i / totalPlayers;
      let ratingDelta = 0;
      let coinsEarned = 10; // Participation award

      if (percentile <= 0.1) { ratingDelta = +45; coinsEarned = 200; }      // Top 10%
      else if (percentile <= 0.3) { ratingDelta = +20; coinsEarned = 100; } // Top 30%
      else if (percentile <= 0.6) { ratingDelta = +5; coinsEarned = 50; }   // Middle
      else if (percentile <= 0.8) { ratingDelta = -10; coinsEarned = 10; }  // Bottom 40%
      else { ratingDelta = -25; coinsEarned = 5; }                          // Bottom 20%

      // 3. Update the Participant Record (so it shows in Match History)
      await prisma.contestParticipant.update({
        where: { id: p.id },
        data: {
          ratingBefore: p.user.rating,
          ratingAfter: p.user.rating + ratingDelta
        }
      });

      // 4. Update the User's Global Balances
      await prisma.user.update({
        where: { id: p.user.id },
        data: {
          rating: { increment: ratingDelta },
          coins: { increment: coinsEarned }
        }
      });

      // 5. Create the ActivityLog Receipt! (This makes the table show the data)
      await prisma.activityLog.create({
        data: {
          userId: p.user.id,
          eventDescription: `Rank #${i + 1} in ${contest.title}`,
          ratingDelta: ratingDelta,
          coinDelta: coinsEarned,
          date: new Date()
        }
      });
    }

    // Mark the contest as officially ended
    await prisma.contest.update({
      where: { id },
      data: { status: 'ENDED' }
    });

    return res.json({ success: true, message: `Successfully rated ${totalPlayers} participants!` });

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});