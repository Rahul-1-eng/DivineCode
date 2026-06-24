import { RatingEventType, SubmissionStatus } from '@prisma/client';
import { prisma } from '../../prisma/client';

const K_FACTOR = 32;
const COINS_PER_PERSONAL_SOLVE = 50;
const COINS_PER_GROUP_SOLVE = 20;
const BASE_PARTICIPATION_COINS = 10;

// ==========================================
// 1. CONTEST REWARDS & RATING LOGIC
// ==========================================
export async function processContestRewards(contestId: string) {
  console.log(`[REWARD ENGINE] Starting reward processing for contest: ${contestId}`);

  return prisma.$transaction(async (tx) => {
    const contest = await tx.contest.findUnique({
      where: { id: contestId },
      include: {
        participants: { include: { user: true, standing: true } },
        submissions: true
      }
    });

    if (!contest) {
      console.error(`[REWARD ENGINE] Contest ${contestId} not found!`);
      return null;
    }

    const participants = contest.participants.filter(p => p.user);
    console.log(`[REWARD ENGINE] Found ${participants.length} participants to process.`);
    
    if (participants.length === 0) return null; 

    for (const pA of participants) {
      if (!pA.user) {
        console.warn(`[REWARD ENGINE] Skipping participant ${pA.id}: No user attached.`);
        continue;
      }

      // 1. Calculate Stats
      const groupSolves = pA.standing?.solved || 0;
      const rank = pA.standing?.rank || participants.length;

      const personalSolves = new Set(
        contest.submissions
          .filter(s => s.participantId === pA.id && s.status === SubmissionStatus.FINISHED && (String(s.verdict).includes('ACCEPT') || String(s.verdict) === 'OK'))
          .map(s => s.contestProblemId)
      ).size;

      // 2. Process Coins
      let rankBonus = 0;
      if (rank === 1) rankBonus = 150;
      else if (rank === 2) rankBonus = 100;
      else if (rank === 3) rankBonus = 50;

      let earnedCoins = BASE_PARTICIPATION_COINS + rankBonus + (personalSolves * COINS_PER_PERSONAL_SOLVE) + (groupSolves * COINS_PER_GROUP_SOLVE);
      if (personalSolves === 0 && groupSolves === 0) {
        earnedCoins = -15; 
      }

      console.log(`[REWARD ENGINE] User ${pA.user.username}: Rank ${rank}, Solves ${personalSolves}, Coins ${earnedCoins}`);

      let oldRating = pA.ratingBefore || pA.user.rating || 1200;
      let newRating = oldRating;
      let ratingDelta = 0;

      // 3. Process Elo Rating
      if (contest.isRated && pA.isOfficial) {
        console.log(`[REWARD ENGINE] Processing Elo for ${pA.user.username}...`);
        let expectedWins = 0;
        let actualWins = 0;

        for (const pB of participants) {
          if (pA.id === pB.id || !pB.user || !pB.isOfficial) continue;
          if (pA.teamId && pA.teamId === pB.teamId) continue; 

          const ratingB = pB.ratingBefore || pB.user.rating || 1200;
          expectedWins += 1 / (1 + Math.pow(10, (ratingB - oldRating) / 400));
          const rankB = pB.standing?.rank || participants.length;

          if (rank < rankB) actualWins += 1;
          else if (rank === rankB) actualWins += 0.5;
        }

        const rawDelta = Math.round(K_FACTOR * (actualWins - expectedWins));
        ratingDelta = Math.max(-100, rawDelta);
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
        console.log(`[REWARD ENGINE] Updated Elo for ${pA.user.username}: ${oldRating} -> ${newRating}`);
      } else {
        console.log(`[REWARD ENGINE] Skipping Elo for ${pA.user.username} (Rated: ${contest.isRated}, Official: ${pA.isOfficial})`);
      }

      // 4. Commit DB Updates
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
          title: `Contest Finished!`,
          message: `You earned ${earnedCoins} coins. Your new rating is ${newRating} (${ratingDelta >= 0 ? '+' : ''}${ratingDelta}).`,
          type: "SUCCESS",
          link: `/contests/${contest.id}/final`
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

    console.log(`[REWARD ENGINE] Successfully finished processing rewards.`);
    return { success: true, processedCount: participants.length };
  }, { timeout: 30000 });
}


// ==========================================
// 2. 1v1 DUEL ELO & REWARD LOGIC
// ==========================================

/**
 * Calculates the expected win probability of Player A against Player B.
 */
function getExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Updates the Elo ratings and awards coins for two players after a 1v1 Duel Match.
 */
export async function processDuelEloUpdate(winnerId: string, loserId: string, duelId: string) {
  try {
    const winner = await prisma.user.findUnique({ where: { id: winnerId } });
    const loser = await prisma.user.findUnique({ where: { id: loserId } });

    if (!winner || !loser) throw new Error("Could not find players to update ratings.");

    const ratingWinner = winner.duelRating || 1200;
    const ratingLoser = loser.duelRating || 1200;

    const expectedWinner = getExpectedScore(ratingWinner, ratingLoser);
    const expectedLoser = getExpectedScore(ratingLoser, ratingWinner);

    const newRatingWinner = Math.round(ratingWinner + K_FACTOR * (1 - expectedWinner));
    const newRatingLoser = Math.round(ratingLoser + K_FACTOR * (0 - expectedLoser));

    const winnerDelta = newRatingWinner - ratingWinner;
    const loserDelta = newRatingLoser - ratingLoser;

    await prisma.$transaction([
      // Update Winner
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

      // Update Loser
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
    console.error("[Elo Rating Error]:", error);
    throw new Error("Failed to process Elo updates.");
  }
}