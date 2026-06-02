import { Queue } from 'bullmq';
import { CodeforcesContestSyncJob, JudgeSubmissionJob, QUEUE_NAMES } from './jobTypes';
import { getSharedRedisConnection } from './redis';

let judgeQueue: Queue<JudgeSubmissionJob> | null = null;
let externalSyncQueue: Queue<CodeforcesContestSyncJob> | null = null;
let rewardsQueue: Queue | null = null;

export function getJudgeQueue() {
  if (!judgeQueue) {
    judgeQueue = new Queue<JudgeSubmissionJob>(QUEUE_NAMES.judge, {
      connection: getSharedRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 3000
        },
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
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 1000,
        removeOnFail: 5000
      }
    });
  }
  return externalSyncQueue;
}

// 🛠️ FIX: Lazy-load the rewards queue using the shared connection to stop Upstash leak
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

export async function enqueueJudgeSubmission(submissionId: string) {
  const job = await getJudgeQueue().add('judge-submission', { submissionId }, { jobId: `judge:${submissionId}` });
  return {
    id: String(job.id),
    name: job.name,
    queue: QUEUE_NAMES.judge
  };
}

export async function enqueueCodeforcesContestSync(contestId: string) {
  const job = await getExternalSyncQueue().add('sync-codeforces-contest', { contestId });
  return {
    id: String(job.id),
    name: job.name,
    queue: QUEUE_NAMES.externalSync
  };
}