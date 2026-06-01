import { SubmissionSource, SubmissionStatus, Verdict, ContestStatus } from '@prisma/client';
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

    // 👉 NEW: Identify the freeze time boundary
    const freezeTime = contest.freezeTime ? new Date(contest.freezeTime).getTime() : null;

    const teamState = new Map<string, Map<string, { 
      wrongAttempts: number, 
      acceptedAt?: Date, 
      manualPoints: number | null,
      isFrozen: boolean // 👉 TRACK IF A SOLVE HAPPENED AFTER FREEZE
    }>>();

    for (const submission of contest.submissions) {
      if (!submission.teamId || !submission.contestProblemId) continue;
      if (!isCountableSubmission(contest, submission)) continue;

      if (!teamState.has(submission.teamId)) {
        teamState.set(submission.teamId, new Map());
      }
      
      const problemMap = teamState.get(submission.teamId)!;
      const problemId = String(submission.contestProblemId);
      const state = problemMap.get(problemId) || { wrongAttempts: 0, manualPoints: null, isFrozen: false };

      // 👉 NEW: Check if this submission is in the "Frozen" zone
      const submissionTime = new Date(submission.createdAt).getTime();
      const isSubmissionFrozen = freezeTime !== null && submissionTime > freezeTime;

      // Logic: If already solved, ignore further
      if (state.acceptedAt && submission.manualPoints === null) {
        continue;
      }

      if (submission.verdict === Verdict.ACCEPTED && submission.status === SubmissionStatus.FINISHED) {
        state.acceptedAt = submission.createdAt;
        state.isFrozen = isSubmissionFrozen; // Flag if this specific solve was frozen
      } else if (isWrongAttempt(submission)) {
        // Only count wrong attempts before freeze time for penalty
        if (!isSubmissionFrozen) {
          state.wrongAttempts += 1;
        }
      }

      if (submission.manualPoints !== null) {
         state.manualPoints = submission.manualPoints;
      }

      problemMap.set(problemId, state);
    }

    const standingRows = contest.participants.map((participant) => {
      if (!participant.teamId || !teamState.has(participant.teamId)) {
        return { participantId: participant.id, contestId, rank: 0, solved: 0, penalty: 0, score: 0, solvedProblemIds: [], lastAcceptedAt: null };
      }
      
      const problemMap = teamState.get(participant.teamId)!;
      
      // 👉 Logic: If the solve is frozen, it doesn't count towards the public 'solved' count or rank
      const solvedEntries = [...problemMap.entries()].filter(([, state]) => state.acceptedAt && !state.isFrozen);
      
      const penalty = solvedEntries.reduce((sum, [, state]) => {
        return sum + acceptedMinute(contest, state.acceptedAt!) + (state.wrongAttempts * PENALTY_PER_WRONG_ATTEMPT);
      }, 0);

      const totalScore = solvedEntries.reduce((sum, [, state]) => {
        return sum + (state.manualPoints !== null ? state.manualPoints : 1000);
      }, 0) - penalty;

      return {
        participantId: participant.id,
        contestId,
        rank: 0,
        solved: solvedEntries.length,
        penalty,
        score: totalScore,
        solvedProblemIds: solvedEntries.map(([id]) => id),
        lastAcceptedAt: solvedEntries.length > 0 
          ? solvedEntries.map(([, state]) => state.acceptedAt!).sort((a, b) => b.getTime() - a.getTime())[0] 
          : null
      };
    });

    standingRows.sort((a, b) => b.solved - a.solved || a.penalty - b.penalty || a.participantId.localeCompare(b.participantId));

    let currentRank = 0;
    let lastScoreKey = '';
    standingRows.forEach((row, index) => {
      const scoreKey = `${row.solved}:${row.penalty}`;
      if (scoreKey !== lastScoreKey) currentRank = index + 1;
      row.rank = currentRank;
      lastScoreKey = scoreKey;
    });

    for (const row of standingRows) {
      await tx.contestStanding.upsert({
        where: { participantId: row.participantId },
        create: row,
        update: { rank: row.rank, solved: row.solved, penalty: row.penalty, score: row.score, solvedProblemIds: row.solvedProblemIds, lastAcceptedAt: row.lastAcceptedAt }
      });
    }

    return standingRows;
  });
}