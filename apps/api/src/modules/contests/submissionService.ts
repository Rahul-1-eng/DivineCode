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
if (contestProblem.requiresRedirect && contestProblem.externalUrl) {
    return { 
      redirectUrl: contestProblem.externalUrl,
      status: 'REDIRECT_REQUIRED' 
    };
  }
  if (!input.code?.trim()) throw new Error('Code is required');
  if (!input.language?.trim()) throw new Error('Language is required');

  return prisma.submission.create({
    data: {
      userId: participant.userId!,
      participantId: participant.id,
      // 👉 NEW: This now securely links the submission to the relational ContestTeam model
      teamId: participant.teamId, 
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

  // 👉 ENFORCING PRIVACY BOUNDARIES WITH NEW TEAM ARCHITECTURE
  if (!isOwner) {
    if (contest.status === ContestStatus.RUNNING) {
      if (!participant) throw new Error('Only active participants can view submissions during the contest.');
      
      // Only allow group viewing if the creator enabled it AND they are actually in a strict relational team
      if (contest.allowTeamSubmissionView && participant.teamId) {
        // Massive optimization: We can query the Submission table directly by teamId now!
        whereClause.teamId = participant.teamId;
      } else {
        // Strict isolation: User can only see their own submissions
        whereClause.participantId = participant.id; 
      }
    } else if (contest.status === ContestStatus.ENDED) {
      // Contest ended: Everyone sees everything, no extra filters added.
    } else {
      throw new Error('Submissions are not visible at this time. Contest is not active.');
    }
  }

  return prisma.submission.findMany({
    where: whereClause,
    include: {
      user: {
        select: { username: true, avatarUrl: true, name: true }
      },
      participant: {
        select: { displayName: true, teamId: true }
      },
      // 👉 NEW: Pulls the official team name right out of the joined table
      team: {
        select: { name: true } 
      },
      reports: isOwner ? true : false, 
    },
    orderBy: { createdAt: 'desc' }
  });
}