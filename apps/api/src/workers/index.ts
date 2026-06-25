import { Job, Worker } from 'bullmq';
import { Server } from 'socket.io';
import { syncCodeforcesContest } from '../modules/external-sync/codeforcesSyncService';
import { judgeQueuedSubmission } from '../modules/judge/judge0Service';
import { processContestRewards } from '../modules/ratings/ratingService';
import { endContestV2 } from '../modules/contests/contestService';
import { CodeforcesContestSyncJob, JudgeSubmissionJob, ContestRewardsJob, PlagiarismCheckJob, QUEUE_NAMES } from '../queues/jobTypes';
import { getSharedRedisConnection } from '../queues/redis';
import { startCronJobs, enqueuePlagiarismCheck } from '../queues/queues';
import { prisma } from '../prisma/client';
import { ContestStatus } from '@prisma/client';
// apps/api/src/workers/index.ts

import { 
  normalizeCodeForAST as normalize, 
  calculateStructuralSimilarity as calculateSimilarity 
} from '../utils/plagiarism';

type WorkerBundle = {
  judgeWorker: Worker<JudgeSubmissionJob>;
  externalSyncWorker: Worker<CodeforcesContestSyncJob>;
  rewardsWorker: Worker<ContestRewardsJob>;
  autoFinalizeWorker: Worker;
  plagiarismWorker: Worker<PlagiarismCheckJob>; 
};

let startedWorkers: WorkerBundle | null = null;
let activeIoInstance: Server | null = null;

function shouldStartWorkers() {
  return process.env.ENABLE_API_WORKERS === 'true';
}

// ==========================================
// 👉 Structural Plagiarism Math Engine
// ==========================================
function normalizeCodeForAST(code: string) {
  return code
    .replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '') // Strip comments
    .replace(/".*?"|'.*?'/g, '"STR"')        // Normalize strings to prevent string-bypass
    .replace(/\b\d+\b/g, 'NUM')              // Normalize specific numbers
    .replace(/\s+/g, '')                     // Erase all whitespace/formatting
    .trim();
}

function calculateStructuralSimilarity(s1: string, s2: string): number {
  const getNGrams = (s: string, n: number) => {
    const grams = new Set<string>();
    for (let i = 0; i <= s.length - n; i++) grams.add(s.substring(i, i + n));
    return grams;
  };
  
  const set1 = getNGrams(s1, 3); // 3-gram sets
  const set2 = getNGrams(s2, 3);
  if (set1.size === 0 && set2.size === 0) return 1;
  
  let intersection = 0;
  set1.forEach(g => { if (set2.has(g)) intersection++; });
  const union = set1.size + set2.size - intersection;
  return intersection / union;
}
// ==========================================

async function handlePlagiarismJob(job: Job<PlagiarismCheckJob>) {
  const targetSub = await prisma.submission.findUnique({
    where: { id: job.data.submissionId },
    select: { id: true, code: true, contestProblemId: true, userId: true, isPlagiarized: true }
  });

  if (!targetSub || !targetSub.code || targetSub.isPlagiarized) return;

  // Fetch past successful submissions for the exact same problem
  const historicalSubmissions = await prisma.submission.findMany({
    where: { 
      contestProblemId: targetSub.contestProblemId,
      verdict: 'ACCEPTED',
      userId: { not: targetSub.userId } // Don't flag them against their own past code
    },
    select: { id: true, code: true, userId: true },
    orderBy: { createdAt: 'desc' },
    take: 50 // Limit to last 50 successful subs to save CPU
  });

  const normalizedTarget = normalizeCodeForAST(targetSub.code);
  let highestSimilarity = 0;
  let matchedSubId = null;

  for (const hist of historicalSubmissions) {
    if (!hist.code) continue;
    const similarity = calculateStructuralSimilarity(normalizedTarget, normalizeCodeForAST(hist.code));
    if (similarity > highestSimilarity) {
      highestSimilarity = similarity;
      matchedSubId = hist.id;
    }
  }

  // 85% Structural Match = Highly Suspicious
  if (highestSimilarity > 0.85) {
    // 👉 FIXED: Safely updating the Submission flag without querying a non-existent Report model
    await prisma.submission.update({
      where: { id: targetSub.id },
      data: { isPlagiarized: true }
    });
    
    console.log(`🚨 [Plagiarism] Submission ${targetSub.id} flagged with ${Math.round(highestSimilarity * 100)}% match.`);
  }
}

