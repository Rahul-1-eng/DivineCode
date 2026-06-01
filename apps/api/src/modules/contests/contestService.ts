import {
  ContestParticipantRole,
  ContestStatus,
  ContestType,
  HandleVerificationStatus,
  Platform,
  Prisma
} from '@prisma/client';
import { fetchCodeforcesAccepted } from '../../externalSync';
import { prisma } from '../../prisma/client';
import { recomputeContestStandings } from '../standings/standingService';

type MemberInput = {
  userId?: string;
  email?: string;
  name?: string;
  displayName?: string;
  teamName?: string;
  codeforcesHandle?: string;
  ratingBefore?: number;
};

type ProblemInput = {
  problemId?: string;
  interviewQuestionId?: string;
  title?: string;
  platform?: string;
  code?: string;
  contestCode?: string;
  problemIndex?: string;
  externalId?: string;
  url?: string;
  points?: number;
};

type CreateContestInput = {
  title?: string;
  description?: string;
  type?: ContestType;
  startTime?: string;
  durationMinutes?: number;
  isRated?: boolean;
  allowLateJoin?: boolean;
  allowTeamSubmissionView?: boolean;
  hideProblemMetaDuringContest?: boolean;
  ownerUserId?: string;
  ownerEmail?: string;
  ownerName?: string;
  members?: MemberInput[];
  problems?: ProblemInput[];
  requireUnsolvedByAll?: boolean;
};

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

function inviteCode(title: string) {
  return `${slugify(title).slice(0, 16) || 'contest'}-${randomSuffix()}`.toUpperCase();
}

function displayLabel(index: number) {
  return LABELS[index] || `Q${index + 1}`;
}

function toPlatform(value: string | undefined) {
  const normalized = String(value || 'DIVINECODE').trim().toUpperCase();
  if (normalized.includes('CODEFORCES')) return Platform.CODEFORCES;
  if (normalized.includes('LEETCODE')) return Platform.LEETCODE;
  if (normalized.includes('ATCODER')) return Platform.ATCODER;
  if (normalized.includes('CODECHEF')) return Platform.CODECHEF;
  if (normalized.includes('HACKERRANK')) return Platform.HACKERRANK;
  if (normalized.includes('DIVINECODE')) return Platform.DIVINECODE;
  return Platform.OTHER;
}

function parseCodeforcesCode(problem: ProblemInput) {
  const code = String(problem.code || problem.externalId || '').trim().toUpperCase();
  if (problem.contestCode && problem.problemIndex) {
    return { contestCode: String(problem.contestCode), problemIndex: String(problem.problemIndex).toUpperCase() };
  }

  const match = code.match(/^(\d+)([A-Z][0-9]?)$/);
  if (!match) return { contestCode: String(problem.contestCode || code), problemIndex: String(problem.problemIndex || '') };
  return { contestCode: match[1], problemIndex: match[2] };
}

function externalUrl(problem: ProblemInput, platform: Platform) {
  if (problem.url) return problem.url;
  if (platform === Platform.CODEFORCES) {
    const parsed = parseCodeforcesCode(problem);
    if (parsed.contestCode && parsed.problemIndex) {
      return `https://codeforces.com/problemset/problem/${parsed.contestCode}/${parsed.problemIndex}`;
    }
  }
  if (platform === Platform.LEETCODE && problem.code) return `https://leetcode.com/problems/${problem.code}`;
  if (platform === Platform.CODECHEF && problem.code) return `https://www.codechef.com/problems/${problem.code}`;
  return '';
}

function normalizedMember(input: MemberInput) {
  const displayName = String(input.displayName || input.name || input.email || input.codeforcesHandle || '').trim();
  if (!displayName) throw new Error('Each participant needs a displayName, name, email, or Codeforces handle');
  
  return {
    ...input,
    displayName,
    teamName: String(input.teamName || 'Individuals').trim() || 'Individuals'
  };
}

