import { RatingEventType, Verdict, SubmissionStatus } from '@prisma/client';
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
    if (participants.length <= 1) return null; // Need at least 2 people for a rated event

    const updates = [];

    for (const pA of participants) {
      if (!pA.user || !pA.standing) continue;

      const oldRating = pA.ratingBefore || pA.user.rating || 1200;
      let expectedWins = 0;
      let actualWins = 0;

      // 1. Calculate Multiplayer Elo Delta
      for (const pB of participants) {
        if (pA.id === pB.id || !pB.user || !pB.standing) continue;

        const ratingB = pB.ratingBefore || pB.user.rating || 1200;
        
        // Expected score against pB
        expectedWins += 1 / (1 + Math.pow(10, (ratingB - oldRating) / 400));

        // Actual score against pB (1 for win, 0.5 for tie, 0 for loss)
        // Lower rank index = better score
        if (pA.standing.rank! < pB.standing.rank!) actualWins += 1;
        else if (pA.standing.rank === pB.standing.rank) actualWins += 0.5;
      }

      const ratingDelta = Math.round(K_FACTOR * (actualWins - expectedWins));
      const newRating = Math.max(100, oldRating + ratingDelta); // Floor at 100 rating

      // 2. Calculate Coins (Personal + Group Contribution)
      const groupSolves = pA.standing.solved || 0;
      
      const personalSolves = new Set(
        contest.submissions
          .filter(s => s.participantId === pA.id && s.verdict === Verdict.ACCEPTED && s.status === SubmissionStatus.FINISHED)
          // 👉 FIX: Codeforces/External problems lack a native problemId, use contestProblemId to accurately count user solves.
          .map(s => s.contestProblemId)
      ).size;

      // 👉 FIX: Added floor to ensure penalties/negative modifiers never pull coins below 0.
      const earnedCoins = Math.max(0, BASE_PARTICIPATION_COINS + 
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
            eventType: RatingEventType.CONTEST,
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