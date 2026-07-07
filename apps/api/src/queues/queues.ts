/**
 * @file queues.ts
 * @author Rahul Kumar Sahoo
 * @description Application source for the DivineCode platform.
 */

import { Queue } from 'bullmq';
import { CodeforcesContestSyncJob, JudgeSubmissionJob, PlagiarismCheckJob, QUEUE_NAMES } from './jobTypes';
import { getSharedRedisConnection } from './redis';

let judgeQueue: Queue<JudgeSubmissionJob> | null = null;
let externalSyncQueue: Queue<CodeforcesContestSyncJob> | null = null;
let rewardsQueue: Queue | null = null;
let autoFinalizeQueue: Queue | null = null; 
let plagiarismQueue: Queue<PlagiarismCheckJob> | null = null; // ADDED

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

export function getAutoFinalizeQueue() {
  if (!autoFinalizeQueue) {
    autoFinalizeQueue = new Queue('auto-finalize', {
      connection: getSharedRedisConnection(),
      defaultJobOptions: { removeOnComplete: true }
    });
  }
  return autoFinalizeQueue;
}

// The Plagiarism Queue 
export function getPlagiarismQueue() {
  if (!plagiarismQueue) {
    plagiarismQueue = new Queue<PlagiarismCheckJob>(QUEUE_NAMES.plagiarismCheck, {
      connection: getSharedRedisConnection(),
      defaultJobOptions: {
        attempts: 1, // CPU heavy, don't retry immediately on fail
        removeOnComplete: true,
        removeOnFail: 5000
      }
    });
  }
  return plagiarismQueue;
}

export async function startCronJobs() {
  const queue = getAutoFinalizeQueue();
  await queue.add('check-expired-contests', {}, {
    repeat: { pattern: '* * * * *' },
    jobId: 'cron-check-expired-contests'
  });

  // Live Codeforces standings: every 2 minutes, enqueue a sync for every
  // RUNNING contest that has CF problems (keeps standings fresh without
  // anyone pressing the manual Sync button).
  await queue.add('sync-running-cf-contests', {}, {
    repeat: { pattern: '*/2 * * * *' },
    jobId: 'cron-sync-running-cf-contests'
  });

  // Nightly profile refresh: re-pull CF/LC/AtCoder/CodeChef ratings for every
  // user with linked handles. 3:17 AM to stay clear of platform peak load.
  await queue.add('refresh-external-ratings', {}, {
    repeat: { pattern: '17 3 * * *' },
    jobId: 'cron-refresh-external-ratings'
  });

  console.log('⏱️ Cron jobs scheduled: auto-finalize, CF live sync, nightly ratings refresh.');
}

export async function enqueueJudgeSubmission(submissionId: string) {
  const job = await getJudgeQueue().add('judge-submission', { submissionId }, { jobId: `judge:${submissionId}` });
  return { id: String(job.id), name: job.name, queue: QUEUE_NAMES.judge };
}

export async function enqueueCodeforcesContestSync(contestId: string, dedupeKey?: string) {
  // A dedupeKey collapses repeat requests (e.g. cron ticks) into one queued
  // job; BullMQ skips adds whose jobId already exists. Callers pass a
  // time-bucketed key so future syncs are not blocked by completed jobs.
  const job = await getExternalSyncQueue().add(
    'sync-codeforces-contest',
    { contestId },
    dedupeKey ? { jobId: dedupeKey, removeOnComplete: true, removeOnFail: 100 } : undefined
  );
  return { id: String(job.id), name: job.name, queue: QUEUE_NAMES.externalSync };
}

// Enqueue Trigger
export async function enqueuePlagiarismCheck(submissionId: string) {
  const job = await getPlagiarismQueue().add('plagiarism-check', { submissionId });
  return { id: String(job.id), name: job.name, queue: QUEUE_NAMES.plagiarismCheck };
}