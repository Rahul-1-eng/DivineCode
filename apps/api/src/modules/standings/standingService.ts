import { SubmissionStatus, Verdict } from '@prisma/client';
import { prisma } from '../../prisma/client';

const PENALTY_PER_WRONG_ATTEMPT = 20;

function isCountableSubmission(contest: any, submission: any) {
  if (!submission.participantId || !submission.contestProblemId) return false;
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
        submissions: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!contest) throw new Error('Contest not found');

    const problemIds = new Set(contest.problems.map((problem) => problem.id));
    const rows = contest.participants.map((participant) => {
      const stateByProblem = new Map<string, { wrongAttempts: number; acceptedAt?: Date }>();

      for (const submission of contest.submissions) {
        if (submission.participantId !== participant.id) continue;
        if (!problemIds.has(String(submission.contestProblemId))) continue;
        if (!isCountableSubmission(contest, submission)) continue;

        const problemState =
          stateByProblem.get(String(submission.contestProblemId)) || { wrongAttempts: 0 };

        if (problemState.acceptedAt) {
          stateByProblem.set(String(submission.contestProblemId), problemState);
          continue;
        }

        if (submission.verdict === Verdict.ACCEPTED && submission.status === SubmissionStatus.FINISHED) {
          problemState.acceptedAt = submission.createdAt;
        } else if (isWrongAttempt(submission)) {
          problemState.wrongAttempts += 1;
        }

        stateByProblem.set(String(submission.contestProblemId), problemState);
      }

      const solvedEntries = [...stateByProblem.entries()].filter(([, state]) => state.acceptedAt);
      const penalty = solvedEntries.reduce((sum, [, state]) => {
        return (
          sum +
          acceptedMinute(contest, state.acceptedAt!) +
          state.wrongAttempts * PENALTY_PER_WRONG_ATTEMPT
        );
      }, 0);

      return {
        participantId: participant.id,
        contestId,
        rank: 0,
        solved: solvedEntries.length,
        penalty,
        score: solvedEntries.length * 1000 - penalty,
        solvedProblemIds: solvedEntries.map(([contestProblemId]) => contestProblemId),
        lastAcceptedAt: solvedEntries
          .map(([, state]) => state.acceptedAt!)
          .sort((a, b) => b.getTime() - a.getTime())[0]
      };
    });

    rows.sort((a, b) => b.solved - a.solved || a.penalty - b.penalty || a.participantId.localeCompare(b.participantId));

    let currentRank = 0;
    let lastScoreKey = '';
    rows.forEach((row, index) => {
      const scoreKey = `${row.solved}:${row.penalty}`;
      if (scoreKey !== lastScoreKey) currentRank = index + 1;
      row.rank = currentRank;
      lastScoreKey = scoreKey;
    });

    for (const row of rows) {
      await tx.contestStanding.upsert({
        where: { participantId: row.participantId },
        create: row,
        update: {
          rank: row.rank,
          solved: row.solved,
          penalty: row.penalty,
          score: row.score,
          solvedProblemIds: row.solvedProblemIds,
          lastAcceptedAt: row.lastAcceptedAt || null
        }
      });
    }

    return rows;
  });
}