async function ensureParticipantUser(tx: Prisma.TransactionClient, input: MemberInput) {
  if (input.userId) {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (user) return user;
  }

  if (input.email) {
    const email = input.email.trim().toLowerCase();
    const user = await tx.user.findUnique({ where: { email } });
    if (user) return user;
  }

  const normalizedHandle = String(input.codeforcesHandle || '').trim();
  if (normalizedHandle) {
    const existingHandle = await tx.externalHandle.findUnique({
      where: { platform_handle: { platform: Platform.CODEFORCES, handle: normalizedHandle } }
    });
    if (existingHandle) {
      const user = await tx.user.findUnique({ where: { id: existingHandle.userId } });
      if (user) return user;
    }
  }

  const ghostEmail = input.email?.trim().toLowerCase() || `ghost_${randomSuffix()}@divinecode.local`;
  const usernameSeed = slugify(input.name || input.displayName || ghostEmail.split('@')[0] || 'user') || 'user';
  
  return tx.user.upsert({
    where: { email: ghostEmail },
    update: { name: input.name || undefined },
    create: {
      email: ghostEmail,
      username: `${usernameSeed}_${randomSuffix()}`,
      name: input.name || ghostEmail.split('@')[0]
    }
  });
}

async function ensureUser(tx: Prisma.TransactionClient, input: { userId?: string; email?: string; name?: string }) {
  if (input.userId) {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new Error(`User not found: ${input.userId}`);
    return user;
  }

  if (!input.email) throw new Error('email or userId is required');

  const email = input.email.trim().toLowerCase();
  const usernameSeed = slugify(input.name || email.split('@')[0] || 'user') || 'user';
  return tx.user.upsert({
    where: { email },
    update: {
      name: input.name || undefined
    },
    create: {
      email,
      username: `${usernameSeed}_${randomSuffix()}`,
      name: input.name || email.split('@')[0]
    }
  });
}

async function ensureCodeforcesHandle(tx: Prisma.TransactionClient, userId: string, handle?: string) {
  const normalizedHandle = String(handle || '').trim();
  if (!normalizedHandle) return null;

  const existingForHandle = await tx.externalHandle.findUnique({
    where: { platform_handle: { platform: Platform.CODEFORCES, handle: normalizedHandle } }
  });

  if (existingForHandle && existingForHandle.userId !== userId) {
    throw new Error(`Codeforces handle "${normalizedHandle}" is already linked to another user`);
  }

  const existingForUser = await tx.externalHandle.findFirst({
    where: { userId, platform: Platform.CODEFORCES }
  });

  if (existingForUser) {
    return tx.externalHandle.update({
      where: { id: existingForUser.id },
      data: {
        handle: normalizedHandle,
        status: existingForUser.handle === normalizedHandle ? existingForUser.status : HandleVerificationStatus.PENDING
      }
    });
  }

  return tx.externalHandle.create({
    data: {
      userId,
      platform: Platform.CODEFORCES,
      handle: normalizedHandle,
      status: HandleVerificationStatus.PENDING
    }
  });
}

async function assertUnsolvedByAll(members: MemberInput[], problems: ProblemInput[]) {
  for (const problem of problems) {
    const platform = toPlatform(problem.platform);
    if (platform !== Platform.CODEFORCES) continue;
    const parsed = parseCodeforcesCode(problem);
    if (!parsed.contestCode || !parsed.problemIndex) continue;

    for (const member of members) {
      if (!member.codeforcesHandle) continue;
      const accepted = await fetchCodeforcesAccepted(member.codeforcesHandle, parsed.contestCode, parsed.problemIndex);
      if (accepted) {
        throw new Error(
          `Cannot add ${parsed.contestCode}${parsed.problemIndex}. ${member.codeforcesHandle} has already solved it on Codeforces.`
        );
      }
    }
  }
}

