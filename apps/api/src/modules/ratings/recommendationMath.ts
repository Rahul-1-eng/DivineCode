/**
 * @file recommendationMath.ts
 * @author Rahul Kumar Sahoo
 * @description Core application logic for the platform feature.
 */

import { prisma } from '../../prisma/client';
import { analyzeUserWeaknesses } from '../ai/aiService';

export async function generateTargetedPracticeSet(userId: string) {
  try {
    // 1. Fetch recent failed submissions (WA, TLE, RE)
    const failedSubs = await prisma.submission.findMany({
      where: { 
        userId, 
        verdict: { notIn: ['ACCEPTED', 'COMPILATION_ERROR', 'PENDING', 'SKIPPED'] } 
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { contestProblem: true, problem: true }
    });

    if (failedSubs.length < 3) {
      return { 
        success: false, 
        message: "Not enough failed submissions to perform a reliable weakness analysis. Keep practicing!" 
      };
    }

    const payload = failedSubs.map(sub => ({
       problemTitle: sub.contestProblem?.titleSnapshot || sub.problem?.title || 'Unknown Problem',
       code: sub.code.substring(0, 500), // Cap length to save tokens
       verdict: sub.verdict
    }));

    // 2. Feed failures to the AI Coach
    const aiAnalysis = await analyzeUserWeaknesses(payload);
    
    if (!aiAnalysis || !aiAnalysis.radarUpdates) {
      return { success: false, error: "AI Coaching Engine failed to generate analysis." };
    }

    // 3. Fetch User and Current Topic Mastery via Prisma relations
    const user = await prisma.user.findUnique({ 
      where: { id: userId },
      include: { topicMastery: { include: { topic: true } } }
    });

    const defaultRadarData = [
      { subject: 'Dynamic Programming', score: 85 },
      { subject: 'Graph Theory', score: 70 },
      { subject: 'Data Structures', score: 90 },
      { subject: 'Greedy Math', score: 60 },
      { subject: 'String Algorithms', score: 75 }
    ];

    let currentMastery: any[] = [];
    
    // Map the relational data to the shape the frontend radar chart expects
    if (user?.topicMastery && user.topicMastery.length > 0) {
       currentMastery = user.topicMastery.map(tm => ({
           subject: tm.topic.name,
           score: tm.ability || 0
       }));
    } else {
       currentMastery = [...defaultRadarData];
    }

    // 4. Update the Radar Chart scores based on AI Deductions using DB Upserts
    for (const update of aiAnalysis.radarUpdates) {
      const subject = update.subject || 'General';
      const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      
      // Ensure the topic exists in the global Topic catalog
      const topic = await prisma.topic.upsert({
        where: { slug },
        update: { name: subject },
        create: { slug, name: subject }
      });

      const existing = currentMastery.find(m => m.subject.toLowerCase() === subject.toLowerCase());
      const newScore = existing 
        ? Math.max(10, Math.min(100, existing.score + (update.scoreDelta || 0))) 
        : Math.max(10, 80 + (update.scoreDelta || 0));

      if (existing) {
          existing.score = newScore;
      } else {
          currentMastery.push({ subject, score: newScore });
      }

      // Upsert the specific user's mastery level
      await prisma.topicMastery.upsert({
        where: { userId_topicId: { userId: userId, topicId: topic.id } },
        update: { ability: newScore },
        create: { userId: userId, topicId: topic.id, ability: newScore }
      });
    }

    // 5. Query Practice Problems Based on Weakest Topic and User's Elo
    const weakestTopicName = aiAnalysis.weaknesses[0]?.topic || 'Data Structures';
    const userElo = user?.rating || 1200;

    const recommendedProblems = await prisma.problem.findMany({
      where: {
        tags: { has: weakestTopicName },
        rating: { 
          gte: userElo - 100,
          lte: userElo + 250 // Push them slightly outside their comfort zone
        }
      },
      take: 3,
      select: { id: true, title: true, rating: true, tags: true }
    });

    return {
       success: true,
       analysis: aiAnalysis,
       newRadarChart: currentMastery,
       recommendedProblems: recommendedProblems.length > 0 ? recommendedProblems : [{ title: `Practice: ${weakestTopicName} fundamentals`, rating: userElo + 50 }]
    };
  } catch (err: any) {
    console.error("Targeted Practice Generation Error:", err);
    return { success: false, error: err.message };
  }
}
// Legacy support for profileSyncService compilation
export function estimateUnifiedRating(...ratings: any[]): number {
  const validRatings = ratings.filter(r => typeof r === 'number' && !isNaN(r) && r > 0);
  if (validRatings.length === 0) return 1200;
  
  // Calculate a balanced average of their internal and external ratings
  const sum = validRatings.reduce((a, b) => a + b, 0);
  return Math.round(sum / validRatings.length);
}