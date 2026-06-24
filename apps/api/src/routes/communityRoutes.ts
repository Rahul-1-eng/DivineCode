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
    const { userId, title, videoUrl, description } = req.body;
    
    if (!userId || !title || !videoUrl) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const newPost = await prisma.problem.create({
      data: {
        title,
        description: description || "Community submitted video tutorial.",
        videoUrl,
        authorId: userId,
        isCommunity: true,
        approved: true,
        problemCode: `COMM-${Date.now()}`
      }
    });

    // Save notification to DB
    const notification = await prisma.notification.create({
      data: {
        userId: 'ALL',
        title: "New Community Tutorial! 🎬",
        message: `${user.name || user.username} just uploaded: ${title}.`,
        link: `/practice/${newPost.id}`,
        type: "INFO",
        isRead: false
      }
    });

    // Emit via WebSocket
    const io = req.app.get('io');
    if (io) {
      io.emit('new_notification', notification);
      io.emit('new_community_post', newPost); // Real-time feed update
    }

    res.status(201).json({ success: true, post: newPost });
  } catch (error) {
    console.error("[Community Upload Error]:", error);
    res.status(500).json({ error: "Failed to upload community post." });
  }
});

export default communityRouter;