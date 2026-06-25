import { SubmissionSource, SubmissionStatus, Verdict, ContestStatus } from '@prisma/client';
import { prisma } from '../../prisma/client';
import { getSharedRedisConnection } from '../../queues/redis';

const redis = getSharedRedisConnection();
const PENALTY_PER_WRONG_ATTEMPT = 50;

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
  return ![Verdict.ACCEPTED, Verdict.PENDING, Verdict.SKIPPED, Verdict.JUDGE_ERROR, Verdict.COMPILATION_ERROR].includes(submission.verdict);
}

export async function recomputeContestStandings(contestId: string) {
 const cacheKey = `contest:standings:${contestId}`;

try {
  const cached = await redis.get(cacheKey);
  if (cached) {
    console.log(`[STANDINGS] Cache hit for contest ${contestId}`);
    return JSON.parse(cached);
  }
} catch (err) {
  console.error('[STANDINGS] Redis read failed:', err);
}

  return prisma.$transaction(async (tx) => {
    const contest = await tx.contest.findUnique({
      where: { id: contestId },
      include: {
        participants: { 
          where: { isOfficial: true },
          include: { standing: true } 
        },
        problems: true,
        submissions: { orderBy: { createdAt: 'asc' } }
      }
    });

    if (!contest) throw new Error('Contest not found');

    const freezeTime = contest.freezeTime ? new Date(contest.freezeTime).getTime() : null;
    const pointsMap = new Map<string, number>();
    contest.problems.forEach(p => pointsMap.set(p.id, p.points));

    const teamState = new Map<string, Map<string, { wrongAttempts: number, acceptedAt?: Date, manualPoints: number | null, isFrozen: boolean }>>();
    const individualState = new Map<string, Map<string, { wrongAttempts: number, acceptedAt?: Date, manualPoints: number | null }>>();

    for (const sub of contest.submissions) {
      if (!sub.teamId || !sub.contestProblemId) continue;
      if (!isCountableSubmission(contest, sub)) continue;

      const pId = String(sub.contestProblemId);
      const submissionTime = new Date(sub.createdAt).getTime();
      const isSubmissionFrozen = freezeTime !== null && submissionTime > freezeTime;
      const isAccepted = (sub.verdict === Verdict.ACCEPTED || String(sub.verdict) === 'OK') && sub.status === SubmissionStatus.FINISHED;

      // --- TEAM LOGIC ---
      if (!teamState.has(sub.teamId)) teamState.set(sub.teamId, new Map());
      const tMap = teamState.get(sub.teamId)!;
      const tState = tMap.get(pId) || { wrongAttempts: 0, acceptedAt: undefined, manualPoints: null, isFrozen: false };
      
     if (!tState.acceptedAt) {
        if (isAccepted && !isSubmissionFrozen) {
    tState.acceptedAt = sub.createdAt;
    tState.isFrozen = false;
}
        else if (isWrongAttempt(sub) && !isSubmissionFrozen) tState.wrongAttempts += 1;
        
        if (sub.manualPoints !== null) tState.manualPoints = sub.manualPoints;
        tMap.set(pId, tState);
      }

      // --- INDIVIDUAL LOGIC ---
      if (!sub.participantId) continue;
      if (!individualState.has(sub.participantId)) individualState.set(sub.participantId, new Map());
      const iMap = individualState.get(sub.participantId)!;
      const iState = iMap.get(pId) || { wrongAttempts: 0, acceptedAt: undefined, manualPoints: null };
      
      if (!iState.acceptedAt) {
        if (isAccepted) { iState.acceptedAt = sub.createdAt; }
        else if (isWrongAttempt(sub) && !isSubmissionFrozen) { iState.wrongAttempts += 1; }
        
        if (sub.manualPoints !== null) iState.manualPoints = sub.manualPoints;
        iMap.set(pId, iState);
      }
    }

    const standingRows = contest.participants.map((participant) => {
      const tMap = participant.teamId && teamState.has(participant.teamId) ? teamState.get(participant.teamId)! : new Map();
      const solvedEntries = [...tMap.entries()].filter(([, state]) => state.acceptedAt && !state.isFrozen);
      
      let teamPenalty = solvedEntries.reduce((sum, [, state]) => sum + acceptedMinute(contest, state.acceptedAt!) + (state.wrongAttempts * PENALTY_PER_WRONG_ATTEMPT), 0);
      const testcasePenalty = participant.standing?.testcasePenalty || 0;
      let teamScore = solvedEntries.reduce((sum, [id, state]) => sum + (state.manualPoints !== null ? state.manualPoints : (pointsMap.get(id) || 1000)), 0) - teamPenalty - testcasePenalty;

      const iMap = individualState.has(participant.id) ? individualState.get(participant.id)! : new Map();
      const iSolved = [...iMap.entries()].filter(([, state]) => state.acceptedAt);
      
      let individualPenalty = iSolved.reduce((sum, [, state]) => sum + acceptedMinute(contest, state.acceptedAt!) + (state.wrongAttempts * PENALTY_PER_WRONG_ATTEMPT), 0);
      const iScore = iSolved.reduce((sum, [id, state]) => sum + (state.manualPoints !== null ? state.manualPoints : (pointsMap.get(id) || 1000)), 0) - individualPenalty - testcasePenalty;

      return {
        participantId: participant.id,
        contestId,
        rank: 0,
        solved: solvedEntries.length,
        penalty: teamPenalty,
        score: teamScore,
        individualScore: iScore,
        individualPenalty,
        individualSolved: iSolved.length,
        testcasePenalty: testcasePenalty,
        solvedProblemIds: solvedEntries.map(([id]) => id),
        lastAcceptedAt: solvedEntries.length > 0 ? solvedEntries.map(([, state]) => state.acceptedAt!).sort((a, b) => b.getTime() - a.getTime())[0] : null
      };
    });

    standingRows.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.penalty !== b.penalty) return a.penalty - b.penalty;
      if (b.individualScore !== a.individualScore) return b.individualScore - a.individualScore;
      if (a.individualPenalty !== b.individualPenalty) return a.individualPenalty - b.individualPenalty;
      return a.participantId.localeCompare(b.participantId);
    });

    let currentRank = 1;
    for (let i = 0; i < standingRows.length; i++) {
      if (i > 0) {
        const prev = standingRows[i - 1];
        const curr = standingRows[i];
        if (curr.score !== prev.score || curr.penalty !== prev.penalty || curr.individualScore !== prev.individualScore || curr.individualPenalty !== prev.individualPenalty) {
          currentRank = i + 1;
        }
      }
      standingRows[i].rank = currentRank;
    }

  await Promise.all(
  standingRows.map(row =>
    tx.contestStanding.upsert({
      where: { participantId: row.participantId },
      create: row,
      update: {
        rank: row.rank,
        solved: row.solved,
        penalty: row.penalty,
        score: row.score,
        individualScore: row.individualScore,
        individualSolved: row.individualSolved,
        individualPenalty: row.individualPenalty,
        testcasePenalty: row.testcasePenalty,
        solvedProblemIds: row.solvedProblemIds,
        lastAcceptedAt: row.lastAcceptedAt
      }
    })
  )
);

    try {
      const cacheKey = `contest:standings:${contestId}`;
      await redis.set(cacheKey, JSON.stringify(standingRows), 'EX', 60);
    } catch (redisErr) {
      console.error("Redis Cache write failed:", redisErr);
    }

    return standingRows;
  });
}