async function handleJudgeJob(job: Job<JudgeSubmissionJob>) {
  const result = await judgeQueuedSubmission(job.data.submissionId);
  const io = activeIoInstance;

  if (io && result.submission.contestId && result.standings) {
    io.to(`contest:${result.submission.contestId}`).emit('standings:update', {
      contestId: result.submission.contestId,
      standings: result.standings
    });
  }

  if (io) {
    io.to(`submission:${result.submission.id}`).emit('submission:judged', result.submission);
  }

  // If they pass the code execution, asynchronously verify they didn't cheat!
  if (result.submission.verdict === 'ACCEPTED') {
    await enqueuePlagiarismCheck(result.submission.id);
  }

  return {
    submissionId: result.submission.id,
    contestId: result.submission.contestId,
    verdict: result.submission.verdict
  };
}

async function handleCodeforcesSyncJob(job: Job<CodeforcesContestSyncJob>) {
  const result = await syncCodeforcesContest(job.data.contestId);
  const io = activeIoInstance;

  if (io && result.standings) {
    io.to(`contest:${job.data.contestId}`).emit('standings:update', {
      contestId: job.data.contestId,
      standings: result.standings
    });
  }

  return {
    contestId: job.data.contestId,
    synced: result.synced.length,
    errors: result.errors.length
  };
}

async function handleRewardsJob(job: Job<ContestRewardsJob>) {
  const result = await processContestRewards(job.data.contestId);
  return result;
}

async function handleAutoFinalizeJob(job: Job) {
  if (job.name === 'check-expired-contests') {
    const expiredContests = await prisma.contest.findMany({
      where: { status: ContestStatus.RUNNING, endTime: { lte: new Date() } },
      select: { id: true }
    });
    
    for (const contest of expiredContests) {
      try {
        await endContestV2(contest.id, 'SYSTEM_CRON');
        
        if (activeIoInstance) {
          activeIoInstance.to(`contest:${contest.id}`).emit('standings:update', { contestId: contest.id });
        }
        console.log(`[Cron] Auto-finalized contest ${contest.id}`);
      } catch (err: any) {
        console.error(`[Cron] Failed to auto-finalize contest ${contest.id}:`, err.message);
      }
    }
  }
}

export function startQueueWorkers(io?: Server) {
  if (io) activeIoInstance = io;

  if (!shouldStartWorkers()) {
    console.log('[Workers] Set ENABLE_API_WORKERS=true to start queue workers.');
    return null;
  }
  
  if (startedWorkers) return startedWorkers;

  const sharedConnection = getSharedRedisConnection();

  const judgeWorker = new Worker<JudgeSubmissionJob>(QUEUE_NAMES.judge, handleJudgeJob, {
    connection: sharedConnection,
    concurrency: Math.max(1, Number(process.env.JUDGE_WORKER_CONCURRENCY || 2)),
    drainDelay: 5000 
  });

  const externalSyncWorker = new Worker<CodeforcesContestSyncJob>(QUEUE_NAMES.externalSync, handleCodeforcesSyncJob, {
    connection: sharedConnection,
    concurrency: Math.max(1, Number(process.env.EXTERNAL_SYNC_WORKER_CONCURRENCY || 2)),
    drainDelay: 5000 
  });

  const rewardsWorker = new Worker<ContestRewardsJob>(QUEUE_NAMES.contestRewards, handleRewardsJob, {
    connection: sharedConnection,
    concurrency: 1, 
    drainDelay: 5000 
  });

  startCronJobs();
  const autoFinalizeWorker = new Worker('auto-finalize', handleAutoFinalizeJob, { 
    connection: sharedConnection 
  });

  // Plagiarism Worker initialized
  const plagiarismWorker = new Worker<PlagiarismCheckJob>(QUEUE_NAMES.plagiarismCheck, handlePlagiarismJob, {
    connection: sharedConnection,
    concurrency: 1, // CPU bound task, keep concurrency low to avoid blocking Event Loop
    drainDelay: 5000
  });

  judgeWorker.on('failed', (job, err) => console.error(`Judge failed: ${job?.id}`, err));
  externalSyncWorker.on('failed', (job, err) => console.error(`Sync failed: ${job?.id}`, err));
  rewardsWorker.on('failed', (job, err) => console.error(`Rewards failed: ${job?.id}`, err));
  autoFinalizeWorker.on('failed', (job, err) => console.error(`Auto-finalize failed: ${job?.id}`, err));
  plagiarismWorker.on('failed', (job, err) => console.error(`Plagiarism worker failed: ${job?.id}`, err));

  startedWorkers = { judgeWorker, externalSyncWorker, rewardsWorker, autoFinalizeWorker, plagiarismWorker };
  console.log('BullMQ workers initialized successfully (Plagiarism Engine Active).');
  return startedWorkers;
}