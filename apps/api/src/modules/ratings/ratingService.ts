import { RatingEventType, SubmissionStatus } from '@prisma/client';
import { prisma } from '../../prisma/client';

const K_FACTOR = 32;
const COINS_PER_PERSONAL_SOLVE = 50;
const COINS_PER_GROUP_SOLVE = 20;
const BASE_PARTICIPATION_COINS = 10;

export async function processContestRewards(contestId: string) {
  return prisma.$transaction(async (tx) => {
    const contest = await tx.contest.findUnique({
      where: { id: contestId },
      include: {
        participants: { include: { user: true, standing: true } },
        submissions: true
      }
    });

    if (!contest || !contest.isRated) return null;

    const participants = contest.participants.filter(p => p.standing && p.user);
    if (participants.length == 0) return null; // Need at least 2 people for a rated event

    const updates = [];

    for (const pA of participants) {
      if (!pA.user || !pA.standing) continue;

      const oldRating = pA.ratingBefore || pA.user.rating || 1200;
      let expectedWins = 0;
      let actualWins = 0;

      // 1. Calculate Multiplayer Elo Delta
      for (const pB of participants) {
        // 👉 FIX: Don't compare against yourself, AND don't steal/lose Elo against your own teammates!
        if (pA.id === pB.id || !pB.user || !pB.standing) continue;
        if (pA.teamId && pA.teamId === pB.teamId) continue;

        const ratingB = pB.ratingBefore || pB.user.rating || 1200;
        
        // Expected score against pB
        expectedWins += 1 / (1 + Math.pow(10, (ratingB - oldRating) / 400));

        // Actual score against pB (1 for win, 0.5 for tie, 0 for loss)
        if (pA.standing.rank! < pB.standing.rank!) actualWins += 1;
        else if (pA.standing.rank === pB.standing.rank) actualWins += 0.5;
      }

      const rawDelta = Math.round(K_FACTOR * (actualWins - expectedWins));
      // 👉 Gamification: Cap maximum rating loss at -100 to prevent user churn, uncapped upside.
      const ratingDelta = Math.max(-100, rawDelta);
      const newRating = Math.max(100, oldRating + ratingDelta); 

      // 2. Calculate Coins (Personal + Group Contribution + Placement Bonuses)
      const groupSolves = pA.standing.solved || 0;
      
      const personalSolves = new Set(
        contest.submissions
          // 👉 FIX: Cast to String to handle both Prisma Enum ('ACCEPTED') and External Syncs ('OK')
          .filter(s => s.participantId === pA.id && s.status === SubmissionStatus.FINISHED && (String(s.verdict).includes('ACCEPT') || String(s.verdict) === 'OK'))
          .map(s => s.contestProblemId)
      ).size;

      // 👉 FIX: Placement Bonuses
      let rankBonus = 0;
      if (pA.standing.rank === 1) rankBonus = 150;
      else if (pA.standing.rank === 2) rankBonus = 100;
      else if (pA.standing.rank === 3) rankBonus = 50;

      const earnedCoins = Math.max(0, BASE_PARTICIPATION_COINS + rankBonus + 
                                      (personalSolves * COINS_PER_PERSONAL_SOLVE) + 
                                      (groupSolves * COINS_PER_GROUP_SOLVE));

      // 3. Queue Database Updates Atomically
      updates.push(
        tx.user.update({
          where: { id: pA.userId! },
          data: {
            rating: newRating,
            coins: { increment: earnedCoins }
          }
        }),
        tx.contestParticipant.update({
          where: { id: pA.id },
          data: { ratingBefore: oldRating, ratingAfter: newRating }
        }),
        tx.ratingHistory.create({
          data: {
            userId: pA.userId!,
            eventType: 'CONTEST',
            oldRating,
            newRating,
            delta: ratingDelta,
            reason: `Finished Rank #${pA.standing.rank} in ${contest.title}`,
            contestId: contest.id
          }
        })
      );
    }

    // Execute all updates simultaneously
    await Promise.all(updates);
    return { success: true, processedCount: participants.length };
  });
}