// Add this to apps/api/src/modules/contests/contestService.ts
async function createContestProblemRow(tx: Prisma.TransactionClient, input: {
  contestId: string;
  problem: ProblemInput;
  index: number;
  addedById?: string | null;
}) {
  const platform = toPlatform(input.problem.platform);
  const label = displayLabel(input.index);
  
  return tx.contestProblem.create({
    data: {
      contestId: input.contestId,
      problemId: input.problem.problemId || null,
      interviewQuestionId: input.problem.interviewQuestionId || null,
      titleSnapshot: String(input.problem.title || `Problem ${label}`).trim(),
      platform,
      externalUrl: input.problem.url || '',
      index: input.index,
      label,
      points: Math.max(1, Number(input.problem.points || 1000)),
      addedById: input.addedById || null
    }
  });
}
export async function loadContestForViewer(contestId: string) {
  return prisma.contest.findUnique({
    where: { id: contestId },
    include: {
      createdBy: true,
      participants: {
        include: {
          user: true,
          externalHandle: true
        },
        orderBy: { joinedAt: 'asc' }
      },
      problems: {
        include: {
          problem: {
            include: {
              editorial: true,
              officialSolutions: true
            }
          }
        },
        orderBy: { index: 'asc' }
      },
      standings: {
        include: {
          participant: true
        },
        orderBy: [{ rank: 'asc' }, { solved: 'desc' }, { penalty: 'asc' }]
      }
    }
  });
}

export async function createContestV2(input: CreateContestInput) {
  const title = String(input.title || '').trim();
  if (!title) throw new Error('Contest title is required');

  const members = (input.members || []).map(normalizedMember);
  if (members.length === 0) throw new Error('Add at least one player. The owner is not added as a player automatically.');

  const problems = input.problems || [];
  if (problems.length === 0) throw new Error('Add at least one problem.');

  const startTime = input.startTime ? new Date(input.startTime) : new Date();
  const durationMinutes = Math.max(1, Number(input.durationMinutes || 120));
  const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

  if (!input.ownerUserId && !input.ownerEmail) {
    throw new Error('V2 contests require ownerUserId or ownerEmail so edit/delete permissions are deterministic.');
  }

  if (input.requireUnsolvedByAll !== false) {
    await assertUnsolvedByAll(members, problems);
  }

  const contest = await prisma.$transaction(async (tx) => {
    const owner = await ensureUser(tx, {
      userId: input.ownerUserId,
      email: input.ownerEmail,
      name: input.ownerName
    });

    const created = await tx.contest.create({
      data: {
        inviteCode: inviteCode(title),
        title,
        description: input.description || null,
        type: input.type || ContestType.GROUP,
        status: startTime.getTime() <= Date.now() ? ContestStatus.RUNNING : ContestStatus.SCHEDULED,
        startTime,
        endTime,
        durationMinutes,
        isRated: Boolean(input.isRated),
        allowLateJoin: Boolean(input.allowLateJoin),
        hideProblemMetaDuringContest: input.hideProblemMetaDuringContest !== false,
        allowTeamSubmissionView: input.allowTeamSubmissionView !== false,
        createdById: owner.id
      }
    });

    for (const member of members) {
      const user = await ensureParticipantUser(tx, member);
      const externalHandle = await ensureCodeforcesHandle(tx, user.id, member.codeforcesHandle);

      await tx.contestParticipant.create({
        data: {
          contestId: created.id,
          userId: user.id,
          externalHandleId: externalHandle?.id || null,
          displayName: member.displayName!,
          teamName: member.teamName,
          role: ContestParticipantRole.PARTICIPANT,
          isOfficial: true,
          ratingBefore: member.ratingBefore
        }
      });
    }

    for (const [index, problem] of problems.entries()) {
      await createContestProblemRow(tx, {
        contestId: created.id,
        problem,
        index,
        addedById: owner.id
      });
    }

    return created;
  }, {
    maxWait: 15000,
    timeout: 60000
  });

  await recomputeContestStandings(contest.id);
  return loadContestForViewer(contest.id);
}

export async function deleteContestV2(contestId: string, actorId?: string) {
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest) throw new Error('Contest not found');

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        actorId: actorId || null,
        contestId,
        action: 'CONTEST_DELETE',
        entityType: 'Contest',
        entityId: contestId,
        before: contest as any
      }
    });
    await tx.contest.delete({ where: { id: contestId } });
  });
}

