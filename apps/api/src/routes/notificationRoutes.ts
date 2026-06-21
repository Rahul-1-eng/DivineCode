import { Router } from 'express';
import { prisma } from '../prisma/client';
import { resolvedViewerFromRequest } from '../modules/contests/contestRules';

export const notificationRouter = Router();

// 👉 HELPER: Call this from ANY file to instantly alert a user
export async function sendNotification(userId: string, title: string, message: string, link?: string, type: 'INFO' | 'SUCCESS' | 'WARNING' = 'INFO') {
  try {
    await prisma.notification.create({
      data: { userId, title, message, link, type }
    });
  } catch (err) {
    console.error('Failed to send notification:', err);
  }
}

// Fetch user's notifications
notificationRouter.get('/', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.userId) return res.status(401).json({ error: 'Unauthorized' });

    const notifications = await prisma.notification.findMany({
      where: { userId: viewer.userId },
      orderBy: { createdAt: 'desc' },
      take: 20 // Keep the payload light
    });

    return res.json(notifications);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Mark single notification as read
notificationRouter.put('/:id/read', async (req, res) => {
  try {
    const viewer = await resolvedViewerFromRequest(req, true);
    if (!viewer.userId) return res.status(401).json({ error: 'Unauthorized' });

    await prisma.notification.updateMany({
      where: { id: req.params.id, userId: viewer.userId },
      data: { isRead: true }
    });

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Mark all as read
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