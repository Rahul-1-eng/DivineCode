import { Router } from 'express';
import { prisma } from '../prisma/client';
import { resolvedViewerFromRequest } from '../modules/contests/contestRules';

export const notificationRouter = Router();

export async function sendNotification(userId: string, title: string, message: string, link?: string, type: 'INFO' | 'SUCCESS' | 'WARNING' = 'INFO') {
  try {
    await prisma.notification.create({
      data: { userId, title, message, link, type }
    });
  } catch (err) {
    console.error('Failed to send notification:', err);
  }
}

// Fetch user's notifications (INCLUDING GLOBAL ONES)
notificationRouter.get('/', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.userId) return res.status(401).json({ error: 'Unauthorized' });

    const notifications = await prisma.notification.findMany({
      where: { 
        OR: [
          { userId: viewer.userId },
          { userId: 'ALL' } // <-- FIX: Grabs global community broadcasts
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    return res.json(notifications);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

notificationRouter.put('/:id/read', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.userId) return res.status(401).json({ error: 'Unauthorized' });

    // Note: Marking 'ALL' as read updates it for everyone. 
    // Out-of-the-box thought: In the future, create a 'UserReadNotifications' junction table.
    await prisma.notification.updateMany({
      where: { id: req.params.id, userId: viewer.userId },
      data: { isRead: true }
    });

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

notificationRouter.put('/read-all', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.userId) return res.status(401).json({ error: 'Unauthorized' });

    await prisma.notification.updateMany({
      where: { userId: viewer.userId, isRead: false },
      data: { isRead: true }
    });

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});