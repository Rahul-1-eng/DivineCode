// apps/api/src/workers/index.ts
import { Job, Worker } from 'bullmq';
import { Server } from 'socket.io';
import { syncCodeforcesContest } from '../modules/external-sync/codeforcesSyncService';
import { judgeQueuedSubmission } from '../modules/judge/judge0Service';
import { processContestRewards } from '../modules/ratings/ratingService';
import { endContestV2 } from '../modules/contests/contestService';
import { CodeforcesContestSyncJob, JudgeSubmissionJob, ContestRewardsJob, QUEUE_NAMES } from '../queues/jobTypes';
import { getSharedRedisConnection } from '../queues/redis';
import { startCronJobs } from '../queues/queues';
import { prisma } from '../prisma/client';
import { ContestStatus } from '@prisma/client';

type WorkerBundle = {
  judgeWorker: Worker<JudgeSubmissionJob>;
  externalSyncWorker: Worker<CodeforcesContestSyncJob>;
  rewardsWorker: Worker<ContestRewardsJob>;
  autoFinalizeWorker: Worker;
};

let startedWorkers: WorkerBundle | null = null;
let activeIoInstance: Server | null = null;

function shouldStartWorkers() {
  return process.env.ENABLE_API_WORKERS === 'true';
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
        // Enforce Single Source of Truth: Use the service method to handle the transaction, audit log, standings, and rewards securely
        await endContestV2(contest.id, 'SYSTEM_CRON');
        
        if (activeIoInstance) {
          activeIoInstance.to(`contest:${contest.id}`).emit('standings:update', { contestId: contest.id });
        }
        console.log(`[Cron] Auto-finalized contest ${contest.id}`);
      } catch (err: any) {
        // Failure Resilience: Prevent one toxic contest state from freezing the entire cron batch
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

  // Extract cron handling to standard named worker pattern
  startCronJobs();
  const autoFinalizeWorker = new Worker('auto-finalize', handleAutoFinalizeJob, { 
    connection: sharedConnection 
  });

  judgeWorker.on('failed', (job, err) => console.error(`Judge failed: ${job?.id}`, err));
  externalSyncWorker.on('failed', (job, err) => console.error(`Sync failed: ${job?.id}`, err));
  rewardsWorker.on('failed', (job, err) => console.error(`Rewards failed: ${job?.id}`, err));
  autoFinalizeWorker.on('failed', (job, err) => console.error(`Auto-finalize failed: ${job?.id}`, err));

  startedWorkers = { judgeWorker, externalSyncWorker, rewardsWorker, autoFinalizeWorker };
  console.log('BullMQ workers initialized successfully.');
  return startedWorkers;
}