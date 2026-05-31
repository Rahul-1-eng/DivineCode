import { SubmissionStatus, Verdict } from '@prisma/client';
import { prisma } from '../../prisma/client';

const PENALTY_PER_WRONG_ATTEMPT = 20;

function isCountableSubmission(contest: any, submission: any) {
  if (!submission.teamId || !submission.contestProblemId) return false;
  const submittedAt = new Date(submission.createdAt).getTime();
  const startsAt = new Date(contest.startTime).getTime();
  const endsAt = startsAt + contest.durationMinutes * 60000;
  return submittedAt >= startsAt && submittedAt <= endsAt;
}

function acceptedMinute(contest: any, acceptedAt: Date) {
  const diffMs = acceptedAt.getTime() - new Date(contest.startTime).getTime();
  return Math.max(0, Math.floor(diffMs / 60000));
}

function isWrongAttempt(submission: any) {
  if (submission.status !== SubmissionStatus.FINISHED) return false;
  return ![Verdict.ACCEPTED, Verdict.PENDING, Verdict.SKIPPED, Verdict.JUDGE_ERROR].includes(submission.verdict);
}

export async function recomputeContestStandings(contestId: string) {
  return prisma.$transaction(async (tx) => {
    const contest = await tx.contest.findUnique({
      where: { id: contestId },
      include: {
        participants: true,
        problems: true,
        submissions: { orderBy: { createdAt: 'asc' } }
      }
    });

    if (!contest) throw new Error('Contest not found');

    // 1. Group submissions by teamId
    // Map<teamId, Map<contestProblemId, { wrongAttempts: number, acceptedAt?: Date }>>
    const teamState = new Map<string, Map<string, { wrongAttempts: number, acceptedAt?: Date }>>();

    for (const submission of contest.submissions) {
      if (!submission.teamId) continue;
      if (!isCountableSubmission(contest, submission)) continue;

      if (!teamState.has(submission.teamId)) {
        teamState.set(submission.teamId, new Map());
      }
      
      const problemMap = teamState.get(submission.teamId)!;
      const problemId = String(submission.contestProblemId);
      const state = problemMap.get(problemId) || { wrongAttempts: 0 };

      // If already solved, ignore further submissions for this team/problem
      if (state.acceptedAt) continue;

      if (submission.verdict === Verdict.ACCEPTED && submission.status === SubmissionStatus.FINISHED) {
        state.acceptedAt = submission.createdAt;
      } else if (isWrongAttempt(submission)) {
        state.wrongAttempts += 1;
      }

      problemMap.set(problemId, state);
    }

    // 2. Calculate Standings for each participant based on their TEAM's data
    const standingRows = contest.participants.map((participant) => {
      if (!participant.teamId || !teamState.has(participant.teamId)) {
        return { participantId: participant.id, rank: 0, solved: 0, penalty: 0, score: 0, solvedProblemIds: [] as string[] };
      }

      const problemMap = teamState.get(participant.teamId)!;
      const solvedEntries = [...problemMap.entries()].filter(([, state]) => state.acceptedAt);
      
      const penalty = solvedEntries.reduce((sum, [, state]) => {
        return sum + acceptedMinute(contest, state.acceptedAt!) + (state.wrongAttempts * PENALTY_PER_WRONG_ATTEMPT);
      }, 0);

      return {
        participantId: participant.id,
        contestId,
        rank: 0,
        solved: solvedEntries.length,
        penalty,
        score: solvedEntries.length * 1000 - penalty,
        solvedProblemIds: solvedEntries.map(([id]) => id),
        lastAcceptedAt: solvedEntries.map(([, state]) => state.acceptedAt!).sort((a, b) => b.getTime() - a.getTime())[0] || null
      };
    });

    // 3. Sort and Rank (Grouping by team stats)
    standingRows.sort((a, b) => b.solved - a.solved || a.penalty - b.penalty || a.participantId.localeCompare(b.participantId));

    let currentRank = 0;
    let lastScoreKey = '';
    standingRows.forEach((row, index) => {
      const scoreKey = `${row.solved}:${row.penalty}`;
      if (scoreKey !== lastScoreKey) currentRank = index + 1;
      row.rank = currentRank;
      lastScoreKey = scoreKey;
    });

    // 4. Upsert
    for (const row of standingRows) {
      await tx.contestStanding.upsert({
        where: { participantId: row.participantId },
        create: row,
        update: {
          rank: row.rank,
          solved: row.solved,
          penalty: row.penalty,
          score: row.score,
          solvedProblemIds: row.solvedProblemIds,
          lastAcceptedAt: row.lastAcceptedAt
        }
      });
    }

    return standingRows;
  });
}