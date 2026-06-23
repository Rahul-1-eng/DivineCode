import { Router } from 'express';
import { prisma } from '../prisma/client';

const router = Router();

// GET /api/v2/community/problems
router.get('/problems', async (req, res) => {
  try {
    const communityProblems = await prisma.problem.findMany({
      where: {
        isCommunity: true,
        approved: true, // Only show problems an admin has approved
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 50 // Limit to the 50 most recent to keep the frontend snappy
    });
    
    res.json(communityProblems);
  } catch (error) {
    console.error("[Community Hub Error]:", error);
    res.status(500).json({ error: "Internal server error loading community hub." });
  }
});

export default router;