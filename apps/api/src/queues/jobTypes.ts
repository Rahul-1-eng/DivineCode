export const QUEUE_NAMES = {
  judge: 'judge',
  externalSync: 'external-sync',
  contestRewards: 'contest-rewards' // <--- ADD THIS
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