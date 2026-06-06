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

// 👉 STEP 4: Point Deduction & Unlocking Logic
export async function unlockHiddenTestCase(contestId: string, contestProblemId: string, viewer: ViewerContext) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId }, include: { participants: true, teams: true }
  });
  if (!contest) throw new Error("Contest not found");

  const participant = findViewerParticipant(contest, viewer);
  if (!participant) throw new Error("Participant not found");

  const contestProblem = await prisma.contestProblem.findUnique({ where: { id: contestProblemId } });
  if (!contestProblem || !contestProblem.problemId) throw new Error("Problem dataset missing");

  const hiddenTest = await prisma.testcase.findFirst({
    where: { problemId: contestProblem.problemId, type: 'HIDDEN' },
    orderBy: { order: 'asc' }
  });

  if (!hiddenTest) throw new Error("No hidden testcases available for this problem");

  // Check if they already unlocked it to prevent double deduction
  const existingUnlock = await prisma.unlockedTestcase.findUnique({
    where: { userId_testcaseId: { userId: participant.userId!, testcaseId: hiddenTest.id } }
  });

  if (!existingUnlock) {
    // 50 point deduction on Standing and Team models
    await prisma.$transaction(async (tx) => {
      await tx.contestStanding.updateMany({
        where: { participantId: participant.id },
        data: { testcasePenalty: { increment: 50 }, score: { decrement: 50 }, individualScore: { decrement: 50 } }
      });
      
      if (participant.teamId) {
        await tx.contestTeam.update({
          where: { id: participant.teamId },
          data: { penalty: { increment: 50 }, score: { decrement: 50 } }
        });
      }

      await tx.unlockedTestcase.create({
        data: {
          userId: participant.userId!,
          teamId: participant.teamId,
          contestProblemId: contestProblemId,
          testcaseId: hiddenTest.id
        }
      });
    });
  }

  return hiddenTest;
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

  if (!isOwner) {
    if (contest.status === ContestStatus.RUNNING) {
      if (!participant) throw new Error('Only active participants can view submissions during the contest.');
      
      if (contest.allowTeamSubmissionView && participant.teamId) {
        whereClause.teamId = participant.teamId;
      } else {
        whereClause.participantId = participant.id; 
      }
    } else if (contest.status === ContestStatus.ENDED) {
      // Unrestricted reading
    } else {
      throw new Error('Submissions are not visible at this time. Contest is not active.');
    }
  }

  return prisma.submission.findMany({
    where: whereClause,
    include: {
      user: { select: { username: true, avatarUrl: true, name: true } },
      participant: { select: { displayName: true, teamId: true } },
      team: { select: { name: true } },
      reports: isOwner ? true : false, 
    },
    orderBy: { createdAt: 'desc' }
  });
}