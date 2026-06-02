import { Job, Worker } from 'bullmq';
import { Server } from 'socket.io';
import { syncCodeforcesContest } from '../modules/external-sync/codeforcesSyncService';
import { judgeQueuedSubmission } from '../modules/judge/judge0Service';
import { processContestRewards } from '../modules/ratings/ratingService';
import { CodeforcesContestSyncJob, JudgeSubmissionJob, ContestRewardsJob, QUEUE_NAMES } from '../queues/jobTypes';
import { createRedisConnection } from '../queues/redis';

type WorkerBundle = {
  judgeWorker: Worker<JudgeSubmissionJob>;
  externalSyncWorker: Worker<CodeforcesContestSyncJob>;
  rewardsWorker: Worker<ContestRewardsJob>;
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
    console.log(`[Socket] Emitting judge standings update for contest: ${result.submission.contestId}`);
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
    console.log(`[Socket] Broadcasting automated live standings to room: contest:${job.data.contestId}`);
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
  console.log(`[Worker] Processing rewards for contest: ${job.data.contestId}`);
  const result = await processContestRewards(job.data.contestId);
  
  if (result) {
    console.log(`[Worker] Rewards processed for ${result.processedCount} users.`);
  } else {
    console.log(`[Worker] Rewards skipped (unrated or insufficient players).`);
  }
  
  return result;
}

export function startQueueWorkers(io?: Server) {
  if (io) {
    activeIoInstance = io;
  }

  if (!shouldStartWorkers()) {
    console.log('[Workers] Set ENABLE_API_WORKERS=true to start queue workers.');
    return null;
  }
  
  if (startedWorkers) return startedWorkers;

  const judgeWorker = new Worker<JudgeSubmissionJob>(
    QUEUE_NAMES.judge,
    handleJudgeJob,
    {
      connection: createRedisConnection(),
      concurrency: Math.max(1, Number(process.env.JUDGE_WORKER_CONCURRENCY || 2)),
      drainDelay: 5000 
    }
  );

  const externalSyncWorker = new Worker<CodeforcesContestSyncJob>(
    QUEUE_NAMES.externalSync,
    handleCodeforcesSyncJob,
    {
      connection: createRedisConnection(),
      concurrency: Math.max(1, Number(process.env.EXTERNAL_SYNC_WORKER_CONCURRENCY || 2)),
      drainDelay: 5000 
    }
  );

  const rewardsWorker = new Worker<ContestRewardsJob>(
    QUEUE_NAMES.contestRewards,
    handleRewardsJob,
    {
      connection: createRedisConnection(),
      concurrency: 1, 
      drainDelay: 5000 
    }
  );

  judgeWorker.on('failed', (job, error) => {
    console.error(`Judge job failed: ${job?.id || 'unknown'}`, error.message);
  });

  externalSyncWorker.on('failed', (job, error) => {
    console.error(`External sync job failed: ${job?.id || 'unknown'}`, error.message);
  });

  rewardsWorker.on('failed', (job, error) => {
    console.error(`Rewards job failed: ${job?.id || 'unknown'}`, error.message);
  });

  startedWorkers = { judgeWorker, externalSyncWorker, rewardsWorker };
  console.log('BullMQ workers initialized successfully for judge, sync, and rewards queues.');
  return startedWorkers;
}