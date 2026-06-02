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
        participants: { include: { standing: true } },
        problems: true,
        submissions: { orderBy: { createdAt: 'asc' } }
      }
    });

    if (!contest) throw new Error('Contest not found');

    const freezeTime = contest.freezeTime ? new Date(contest.freezeTime).getTime() : null;

    // Track Team State (for shared group score)
    const teamState = new Map<string, Map<string, { wrongAttempts: number, acceptedAt?: Date, manualPoints: number | null, isFrozen: boolean }>>();
    // 👉 FIX: Track Individual State (for personal leaderboard)
    const individualState = new Map<string, Map<string, { acceptedAt?: Date, manualPoints: number | null }>>();

    for (const submission of contest.submissions) {
      if (!submission.teamId || !submission.contestProblemId) continue;
      if (!isCountableSubmission(contest, submission)) continue;

      const problemId = String(submission.contestProblemId);
      const submissionTime = new Date(submission.createdAt).getTime();
      const isSubmissionFrozen = freezeTime !== null && submissionTime > freezeTime;
      const isAccepted = submission.verdict === Verdict.ACCEPTED && submission.status === SubmissionStatus.FINISHED;

      // --- TEAM LOGIC ---
      if (!teamState.has(submission.teamId)) teamState.set(submission.teamId, new Map());
      const tMap = teamState.get(submission.teamId)!;
      const tState = tMap.get(problemId) || { wrongAttempts: 0, manualPoints: null, isFrozen: false };
      
      if (!tState.acceptedAt || submission.manualPoints !== null) {
        if (isAccepted) { tState.acceptedAt = submission.createdAt; tState.isFrozen = isSubmissionFrozen; }
        else if (isWrongAttempt(submission) && !isSubmissionFrozen) tState.wrongAttempts += 1;
        if (submission.manualPoints !== null) tState.manualPoints = submission.manualPoints;
        tMap.set(problemId, tState);
      }

      // --- INDIVIDUAL LOGIC ---
      if (!submission.participantId) continue;
      if (!individualState.has(submission.participantId)) individualState.set(submission.participantId, new Map());
      const iMap = individualState.get(submission.participantId)!;
      const iState = iMap.get(problemId) || { manualPoints: null };
      
      if (!iState.acceptedAt || submission.manualPoints !== null) {
        if (isAccepted) iState.acceptedAt = submission.createdAt;
        if (submission.manualPoints !== null) iState.manualPoints = submission.manualPoints;
        iMap.set(problemId, iState);
      }
    }

    const standingRows = contest.participants.map((participant) => {
      // Team calculation
      const tMap = participant.teamId && teamState.has(participant.teamId) ? teamState.get(participant.teamId)! : new Map();
      const solvedEntries = [...tMap.entries()].filter(([, state]) => state.acceptedAt && !state.isFrozen);
      
      let teamPenalty = solvedEntries.reduce((sum, [, state]) => sum + acceptedMinute(contest, state.acceptedAt!) + (state.wrongAttempts * PENALTY_PER_WRONG_ATTEMPT), 0);
      
      // 👉 FIX: Add Testcase penalty reduction
      const testcasePenalty = participant.standing?.testcasePenalty || 0;
      let teamScore = solvedEntries.reduce((sum, [, state]) => sum + (state.manualPoints !== null ? state.manualPoints : 1000), 0) - teamPenalty - testcasePenalty;

      // Individual calculation
      const iMap = individualState.has(participant.id) ? individualState.get(participant.id)! : new Map();
      const iSolved = [...iMap.entries()].filter(([, state]) => state.acceptedAt);
      const iScore = iSolved.reduce((sum, [, state]) => sum + (state.manualPoints !== null ? state.manualPoints : 1000), 0) - testcasePenalty;

      return {
        participantId: participant.id,
        contestId,
        rank: 0,
        solved: solvedEntries.length,
        penalty: teamPenalty,
        score: teamScore,
        individualScore: iScore,
        individualSolved: iSolved.length,
        testcasePenalty: testcasePenalty,
        solvedProblemIds: solvedEntries.map(([id]) => id),
        lastAcceptedAt: solvedEntries.length > 0 ? solvedEntries.map(([, state]) => state.acceptedAt!).sort((a, b) => b.getTime() - a.getTime())[0] : null
      };
    });

    standingRows.sort((a, b) => b.score - a.score || a.penalty - b.penalty || a.participantId.localeCompare(b.participantId));

    let currentRank = 0;
    let lastScoreKey = '';
    standingRows.forEach((row, index) => {
      const scoreKey = `${row.score}:${row.penalty}`;
      if (scoreKey !== lastScoreKey) currentRank = index + 1;
      row.rank = currentRank;
      lastScoreKey = scoreKey;
    });

    for (const row of standingRows) {
      await tx.contestStanding.upsert({
        where: { participantId: row.participantId },
        create: row,
        update: { rank: row.rank, solved: row.solved, penalty: row.penalty, score: row.score, individualScore: row.individualScore, individualSolved: row.individualSolved, solvedProblemIds: row.solvedProblemIds, lastAcceptedAt: row.lastAcceptedAt }
      });
    }

    return standingRows;
  });
}