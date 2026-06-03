import { Job, Worker } from 'bullmq';
import { Server } from 'socket.io';
import { syncCodeforcesContest } from '../modules/external-sync/codeforcesSyncService';
import { judgeQueuedSubmission } from '../modules/judge/judge0Service';
import { processContestRewards } from '../modules/ratings/ratingService';
import { CodeforcesContestSyncJob, JudgeSubmissionJob, ContestRewardsJob, QUEUE_NAMES } from '../queues/jobTypes';
import { getSharedRedisConnection } from '../queues/redis';

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

  // 👉 UPDATED: Tell the frontend to fetch the new submission instantly
  if (io && result.submission.contestId && result.standings) {
    io.to(result.submission.contestId).emit('submissionsUpdated');
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

  // 👉 UPDATED: When background sync finishes, force the frontend to refresh the board!
  if (io && result.standings) {
    io.to(job.data.contestId).emit('submissionsUpdated');
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

  judgeWorker.on('failed', (job, err) => console.error(`Judge failed: ${job?.id}`, err));
  externalSyncWorker.on('failed', (job, err) => console.error(`Sync failed: ${job?.id}`, err));
  rewardsWorker.on('failed', (job, err) => console.error(`Rewards failed: ${job?.id}`, err));

  startedWorkers = { judgeWorker, externalSyncWorker, rewardsWorker };
  console.log('BullMQ workers initialized successfully.');
  return startedWorkers;
}