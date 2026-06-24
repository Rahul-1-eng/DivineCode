import { Router } from 'express';
import { prisma } from '../prisma/client';

export const communityRouter = Router();

// GET /api/v2/community/problems
communityRouter.get('/problems', async (req, res) => {
  try {
    const communityProblems = await prisma.problem.findMany({
      where: {
        isCommunity: true,
        approved: true,
      },
      include: { author: true },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    
    res.json(communityProblems);
  } catch (error) {
    console.error("[Community Hub Error]:", error);
    res.status(500).json({ error: "Internal server error loading community hub." });
  }
});

// POST /api/v2/community/upload
communityRouter.post('/upload', async (req, res) => {
  try {
    const email = req.headers['x-user-email'] as string;
    if (!email) return res.status(401).json({ error: "Unauthorized. Missing email header." });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const { title, videoUrl, description } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: "Title is required." });
    }

    const newPost = await prisma.problem.create({
      data: {
        title,
        description: description || "Community submitted video tutorial.",
        videoUrl: videoUrl || null,
        authorId: user.id,
        isCommunity: true,
        approved: true,
        problemCode: `COMM-${Date.now()}-${Math.floor(Math.random()*1000)}`,
        platform: 'DIVINECODE',
        source: 'INTERNAL',
        visibility: 'PUBLIC'
      },
      include: { author: true }
    });

    // Ensure a "System" user exists to satisfy Prisma's Foreign Key constraint
    let systemUser = await prisma.user.findUnique({ where: { id: 'ALL' } });
    if (!systemUser) {
      systemUser = await prisma.user.create({
        data: {
          id: 'ALL',
          username: 'system_broadcast',
          email: 'system@divinecode.local',
          name: 'System Broadcast'
        }
      });
    }

    const notification = await prisma.notification.create({
      data: {
        userId: 'ALL',
        title: "New Community Tutorial! 🎬",
        message: `${user.name || user.username} just uploaded: ${title}.`,
        link: '/community',
        type: "INFO",
        isRead: false
      }
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('new_notification', notification);
      io.emit('new_community_post', newPost);
      io.emit('global_ticker', `🌐 ${user.username || user.name} published a new tutorial: ${title}`);
    }

    res.status(201).json({ success: true, post: newPost });
  } catch (error: any) {
    console.error("[Community Upload Error]:", error);
    res.status(500).json({ error: error.message || "Failed to upload community post." });
  }
});

// 👉 ADDED: DELETE /api/v2/community/problems/:id
communityRouter.delete('/problems/:id', async (req, res) => {
  try {
    const email = req.headers['x-user-email'] as string;
    if (!email) return res.status(401).json({ error: "Unauthorized. Missing email header." });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const problemId = req.params.id;
    const problem = await prisma.problem.findUnique({
      where: { id: problemId },
      include: { author: true }
    });

    if (!problem) return res.status(404).json({ error: "Post not found." });

    // Verify the requester is the author (or an admin)
    if (problem.authorId !== user.id && user.role !== 'ADMIN') {
      return res.status(403).json({ error: "You can only delete your own posts." });
    }

    await prisma.problem.delete({
      where: { id: problemId }
    });

    // Broadcast the deletion so all connected clients remove it instantly
    const io = req.app.get('io');
    if (io) {
      io.emit('post_deleted', { id: problemId });
    }

    res.json({ success: true, message: "Post deleted successfully." });
  } catch (error: any) {
    console.error("[Community Delete Error]:", error);
    res.status(500).json({ error: error.message || "Failed to delete post." });
  }
});

export default communityRouter;