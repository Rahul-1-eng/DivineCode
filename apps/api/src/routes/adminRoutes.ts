import { Router } from 'express';
import { prisma } from '../prisma/client';
import { resolvedViewerFromRequest } from '../modules/contests/contestRules';
import { normalizeCodeForAST, calculateStructuralSimilarity } from '../utils/plagiarism';

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

// Fetch Recent Contests for the Scanner Dropdown
adminRouter.get('/contests/recent', async (req, res) => {
  try {
    const contests = await prisma.contest.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, startTime: true }
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
    
    // 1. Fetch all accepted submissions for this contest
    const submissions = await prisma.submission.findMany({
      where: { contestId, verdict: 'ACCEPTED' },
      select: { 
        id: true, 
        code: true, 
        user: { select: { username: true, email: true } }, 
        contestProblem: { select: { titleSnapshot: true, id: true } } 
      }
    });

    // 2. Group by problem ID so we only compare apples to apples
    const grouped: Record<string, typeof submissions> = {};
    for (const sub of submissions) {
      const pid = sub.contestProblem?.id;
      if (!pid) continue;
      if (!grouped[pid]) grouped[pid] = [];
      grouped[pid].push(sub);
    }

    const suspiciousPairs = [];

    // 3. Run O(n^2) structural similarity on each problem group
    for (const pid in grouped) {
      const subs = grouped[pid];
      for (let i = 0; i < subs.length; i++) {
        for (let j = i + 1; j < subs.length; j++) {
          // Skip if same user
          if (subs[i].user?.email === subs[j].user?.email) continue; 

          const codeA = normalizeCodeForAST(subs[i].code);
          const codeB = normalizeCodeForAST(subs[j].code);
          
          // Skip highly trivial/boilerplate codes (under 20 chars post-normalization)
          if (codeA.length < 20 || codeB.length < 20) continue; 

          const similarity = calculateStructuralSimilarity(codeA, codeB);
          
          // 🔥 Threshold: Flag anything over 85% structurally similar
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

    // Sort by highest similarity first
    suspiciousPairs.sort((a, b) => b.similarity - a.similarity);

    return res.json({ success: true, pairs: suspiciousPairs });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});