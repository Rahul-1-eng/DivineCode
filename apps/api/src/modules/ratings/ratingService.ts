/**
 * @file ratingService.ts
 * @author Rahul Kumar Sahoo
 * @description Manages Elo calculations and token (coin) allocations post-match/contest.
 * Relies on transactional boundaries to prevent race conditions during updates.
 */
import { RatingEventType, SubmissionStatus } from '@prisma/client';
import { prisma } from '../../prisma/client';

// Standardized tuning parameters for rating volatility and economy
const K_FACTOR = 32;
const COINS_PER_PERSONAL_SOLVE = 50;
const COINS_PER_GROUP_SOLVE = 20;
const BASE_PARTICIPATION_COINS = 10;

// ==========================================
// 1. CONTEST REWARDS & RATING LOGIC
// ==========================================
export async function processContestRewards(contestId: string) {
  console.info(`[REWARD ENGINE] Initiating payout & Elo calculation for contest: ${contestId}`);

  // Enclose all score and wallet updates in a single transaction.
  // This prevents scenarios where a node crash leaves half the users updated and the rest pending.
 const resultRows = await prisma.$transaction(async (tx) => {
    const contest = await tx.contest.findUnique({
      where: { id: contestId },
      include: {
        participants: { include: { user: true, standing: true } },
        submissions: true
      }
    });

    if (!contest) {
      console.warn(`[REWARD ENGINE] Contest ${contestId} not found during processing!`);
      return null;
    }

    const participants = contest.participants.filter(p => p.user);
    if (participants.length === 0) {
      console.info(`[REWARD ENGINE] No valid participants found for contest ${contestId}.`);
      return null; 
    }

    // Pre-calculate mapping for Elo processing to optimize read access inside loop
    for (const pA of participants) {
      if (!pA.user) continue;

      // 1. Evaluate Statistical Performance
      const groupSolves = pA.standing?.solved || 0;
      const rank = pA.standing?.rank || participants.length;

      // Map unique accepted problems by the current participant
      const personalSolves = new Set(
        contest.submissions
          .filter(s => s.participantId === pA.id && s.status === SubmissionStatus.FINISHED && (String(s.verdict).includes('ACCEPT') || String(s.verdict) === 'OK'))
          .map(s => s.contestProblemId)
      ).size;

      // 2. Token Allocation Logic (Coins)
      let rankBonus = 0;
      if (rank === 1) rankBonus = 150;
      else if (rank === 2) rankBonus = 100;
      else if (rank === 3) rankBonus = 50;

      let earnedCoins = BASE_PARTICIPATION_COINS + rankBonus + (personalSolves * COINS_PER_PERSONAL_SOLVE) + (groupSolves * COINS_PER_GROUP_SOLVE);
      
      // Penalize complete inactivity to discourage farming baseline participation tokens
      if (personalSolves === 0 && groupSolves === 0) {
        earnedCoins = -15; 
      }

      let oldRating = pA.ratingBefore || pA.user.rating || 1200;
      let newRating = oldRating;
      let ratingDelta = 0;

      // 3. Process Standardized Elo Rating Shift
      // Note: This is an O(N^2) calculation. It's acceptable for standard contest sizes (< 2,000 users).
      // For larger scale, consider implementing Elo approximation via linear sorting heuristics.
      if (contest.isRated && pA.isOfficial) {
        let expectedWins = 0;
        let actualWins = 0;

        for (const pB of participants) {
          if (pA.id === pB.id || !pB.user || !pB.isOfficial) continue;
          if (pA.teamId && pA.teamId === pB.teamId) continue; // Skip intra-team Elo adjustments

          const ratingB = pB.ratingBefore || pB.user.rating || 1200;
          expectedWins += 1 / (1 + Math.pow(10, (ratingB - oldRating) / 400));
          
          const rankB = pB.standing?.rank || participants.length;

          // Win/Loss distribution logic handles tie-breakers with 0.5 points
          if (rank < rankB) actualWins += 1;
          else if (rank === rankB) actualWins += 0.5;
        }

        const rawDelta = Math.round(K_FACTOR * (actualWins - expectedWins));
        // Clamp maximum negative swing to prevent extreme rating tanking from single bad matches
        ratingDelta = Math.max(-100, rawDelta);
        // Ensure ratings do not go negative (hard floor at 100)
        newRating = Math.max(100, oldRating + ratingDelta);

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

      await tx.activityLog.create({
        data: {
          userId: pA.userId!,
          eventDescription: `${contest.title} • ${rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `#${rank}`} • ${earnedCoins >= 0 ? '+' : ''}${earnedCoins} coins${ratingDelta !== 0 ? ` • Rating ${ratingDelta >= 0 ? '+' : ''}${ratingDelta}` : ''}`,
          ratingDelta,
          coinDelta: earnedCoins,
          date: new Date()
        }
      });

      // 4. Commit Balances to DB Row
      await tx.user.update({
        where: { id: pA.userId! },
        data: {
          rating: newRating,
          coins: { increment: earnedCoins }
        }
      });

      await tx.notification.create({
        data: {
          userId: pA.userId!,
          title: `Contest Finalized!`,
          message: `You earned ${earnedCoins} coins. Your new rating is ${newRating} (${ratingDelta >= 0 ? '+' : ''}${ratingDelta}).`,
          type: "SUCCESS",
          link: `/contests/${contest.id}/final`
        }
      });

      // Update contest-specific snapshot state for historical archiving
      await tx.contestParticipant.update({
        where: { id: pA.id },
        data: { 
          ratingBefore: oldRating, 
          ratingAfter: newRating,
          score: { increment: earnedCoins } 
        }
      });
    }

    console.info(`[REWARD ENGINE] Successfully processed rewards for ${participants.length} users.`);
    return { success: true, processedCount: participants.length };
  }, { timeout: 30000 }); // Extends transaction lock timeout for heavy O(N^2) loops on big contests
}

// ==========================================
// 2. 1v1 DUEL ELO & REWARD LOGIC
// ==========================================

/**
 * Calculates the expected win probability of Player A against Player B using standard logistics distribution.
 */
function getExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Executes a locked transaction block updating Elo ratings and coin allocations for two players post 1v1 Duel.
 */
export async function processDuelEloUpdate(winnerId: string, loserId: string, duelId: string) {
  try {
    const winner = await prisma.user.findUnique({ where: { id: winnerId } });
    const loser = await prisma.user.findUnique({ where: { id: loserId } });

    if (!winner || !loser) throw new Error("Could not map player IDs to user profiles.");

    const ratingWinner = winner.duelRating || 1200;
    const ratingLoser = loser.duelRating || 1200;

    const expectedWinner = getExpectedScore(ratingWinner, ratingLoser);
    const expectedLoser = getExpectedScore(ratingLoser, ratingWinner);

    const newRatingWinner = Math.round(ratingWinner + K_FACTOR * (1 - expectedWinner));
    const newRatingLoser = Math.round(ratingLoser + K_FACTOR * (0 - expectedLoser));

    const winnerDelta = newRatingWinner - ratingWinner;
    const loserDelta = newRatingLoser - ratingLoser;

    await prisma.$transaction([
      // Apply Winner Upside
      prisma.user.update({
        where: { id: winnerId },
        data: { duelRating: newRatingWinner, coins: { increment: 100 } }
      }),
      prisma.ratingHistory.create({
        data: { userId: winnerId, eventType: 'DUEL', oldRating: ratingWinner, newRating: newRatingWinner, delta: winnerDelta, reason: 'Won 1v1 Duel', duelId: duelId }
      }),
      prisma.notification.create({
        data: { userId: winnerId, title: "Duel Victory! 🏆", message: `You crushed it! Duel Rating: ${newRatingWinner} (+${winnerDelta}). Earned 100 coins.`, type: "SUCCESS", link: "/duel" }
      }),

      // Apply Loser Deduction
      prisma.user.update({
        where: { id: loserId },
        data: { duelRating: newRatingLoser }
      }),
      prisma.ratingHistory.create({
        data: { userId: loserId, eventType: 'DUEL', oldRating: ratingLoser, newRating: newRatingLoser, delta: loserDelta, reason: 'Lost 1v1 Duel', duelId: duelId }
      }),
      prisma.notification.create({
        data: { userId: loserId, title: "Duel Defeat ⚔️", message: `You were bested. Duel Rating dropped to ${newRatingLoser} (${loserDelta}). Keep practicing!`, type: "WARNING", link: "/duel" }
      })
    ]);

    return {
      winner: { old: ratingWinner, new: newRatingWinner, delta: winnerDelta },
      loser: { old: ratingLoser, new: newRatingLoser, delta: loserDelta }
    };

  } catch (error) {
    console.error("[Duel Elo Engine] Failed transaction:", error);
    throw new Error("Failed to process Elo updates.");
  }
}