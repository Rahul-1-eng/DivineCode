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

    if (!contest) return null;

    // FIXED: Now we process EVERY user, even if they have no standing (0 solves)
    const participants = contest.participants.filter(p => p.user);
    if (participants.length == 0) return null; 

    for (const pA of participants) {
      if (!pA.user) continue;

      // 1. Process Coins & Score for everyone (Rated & Unrated)
      const groupSolves = pA.standing?.solved || 0;
      const rank = pA.standing?.rank || participants.length; // Assign bottom rank if no standing

      const personalSolves = new Set(
        contest.submissions
          .filter(s => s.participantId === pA.id && s.status === SubmissionStatus.FINISHED && (String(s.verdict).includes('ACCEPT') || String(s.verdict) === 'OK'))
          .map(s => s.contestProblemId)
      ).size;

      let rankBonus = 0;
      if (rank === 1) rankBonus = 150;
      else if (rank === 2) rankBonus = 100;
      else if (rank === 3) rankBonus = 50;

      // Calculate earned coins, allow negative penalty for 0 solves
      let earnedCoins = BASE_PARTICIPATION_COINS + rankBonus + (personalSolves * COINS_PER_PERSONAL_SOLVE) + (groupSolves * COINS_PER_GROUP_SOLVE);
      if (personalSolves === 0 && groupSolves === 0) {
        earnedCoins = -15; // Penalty for participating but not solving anything
      }

      let oldRating = pA.ratingBefore || pA.user.rating || 1200;
      let newRating = oldRating;
      let ratingDelta = 0;

      // 2. Process Elo Rating ONLY if Rated AND participant is Official
      if (contest.isRated && pA.isOfficial) {
        let expectedWins = 0;
        let actualWins = 0;

        for (const pB of participants) {
          if (pA.id === pB.id || !pB.user || !pB.isOfficial) continue;
          if (pA.teamId && pA.teamId === pB.teamId) continue; // Don't steal Elo from teammates

          const ratingB = pB.ratingBefore || pB.user.rating || 1200;
          expectedWins += 1 / (1 + Math.pow(10, (ratingB - oldRating) / 400));

          const rankB = pB.standing?.rank || participants.length; // Bottom rank fallback

          if (rank < rankB) actualWins += 1;
          else if (rank === rankB) actualWins += 0.5;
        }

        const rawDelta = Math.round(K_FACTOR * (actualWins - expectedWins));
        ratingDelta = Math.max(-100, rawDelta); // Cap maximum rating loss at -100
        newRating = Math.max(100, oldRating + ratingDelta); // Floor rating at 100

        await tx.ratingHistory.create({
          data: {
            userId: pA.userId!,
            eventType: 'CONTEST',
            oldRating,
            newRating,
            delta: ratingDelta,
            reason: `Finished Rank #${rank} in ${contest.title}`,
            contestId: contest.id
          }
        });
      }

      // 3. Commit Updates
      await tx.user.update({
        where: { id: pA.userId! },
        data: {
          rating: newRating,
          coins: { increment: earnedCoins }
        }
      });

      await tx.contestParticipant.update({
        where: { id: pA.id },
        data: { 
          ratingBefore: oldRating, 
          ratingAfter: newRating,
          score: { increment: earnedCoins } 
        }
      });
    }

    return { success: true, processedCount: participants.length };
  }, { timeout: 30000 }); // Added transaction timeout buffer for large contests
}