export const QUEUE_NAMES = {
  judge: 'divinecode-judge',
  externalSync: 'divinecode-external-sync'
} as const;

export type JudgeSubmissionJob = {
  submissionId: string;
};

export type CodeforcesContestSyncJob = {
  contestId: string;
};