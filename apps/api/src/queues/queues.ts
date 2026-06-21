import { Queue } from 'bullmq';
import { CodeforcesContestSyncJob, JudgeSubmissionJob, QUEUE_NAMES } from './jobTypes';
import { getSharedRedisConnection } from './redis';

let judgeQueue: Queue<JudgeSubmissionJob> | null = null;
let externalSyncQueue: Queue<CodeforcesContestSyncJob> | null = null;
let rewardsQueue: Queue | null = null;
let autoFinalizeQueue: Queue | null = null; // 👉 FIX 1.6: Added Auto-Finalize Queue

export function getJudgeQueue() {
  if (!judgeQueue) {
    judgeQueue = new Queue<JudgeSubmissionJob>(QUEUE_NAMES.judge, {
      connection: getSharedRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: 1000,
        removeOnFail: 5000
      }
    });
  }
  return judgeQueue;
}

export function getExternalSyncQueue() {
  if (!externalSyncQueue) {
    externalSyncQueue = new Queue<CodeforcesContestSyncJob>(QUEUE_NAMES.externalSync, {
      connection: getSharedRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000
      }
    });
  }
  return externalSyncQueue;
}

export function getRewardsQueue() {
  if (!rewardsQueue) {
    rewardsQueue = new Queue(QUEUE_NAMES.contestRewards, {
      connection: getSharedRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
      }
    });
  }
  return rewardsQueue;
}

// 👉 FIX 1.6: Initialize the Cron Queue
export function getAutoFinalizeQueue() {
  if (!autoFinalizeQueue) {
    autoFinalizeQueue = new Queue('auto-finalize', {
      connection: getSharedRedisConnection(),
      defaultJobOptions: { removeOnComplete: true }
    });
  }
  return autoFinalizeQueue;
}

// 👉 FIX 1.6: Schedule the repeatable job to run every 1 minute
export async function startCronJobs() {
  const queue = getAutoFinalizeQueue();
  await queue.add('check-expired-contests', {}, {
    repeat: { pattern: '* * * * *' }, // Every minute
    jobId: 'cron-check-expired-contests' // Enforces uniqueness
  });
  console.log('⏱️ Auto-finalize cron job scheduled.');
}

export async function enqueueJudgeSubmission(submissionId: string) {
  const job = await getJudgeQueue().add('judge-submission', { submissionId }, { jobId: `judge:${submissionId}` });
  return { id: String(job.id), name: job.name, queue: QUEUE_NAMES.judge };
}

export async function enqueueCodeforcesContestSync(contestId: string) {
  const job = await getExternalSyncQueue().add('sync-codeforces-contest', { contestId });
  return { id: String(job.id), name: job.name, queue: QUEUE_NAMES.externalSync };
}