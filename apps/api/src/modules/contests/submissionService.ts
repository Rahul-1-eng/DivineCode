import { SubmissionSource, SubmissionStatus, Verdict } from '@prisma/client';
import { prisma } from '../../prisma/client';
import { findViewerParticipant, ViewerContext } from './contestRules';

export async function createQueuedContestSubmission(input: {
  contestId: string;
  contestProblemId: string;
  viewer: ViewerContext;
  language?: string;
  code?: string;
}) {
  const contest = await prisma.contest.findUnique({
    where: { id: input.contestId },
    include: {
      createdBy: true,
      participants: {
        include: {
          user: true,
          externalHandle: true
        }
      },
      problems: true
    }
  });

  if (!contest) throw new Error('Contest not found');

  const participant = findViewerParticipant(contest, input.viewer);
  if (!participant) {
    throw new Error('Only registered contest players can submit. The creator is not a player unless added separately.');
  }

  const contestProblem = contest.problems.find((problem) => problem.id === input.contestProblemId);
  if (!contestProblem) throw new Error('Contest problem not found');

  if (!input.code?.trim()) throw new Error('Code is required');
  if (!input.language?.trim()) throw new Error('Language is required');

  return prisma.submission.create({
    data: {
      userId: participant.userId,
      participantId: participant.id,
      teamId: participant.teamId, // Store teamId here for privacy filtering
      problemId: contestProblem.problemId,
      contestId: contest.id,
      contestProblemId: contestProblem.id,
      source: SubmissionSource.INTERNAL_JUDGE,
      status: SubmissionStatus.QUEUED,
      verdict: Verdict.PENDING,
      language: input.language!,
      code: input.code!
    }
  });
}