export async function listContestsV2() {
  const contests = await prisma.contest.findMany({
    include: {
      createdBy: true, // <-- ADDED: Fetch owner data
      _count: {
        select: {
          participants: true,
          problems: true
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 40 // <-- Reduced from 100 to improve DB latency
  });

  return contests.map((contest) => ({
    id: contest.id,
    title: contest.title,
    description: contest.description || '',
    startTime: contest.startTime,
    durationMinutes: contest.durationMinutes,
    isRated: contest.isRated,
    status: contest.status,
    membersCount: contest._count.participants,
    problemsCount: contest._count.problems,
    questionCount: 0,
    createdAt: contest.createdAt,
    // EXPOSE OWNER INFO TO FRONTEND:
    ownerEmail: contest.createdBy?.email,
    createdById: contest.createdById
  }));
}

export async function extendContestV2(contestId: string, minutes: number, actorId?: string) {
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest) throw new Error('Contest not found');

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        actorId: actorId || null,
        contestId,
        action: 'CONTEST_EXTEND',
        entityType: 'Contest',
        entityId: contestId,
        before: contest as any,
        after: { durationMinutes: contest.durationMinutes + Math.max(1, minutes) }
      }
    });
    await tx.contest.update({
      where: { id: contestId },
      data: {
        durationMinutes: contest.durationMinutes + Math.max(1, minutes),
        endTime: new Date(contest.startTime.getTime() + (contest.durationMinutes + Math.max(1, minutes)) * 60000)
      }
    });
  });

  return loadContestForViewer(contestId);
}

export async function updateContestSettingsV2(contestId: string, input: {
  title?: string;
  description?: string;
  durationMinutes?: number;
}, actorId?: string) {
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest) throw new Error('Contest not found');

  const durationMinutes = input.durationMinutes ? Math.max(1, Number(input.durationMinutes)) : contest.durationMinutes;
  const data = {
    title: input.title?.trim() || contest.title,
    description: typeof input.description === 'string' ? input.description : contest.description,
    durationMinutes,
    endTime: new Date(contest.startTime.getTime() + durationMinutes * 60000)
  };

  await prisma.$transaction(async (tx) => {
    const updated = await tx.contest.update({
      where: { id: contestId },
      data
    });
    await tx.auditLog.create({
      data: {
        actorId: actorId || null,
        contestId,
        action: 'CONTEST_SETTINGS_UPDATE',
        entityType: 'Contest',
        entityId: contestId,
        before: contest as any,
        after: updated as any
      }
    });
  });

  return loadContestForViewer(contestId);
}

export async function addContestProblemV2(contestId: string, problem: ProblemInput, actorId?: string) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    include: {
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

  await assertUnsolvedByAll(
    contest.participants.map((participant) => ({
      userId: participant.userId || undefined,
      email: participant.user?.email || undefined,
      displayName: participant.displayName,
      codeforcesHandle: participant.externalHandle?.handle || undefined
    })),
    [problem]
  );

  await prisma.$transaction(async (tx) => {
    const created = await createContestProblemRow(tx, {
      contestId,
      problem,
      index: contest.problems.length,
      addedById: actorId || null
    });
    
    await tx.auditLog.create({
      data: {
        actorId: actorId || null,
        contestId,
        action: 'CONTEST_PROBLEM_ADD',
        entityType: 'ContestProblem',
        entityId: created.id,
        after: created as any
      }
    });
  });

  await recomputeContestStandings(contestId);
  return loadContestForViewer(contestId);
}

export async function removeContestProblemV2(contestId: string, contestProblemId: string, actorId?: string) {
  const problem = await prisma.contestProblem.findFirst({ where: { id: contestProblemId, contestId } });
  if (!problem) throw new Error('Problem not found');

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        actorId: actorId || null,
        contestId,
        action: 'CONTEST_PROBLEM_REMOVE',
        entityType: 'ContestProblem',
        entityId: contestProblemId,
        before: problem as any
      }
    });
    await tx.contestProblem.delete({ where: { id: contestProblemId } });
  });

  await recomputeContestStandings(contestId);
  return loadContestForViewer(contestId);
}

