import { Router } from 'express';
import { prisma } from '../prisma/client';
import { resolvedViewerFromRequest } from '../modules/contests/contestRules';

export const adminRouter = Router();

// 🔒 STRICT ADMIN MIDDLEWARE
const verifyAdmin = async (req: any, res: any, next: any) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.email) return res.status(401).json({ error: 'Unauthorized' });
    
    const user = await prisma.user.findUnique({ where: { email: viewer.email } });
    
    // Add your own email to your .env file like this: ADMIN_EMAILS=yourname@gmail.com
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