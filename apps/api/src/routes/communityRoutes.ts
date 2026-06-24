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
    // Extract email securely from the header
    const email = req.headers['x-user-email'] as string;
    if (!email) return res.status(401).json({ error: "Unauthorized. Missing email header." });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const { title, videoUrl, description } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: "Title is required." });
    }

    // 👉 FIXED: Added required platform, source, and visibility fields to satisfy Prisma
    const newPost = await prisma.problem.create({
      data: {
        title,
        description: description || "Community submitted video tutorial.",
        videoUrl: videoUrl || null, // Allow optional videoUrls
        authorId: user.id,
        isCommunity: true,
        approved: true,
        problemCode: `COMM-${Date.now()}-${Math.floor(Math.random()*1000)}`,
        platform: 'DIVINECODE', // Required enum
        source: 'INTERNAL',      // Required enum
        visibility: 'PUBLIC'     // Required enum
      },
      include: { author: true }
    });

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

    // 👉 Full Gapless Broadcast (Updates ticker, notifications, and feed)
    const io = req.app.get('io');
    if (io) {
      io.emit('new_notification', notification);
      io.emit('new_community_post', newPost);
      io.emit('global_ticker', `🌐 ${user.username || user.name} published a new tutorial: ${title}`);
    }

    res.status(201).json({ success: true, post: newPost });
  } catch (error: any) {
    console.error("[Community Upload Error]:", error);
    // Return the actual error message to the frontend to aid in debugging if needed
    res.status(500).json({ error: error.message || "Failed to upload community post." });
  }
});

export default communityRouter;