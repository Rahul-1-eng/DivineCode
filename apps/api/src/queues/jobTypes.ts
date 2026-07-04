/**
 * @file jobTypes.ts
 * @author Rahul Kumar Sahoo
 * @description Application source for the DivineCode platform.
 */

export const QUEUE_NAMES = {
  judge: 'judge',
  externalSync: 'external-sync',
  contestRewards: 'contest-rewards',
  plagiarismCheck: 'plagiarism-check' // New Queue
};

export type JudgeSubmissionJob = {
  submissionId: string;
};

export type CodeforcesContestSyncJob = {
  contestId: string;
};

export type ContestRewardsJob = {
  contestId: string;
};

// Plagiarism Payload Type
export type PlagiarismCheckJob = {
  submissionId: string;
};