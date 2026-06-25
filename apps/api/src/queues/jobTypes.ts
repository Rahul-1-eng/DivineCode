export const QUEUE_NAMES = {
  judge: 'judge',
  externalSync: 'external-sync',
  contestRewards: 'contest-rewards',
  plagiarismCheck: 'plagiarism-check' // 👉 ADDED: New Queue
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

// 👉 ADDED: Plagiarism Payload Type
export type PlagiarismCheckJob = {
  submissionId: string;
};