import { Router } from 'express';
import { prisma } from '../prisma/client';
// Note: Depending on your exact project structure, you can access the socket io instance 
// directly via the Express app (req.app.get('io')) if you attached it during server setup.
// If you export it from index.ts, you can import it here.

export const communityRouter = Router();

// GET /api/v2/community/problems
communityRouter.get('/problems', async (req, res) => {
  try {
    const communityProblems = await prisma.problem.findMany({
      where: {
        isCommunity: true,
        approved: true, // Only fetch problems an admin has approved
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 50 // Limit to keep the UI snappy
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
    
    // 1. Validate user and save the community post to the database
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const newPost = await prisma.problem.create({
      data: {
        title: title,
        description: description || "Community submitted video tutorial.",
        videoUrl: videoUrl,
        authorId: userId,
        isCommunity: true,
        approved: true, // In a real app, you might want this to be false for admin review
        problemCode: `COMM-${Date.now()}` // Generate a unique code
      }
    });

    // 2. TRIGGER THE GLOBAL NOTIFICATION
    const notificationPayload = {
      id: `notif_${Date.now()}`,
      title: "New Community Tutorial! 🎬",
      message: `${user.name || user.username} just uploaded: ${title}.`,
      type: "INFO",
      link: `/practice/${newPost.id}`, // Link directly to the new problem/video
      createdAt: new Date(),
      isRead: false
    };

    // Grab the socket instance attached to the express app to emit globally
    const io = req.app.get('io');
    if (io) {
      io.emit('new_notification', notificationPayload);
    }

    // Optional: Save notification strictly into the DB for all active users
    // This can be heavily optimized using background workers/Redis in production.

    res.status(201).json({ success: true, post: newPost });
  } catch (error) {
    console.error("[Community Upload Error]:", error);
    res.status(500).json({ error: "Failed to upload community post." });
  }
});

export default communityRouter;