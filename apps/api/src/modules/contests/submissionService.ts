import { SubmissionSource, SubmissionStatus, Verdict, ContestStatus } from '@prisma/client';
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
      userId: participant.userId!,
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

export async function getContestSubmissions(input: {
  contestId: string;
  viewer: ViewerContext;
}) {
  const contest = await prisma.contest.findUnique({
    where: { id: input.contestId },
    include: { participants: true }
  });

  if (!contest) throw new Error('Contest not found');

  const participant = findViewerParticipant(contest, input.viewer);
  const isOwner = contest.createdById === input.viewer.userId;

  let whereClause: any = { contestId: input.contestId };

  // If the user is NOT the owner, enforce visibility rules
  if (!isOwner) {
    if (contest.status === ContestStatus.RUNNING) {
      if (!participant) throw new Error('Only active participants can view submissions during the contest.');
      
      // Filter strictly to the user's team
      if (participant.teamId) {
        whereClause.teamId = participant.teamId;
      } else {
        // Fallback for Solo contests
        whereClause.userId = participant.userId; 
      }
    } else if (contest.status === ContestStatus.ENDED) {
      // Contest ended: Everyone sees everything (No extra filters added to whereClause)
    } else {
      // Draft, Scheduled, or Frozen: Hide submissions from non-owners
      throw new Error('Submissions are not visible at this time.');
    }
  }

  // Fetch submissions with the applied filters
  return prisma.submission.findMany({
    where: whereClause,
    include: {
      user: {
        select: { username: true, avatarUrl: true }
      },
      reports: isOwner ? true : false, // Only owners need to see the reports array
    },
    orderBy: { createdAt: 'desc' }
  });
}