export async function replaceContestProblemV2(contestId: string, contestProblemId: string, problem: ProblemInput, actorId?: string) {
  const existing = await prisma.contestProblem.findFirst({ where: { id: contestProblemId, contestId } });
  if (!existing) throw new Error('Problem not found');

  const platform = toPlatform(problem.platform);
  const parsedCodeforces = platform === Platform.CODEFORCES ? parseCodeforcesCode(problem) : null;
  const externalId =
    problem.externalId ||
    problem.code ||
    (parsedCodeforces ? `${parsedCodeforces.contestCode}${parsedCodeforces.problemIndex}` : null);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.contestProblem.update({
      where: { id: contestProblemId },
      data: {
        problemId: problem.problemId || null,
        titleSnapshot: String(problem.title || externalId || existing.titleSnapshot).trim(),
        platform,
        externalId,
        externalUrl: externalUrl(problem, platform),
        points: Math.max(1, Number(problem.points || existing.points)),
        addedById: actorId || existing.addedById
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: actorId || null,
        contestId,
        action: 'CONTEST_PROBLEM_REPLACE',
        entityType: 'ContestProblem',
        entityId: contestProblemId,
        before: existing as any,
        after: updated as any
      }
    });
  });

  await recomputeContestStandings(contestId);
  return loadContestForViewer(contestId);
}

// 👉 RECTIFIED: Handles Post-Contest Visibility & Strict Team Matching
export async function getContestSubmissionsV2(contestId: string, viewerUserId?: string, viewerEmail?: string) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    include: { participants: { include: { user: true } } }
  });

  if (!contest) throw new Error('Contest not found');

  const normalizedEmail = viewerEmail?.trim().toLowerCase();

  let resolvedUserId = viewerUserId;
  if (!resolvedUserId && normalizedEmail) {
    const u = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (u) resolvedUserId = u.id;
  }

  // 🔥 CHECK IF CONTEST IS OVER
  const isContestOver = Date.now() >= contest.endTime.getTime();
  const isOwner = contest.createdById === resolvedUserId;

  let allowedParticipantIds: string[] | null = null; // null means can see all

  // Owner OR Contest is Over -> see everything
  if (isOwner || isContestOver) {
    allowedParticipantIds = null;
  } else {
    // Contest is Live -> enforce privacy filter
    const viewerParticipant = contest.participants.find(
      p => (resolvedUserId && p.userId === resolvedUserId) ||
           (normalizedEmail && p.user?.email?.toLowerCase() === normalizedEmail)
    );

    if (viewerParticipant) {
      const team = viewerParticipant.teamName?.trim() || 'Individuals';
      
      // If they are in a real team, let them see team submissions
      if (contest.allowTeamSubmissionView && team !== 'Individuals' && team !== 'Solo') {
        allowedParticipantIds = contest.participants
          .filter(p => (p.teamName?.trim() || 'Individuals') === team)
          .map(p => p.id);
      } else {
        // Solo player, strictly see their own
        allowedParticipantIds = [viewerParticipant.id];
      }
    } else {
      // Viewer isn't a participant -> block view
      allowedParticipantIds = [];
    }
  }

  const whereClause: Prisma.SubmissionWhereInput = { contestId };
  if (allowedParticipantIds !== null) {
    whereClause.participantId = { in: allowedParticipantIds };
  }

  const submissions = await prisma.submission.findMany({
    where: whereClause,
    include: {
      participant: {
        include: { user: true, externalHandle: true }
      },
      contestProblem: true
    },
    orderBy: { judgedAt: 'desc' },
    take: 250
  });

 // At the bottom of contestService.ts
  return submissions.map(sub => ({
    id: sub.id,
    contestId: sub.contestId,
    memberId: sub.participantId,
    userId: sub.participant?.displayName || sub.participant?.user?.name || 'Unknown',
    problemId: sub.contestProblemId,
    verdict: sub.verdict,
    language: sub.language,
    source: sub.source,
    externalSubmissionId: sub.externalSubmissionId,
    createdAt: sub.externalCreatedAt || sub.judgedAt,
    platform: sub.contestProblem?.platform || 'Codeforces',
    code: sub.code // 👉 ADD THIS LINE SO THE UI CAN RENDER IT!
  }));
}
