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
import { scrapeProblemFromUrl } from '../external-sync/problemScraper';
import { generateToughTestCases } from '../ai/aiService';

export type MemberInput = {
  username?: string; userId?: string; email?: string;
  name?: string; displayName?: string; teamName?: string;
  teamInviteCode?: string;
  codeforcesHandle?: string; ratingBefore?: number;
};

export type ProblemInput = {
  id?: string; problemId?: string; interviewQuestionId?: string; title?: string;
  description?: string;
  mcqTimeLimitSeconds?: number; // Added
  mcqData?: any; // Added
  platform?: string; code?: string; contestCode?: string;
  problemIndex?: string; externalId?: string; url?: string; points?: number;
};

export type CreateContestInput = {
  title?: string; description?: string; type?: ContestType;
  startTime?: string; durationMinutes?: number; freezeMinutes?: number;
  isRated?: boolean; allowLateJoin?: boolean;
  allowTeamSubmissionView?: boolean; hideProblemMetaDuringContest?: boolean;
  ownerUserId?: string; ownerEmail?: string; ownerName?: string;
  members?: MemberInput[]; problems?: ProblemInput[]; requireUnsolvedByAll?: boolean;
};

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
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
  // 👉 FIXED: Automatically strip spaces so "800 A" becomes "800A"
  const code = String(problem.code || problem.externalId || '').replace(/\s+/g, '').toUpperCase();
  if (problem.contestCode && problem.problemIndex) {
    return { contestCode: String(problem.contestCode).trim(), problemIndex: String(problem.problemIndex).replace(/\s+/g, '').toUpperCase() };
  }

  const match = code.match(/^(\d+)([A-Z][0-9]?)$/);
  if (!match) return { contestCode: String(problem.contestCode || code).trim(), problemIndex: String(problem.problemIndex || '').replace(/\s+/g, '').toUpperCase() };
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
  const displayName = String(
    input.displayName || input.name || input.email || input.codeforcesHandle || input.username || ''
  ).trim();

  if (!displayName) throw new Error('Each participant needs a displayName, username, email, or Codeforces handle');
  
  return {
    ...input, displayName,
    teamName: String(input.teamName || 'Individuals').trim() || 'Individuals'
  };
}

async function ensureParticipantUser(tx: Prisma.TransactionClient, input: MemberInput) {
  if (input.userId) {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (user) return user;
  }
  if (input.username) {
    const user = await tx.user.findUnique({ where: { username: input.username } });
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
    create: { email: ghostEmail, username: `${usernameSeed}_${randomSuffix()}`, name: input.name || ghostEmail.split('@')[0] }
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
    update: { name: input.name || undefined },
    create: { email, username: `${usernameSeed}_${randomSuffix()}`, name: input.name || email.split('@')[0] }
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
      data: { handle: normalizedHandle, status: existingForUser.handle === normalizedHandle ? existingForUser.status : HandleVerificationStatus.PENDING }
    });
  }

  return tx.externalHandle.create({
    data: { userId, platform: Platform.CODEFORCES, handle: normalizedHandle, status: HandleVerificationStatus.PENDING }
  });
}

async function assertUnsolvedByAll(members: MemberInput[], problems: ProblemInput[]) {
  for (const problem of problems) {
    const platform = toPlatform(problem.platform);
    if (platform !== Platform.CODEFORCES) continue;
    if (problem.url || problem.id) continue;

    const parsed = parseCodeforcesCode(problem);
    if (!parsed.contestCode || !parsed.problemIndex) continue;

    for (const member of members) {
      if (!member.codeforcesHandle) {
        throw new Error(`CF MISSING: Participant ${member.displayName || 'Unnamed'} needs a Codeforces handle.`);
      }
      try {
        const accepted = await fetchCodeforcesAccepted(member.codeforcesHandle, parsed.contestCode, parsed.problemIndex);
        if (accepted) {
          throw new Error(`Cannot add ${parsed.contestCode}${parsed.problemIndex}. ${member.codeforcesHandle} has already solved it.`);
        }
      } catch (err: any) {
        if (err.message.includes('Cannot add')) throw err;
      }
    }
  }
}

async function createContestProblemRow(tx: Prisma.TransactionClient, input: {
  contestId: string; problem: ProblemInput; index: number; addedById?: string | null;
}) {
  const platform = toPlatform(input.problem.platform);
  const label = displayLabel(input.index);
  
  return tx.contestProblem.create({
    data: {
      contestId: input.contestId,
      problemId: input.problem.problemId || input.problem.id || null,
      interviewQuestionId: input.problem.interviewQuestionId || null,
      isMCQ: !!input.problem.interviewQuestionId, // Added
      mcqTimeLimitSeconds: input.problem.mcqTimeLimitSeconds || 0, // Added
      mcqData: input.problem.mcqData || null, // Added
      titleSnapshot: String(input.problem.title || `Problem ${label}`).trim(),
      customDescription: input.problem.description || null, // 👉 Persist Custom Descriptions explicitly
      platform, 
      externalUrl: input.problem.url || externalUrl(input.problem, platform) || '', 
      index: input.index,
      label, 
      points: Math.max(1, Number(input.problem.points || 1000)),
      addedById: input.addedById || null
    }
  });
}

export async function loadContestForViewer(contestId: string) {
  try {
    return await prisma.contest.findUnique({
      where: { id: contestId },
      include: {
        createdBy: true,
        participants: {
          include: { user: true, externalHandle: true, team: true },
          orderBy: { joinedAt: 'asc' }
        },
        problems: {
          include: {
            problem: {
              include: { editorial: true, officialSolutions: true, testcases: true }
            },
            interviewQuestion: true // 👉 ADDED THIS INCLUSION
          },
          orderBy: { index: 'asc' }
        },
        standings: {
          include: { participant: true }
        }
      }
    });
  } catch (error) {
    throw error;
  }
}

export async function registerForContestV2(contestId: string, input: MemberInput) {
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest) throw new Error('Contest not found');
  
  if (!contest.allowLateJoin && contest.status !== ContestStatus.SCHEDULED) {
    throw new Error('Late joining is not allowed for this contest.');
  }

  const memberInput = normalizedMember(input);
  
  await prisma.$transaction(async (tx) => {
    const user = await ensureParticipantUser(tx, memberInput);
    
    let externalHandle = null;
    if (memberInput.codeforcesHandle) {
      externalHandle = await ensureCodeforcesHandle(tx, user.id, memberInput.codeforcesHandle);
    } else {
      externalHandle = await tx.externalHandle.findFirst({
        where: { userId: user.id, platform: Platform.CODEFORCES }
      });
    }

    const existing = await tx.contestParticipant.findFirst({
      where: { contestId, userId: user.id }
    });
    if (existing) throw new Error('User is already registered for this contest.');

    let teamId = null;
    let isPending = false;
    
    // TEAM INVITE LOGIC INTEGRATION
    if (memberInput.teamInviteCode) {
      const team = await tx.contestTeam.findUnique({ where: { inviteCode: memberInput.teamInviteCode } });
      if (!team || team.contestId !== contestId) throw new Error("Invalid Team Invite Code");
      teamId = team.id;
      memberInput.teamName = team.name;
    } else if (memberInput.teamName && memberInput.teamName !== 'Individuals' && memberInput.teamName !== 'Solo') {
       // Logic: New request to join a team requires approval.
       // We create the participant but set isOfficial to false (Pending).
       isPending = true;
    } else {
       // Regular join logic for individuals
       const isRealTeam = memberInput.teamName && memberInput.teamName !== 'Individuals';
       if (isRealTeam) {
         let team = await tx.contestTeam.findFirst({ where: { contestId, name: memberInput.teamName } });
         if (!team) team = await tx.contestTeam.create({ data: { contestId, name: memberInput.teamName! } });
         teamId = team.id;
       }
    }

    await tx.contestParticipant.create({
      data: {
        contestId: contest.id, userId: user.id, externalHandleId: externalHandle?.id || null,
        displayName: memberInput.displayName!, teamName: memberInput.teamName,
        teamId: teamId, 
        role: ContestParticipantRole.PARTICIPANT, 
        isOfficial: !isPending // Set to false if pending
      }
    });
  });

  void recomputeContestStandings(contestId).catch(err => console.error("Standings failed:", err));
  return loadContestForViewer(contestId);
}

export async function createContestV2(input: CreateContestInput) {
  const title = String(input.title || '').trim();
  if (!title) throw new Error('Contest title is required');

  const members = (input.members || []).map(normalizedMember);
  if (members.length === 0) throw new Error('Add at least one player. The owner is not added automatically.');

  const problems = input.problems || [];
  const startTime = input.startTime ? new Date(input.startTime) : new Date();
  const durationMinutes = Math.max(1, Number(input.durationMinutes || 120));
  const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
  const freezeTime = input.freezeMinutes ? new Date(endTime.getTime() - input.freezeMinutes * 60000) : null;

  if (!input.ownerUserId && !input.ownerEmail) {
    throw new Error('V2 contests require ownerUserId or ownerEmail so edit/delete permissions are deterministic.');
  }

  if (input.requireUnsolvedByAll !== false && problems.length > 0) {
    await assertUnsolvedByAll(members, problems);
  }

  const contest = await prisma.$transaction(async (tx) => {
    const owner = await ensureUser(tx, {
      userId: input.ownerUserId, email: input.ownerEmail, name: input.ownerName
    });

    const created = await tx.contest.create({
      data: {
        inviteCode: inviteCode(title), title, description: input.description || null,
        type: input.type || ContestType.GROUP, status: startTime.getTime() <= Date.now() ? ContestStatus.RUNNING : ContestStatus.SCHEDULED,
        startTime, endTime, freezeTime, durationMinutes, isRated: Boolean(input.isRated),
        allowLateJoin: Boolean(input.allowLateJoin), hideProblemMetaDuringContest: input.hideProblemMetaDuringContest !== false,
        allowTeamSubmissionView: input.allowTeamSubmissionView !== false, createdById: owner.id
      }
    });

    const uniqueTeamNames = [...new Set(members.map(m => m.teamName).filter(n => n && n !== 'Individuals' && n !== 'Solo'))];
    const teamRecordMap = new Map<string, string>();

    for (const tName of uniqueTeamNames) {
      const team = await tx.contestTeam.create({
        data: { contestId: created.id, name: tName! }
      });
      teamRecordMap.set(tName!, team.id);
    }

    for (const member of members) {
      const user = await ensureParticipantUser(tx, member);
      let externalHandle = null;
      if (member.codeforcesHandle) {
        externalHandle = await ensureCodeforcesHandle(tx, user.id, member.codeforcesHandle);
      } else {
        externalHandle = await tx.externalHandle.findFirst({ where: { userId: user.id, platform: Platform.CODEFORCES } });
      }

      const teamId = (member.teamName && teamRecordMap.has(member.teamName)) ? teamRecordMap.get(member.teamName) : null;

      await tx.contestParticipant.create({
        data: {
          contestId: created.id, userId: user.id, externalHandleId: externalHandle?.id || null,
          displayName: member.displayName!, teamName: member.teamName, teamId: teamId || null, 
          role: ContestParticipantRole.PARTICIPANT, isOfficial: true, ratingBefore: member.ratingBefore
        }
      });
    }

    for (const [index, problem] of problems.entries()) {
      await createContestProblemRow(tx, { contestId: created.id, problem, index, addedById: owner.id });
    }

    return created;
  }, { maxWait: 15000, timeout: 60000 });

  await recomputeContestStandings(contest.id);
  
  return loadContestForViewer(contest.id);
}

export async function deleteContestV2(contestId: string, actorId?: string) {
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest) throw new Error('Contest not found');

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: { actorId: actorId || null, contestId, action: 'CONTEST_DELETE', entityType: 'Contest', entityId: contestId, before: contest as any }
    });
    await tx.contest.delete({ where: { id: contestId } });
  });
}

export async function listContestsV2() {
  const contests = await prisma.contest.findMany({
    include: {
      createdBy: true,
      _count: { select: { participants: true, problems: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 40 
  });

  return contests.map((contest) => ({
    id: contest.id, title: contest.title, description: contest.description || '',
    startTime: contest.startTime, durationMinutes: contest.durationMinutes,
    isRated: contest.isRated, status: contest.status,
    membersCount: contest._count.participants, problemsCount: contest._count.problems,
    questionCount: 0, createdAt: contest.createdAt,
    ownerEmail: contest.createdBy?.email, createdById: contest.createdById
  }));
}

export async function extendContestV2(contestId: string, minutes: number, actorId?: string) {
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest) throw new Error('Contest not found');

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        actorId: actorId || null, contestId, action: 'CONTEST_EXTEND', entityType: 'Contest', entityId: contestId,
        before: contest as any, after: { durationMinutes: contest.durationMinutes + Math.max(1, minutes) }
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

export async function updateContestSettingsV2(contestId: string, input: { title?: string; description?: string; durationMinutes?: number; startTime?: string }, actorId?: string) {
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest) throw new Error('Contest not found');

  const durationMinutes = input.durationMinutes ? Math.max(1, Number(input.durationMinutes)) : contest.durationMinutes;
  
  const data: any = {
    title: input.title?.trim() || contest.title,
    description: typeof input.description === 'string' ? input.description : contest.description,
    durationMinutes
  };

  if (input.startTime) {
     const st = new Date(input.startTime);
     data.startTime = st;
     data.endTime = new Date(st.getTime() + durationMinutes * 60000);
  } else {
     data.endTime = new Date(contest.startTime.getTime() + durationMinutes * 60000);
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.contest.update({ where: { id: contestId }, data });
    await tx.auditLog.create({
      data: { actorId: actorId || null, contestId, action: 'CONTEST_SETTINGS_UPDATE', entityType: 'Contest', entityId: contestId, before: contest as any, after: updated as any }
    });
  });

  return loadContestForViewer(contestId);
}

export async function reorderContestProblemV2(contestId: string, contestProblemId: string, direction: 'UP' | 'DOWN', actorId?: string) {
  const problem = await prisma.contestProblem.findFirst({ where: { id: contestProblemId, contestId } });
  if (!problem) throw new Error('Problem not found');

  await prisma.$transaction(async (tx) => {
    const all = await tx.contestProblem.findMany({ where: { contestId }, orderBy: { index: 'asc' } });
    const currentIndex = all.findIndex(p => p.id === contestProblemId);
    
    if (currentIndex === -1) return;

    if (direction === 'UP' && currentIndex > 0) {
      const prev = all[currentIndex - 1];
      all[currentIndex - 1] = problem;
      all[currentIndex] = prev;
    } else if (direction === 'DOWN' && currentIndex < all.length - 1) {
      const next = all[currentIndex + 1];
      all[currentIndex + 1] = problem;
      all[currentIndex] = next;
    } else {
      return; 
    }

    for (let i = 0; i < all.length; i++) {
      await tx.contestProblem.update({
        where: { id: all[i].id },
        data: { index: i, label: LABELS[i] || `Q${i + 1}` }
      });
    }

    await tx.auditLog.create({ 
      data: { actorId: actorId || null, contestId, action: 'CONTEST_PROBLEM_REORDER', entityType: 'ContestProblem', entityId: contestProblemId, before: { direction } as any } 
    });
  });

  void recomputeContestStandings(contestId).catch(err => console.error("Standings failed:", err));
  return loadContestForViewer(contestId);
}

export async function addContestProblemV2(contestId: string, problem: ProblemInput & { mcqData?: any }, actorId?: string) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    include: { participants: { include: { user: true, externalHandle: true } }, problems: true }
  });
  if (!contest) throw new Error('Contest not found');

  let enrichedProblem = { ...problem };
  let newTestcases: any[] = [];
  
  // 👉 Ensure Custom HTML Descriptions are preferred over fallback text
  let finalDescription = problem.description || problem.title || 'External Problem';

  if (problem.url && !problem.id && !problem.description) {
    try {
      const scraped = await scrapeProblemFromUrl(problem.url);
      enrichedProblem.title = scraped.title;
      enrichedProblem.platform = scraped.platform;
      finalDescription = scraped.descriptionHtml;
      
      const aiGeneratedCases = await generateToughTestCases(scraped.descriptionHtml);
      newTestcases = [...scraped.testcases, ...aiGeneratedCases];
    } catch (err) {
      console.warn("Scraping or AI failed, applying URL fallback.");
      finalDescription = `<h3>External Problem</h3><p>Please view the problem description here: <a href="${problem.url}" target="_blank" style="color: #38bdf8;">Click here to open ${problem.url}</a></p>`;
      enrichedProblem.title = problem.title || 'Imported Problem';
    }
  }

  let finalInterviewQuestionId = problem.interviewQuestionId;

  // NEW: Handle MCQ Data creation if provided
  if (problem.mcqData) {
    const newMcq = await prisma.interviewQuestion.create({
      data: {
        trackId: 'default-track-id', // Update this based on your database defaults if necessary
        title: problem.title || "Contest MCQ",
        prompt: problem.mcqData.prompt,
        options: problem.mcqData.options || [],
        correctIndices: problem.mcqData.correctIndices || [],
        isMultiple: problem.mcqData.correctIndices?.length > 1,
        submittedById: actorId
      }
    });
    finalInterviewQuestionId = newMcq.id;
  }

  await prisma.$transaction(async (tx) => {
    let finalProblemId = problem.problemId || problem.id || null;

    if (!finalProblemId && problem.url) {
       try {
         const newProb = await tx.problem.create({
           data: {
             title: enrichedProblem.title || 'Imported Problem',
             description: finalDescription,
             platform: enrichedProblem.platform as any || 'OTHER',
             source: 'EXTERNAL',
             url: problem.url,
             problemCode: `EXT-${Date.now()}-${Math.floor(Math.random()*1000)}`,
             visibility: 'PUBLIC'
           }
         });
         finalProblemId = newProb.id;
         enrichedProblem.problemId = finalProblemId;
       } catch(err) {
         console.error("Failed to create fallback problem", err);
       }
    }

    const created = await createContestProblemRow(tx, { 
      contestId, 
      // 👇 Added mcqTimeLimitSeconds and mcqData to the spread
      problem: { 
        ...enrichedProblem, 
        description: finalDescription, 
        interviewQuestionId: finalInterviewQuestionId,
        mcqTimeLimitSeconds: problem.mcqTimeLimitSeconds || 0,
        mcqData: problem.mcqData || null
      }, 
      index: contest.problems.length, 
      addedById: actorId || null 
    });

    if (newTestcases.length > 0) {
       await tx.testcase.createMany({
         data: newTestcases.map((tc, idx) => ({
           problemId: created.problemId || '', 
           input: tc.input,
           expectedOutput: tc.expectedOutput,
           order: idx + 1,
           type: idx >= 2 ? 'HIDDEN' : 'SAMPLE' 
         }))
       });
    }

    await tx.auditLog.create({ 
      data: { actorId: actorId || null, contestId, action: 'CONTEST_PROBLEM_ADD', entityType: 'ContestProblem', entityId: created.id, after: created as any } 
    });
  });

  void recomputeContestStandings(contestId).catch(err => console.error("Standings failed:", err));
  return loadContestForViewer(contestId);
}

export async function removeContestProblemV2(contestId: string, contestProblemId: string, actorId?: string) {
  const problem = await prisma.contestProblem.findFirst({ where: { id: contestProblemId, contestId } });
  if (!problem) throw new Error('Problem not found');

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({ data: { actorId: actorId || null, contestId, action: 'CONTEST_PROBLEM_REMOVE', entityType: 'ContestProblem', entityId: contestProblemId, before: problem as any } });
    await tx.contestProblem.delete({ where: { id: contestProblemId } });

    const remaining = await tx.contestProblem.findMany({ where: { contestId }, orderBy: { index: 'asc' } });
    for (let i = 0; i < remaining.length; i++) {
      await tx.contestProblem.update({
        where: { id: remaining[i].id },
        data: { index: i, label: LABELS[i] || `Q${i + 1}` }
      });
    }
  });

  void recomputeContestStandings(contestId).catch(err => console.error("Standings failed:", err));
  return loadContestForViewer(contestId);
}

export async function replaceContestProblemV2(contestId: string, contestProblemId: string, problem: ProblemInput, actorId?: string) {
  const existing = await prisma.contestProblem.findFirst({ where: { id: contestProblemId, contestId } });
  if (!existing) throw new Error('Problem not found');

  const platform = toPlatform(problem.platform);
  const parsedCodeforces = platform === Platform.CODEFORCES ? parseCodeforcesCode(problem) : null;
  const externalId = problem.externalId || problem.code || (parsedCodeforces ? `${parsedCodeforces.contestCode}${parsedCodeforces.problemIndex}` : null);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.contestProblem.update({
      where: { id: contestProblemId },
      data: {
        problemId: problem.problemId || problem.id || null, titleSnapshot: String(problem.title || externalId || existing.titleSnapshot).trim(),
        platform, externalId, externalUrl: externalUrl(problem, platform),
        points: Math.max(1, Number(problem.points || existing.points)), addedById: actorId || existing.addedById
      }
    });
    await tx.auditLog.create({ data: { actorId: actorId || null, contestId, action: 'CONTEST_PROBLEM_REPLACE', entityType: 'ContestProblem', entityId: contestProblemId, before: existing as any, after: updated as any } });
  });

  void recomputeContestStandings(contestId).catch(err => console.error("Standings failed:", err));
  return loadContestForViewer(contestId);
}

export async function overrideSubmissionPoints(contestId: string, submissionId: string, manualPoints: number | null, actorId: string) {
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest) throw new Error('Contest not found');
  if (contest.createdById !== actorId) throw new Error('Only the contest owner can override submission points.');

  await prisma.submission.update({ where: { id: submissionId }, data: { manualPoints } });
  void recomputeContestStandings(contestId).catch(err => console.error("Standings failed:", err));
  return loadContestForViewer(contestId);
}

export async function getContestSubmissionsV2(contestId: string, viewerUserId?: string, viewerEmail?: string) {
  try {
    const contest = await prisma.contest.findUnique({
      where: { id: contestId }, include: { participants: { include: { user: true } } }
    });
    if (!contest) throw new Error('Contest not found');

    const normalizedEmail = viewerEmail?.trim().toLowerCase();
    let resolvedUserId = viewerUserId;

    if (!resolvedUserId && normalizedEmail) {
      const u = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (u) resolvedUserId = u.id;
    }

    const isContestOver = Date.now() >= (contest.endTime?.getTime() || 0);
    const isOwner = contest.createdById === resolvedUserId;
    let allowedParticipantIds: string[] | null = null; 

    if (isOwner || isContestOver) {
      allowedParticipantIds = null;
    } else {
      const viewerParticipant = contest.participants.find(
        p => (resolvedUserId && p.userId === resolvedUserId) || (normalizedEmail && p.user?.email?.toLowerCase() === normalizedEmail)
      );

      if (viewerParticipant) {
        if (contest.allowTeamSubmissionView && viewerParticipant.teamId) {
          allowedParticipantIds = contest.participants.filter(p => p.teamId === viewerParticipant.teamId).map(p => p.id);
        } else {
          allowedParticipantIds = [viewerParticipant.id];
        }
      } else {
        allowedParticipantIds = [];
      }
    }

    const whereClause: any = { contestId };
    if (allowedParticipantIds !== null) whereClause.participantId = { in: allowedParticipantIds };

    const submissions = await prisma.submission.findMany({
      where: whereClause,
      include: { participant: { include: { user: true, externalHandle: true } }, contestProblem: true },
      orderBy: { judgedAt: 'desc' }, take: 250
    });

    return submissions.map(sub => {
      const contestCode = sub.contestProblem?.externalId?.match(/^\d+/)?.[0];
      const externalSubmissionUrl = sub.externalSubmissionId && contestCode 
        ? `https://codeforces.com/contest/${contestCode}/submission/${sub.externalSubmissionId}`
        : null;

      return {
        id: sub.id, contestId: sub.contestId, memberId: sub.participantId,
        userId: sub.participant?.displayName || sub.participant?.user?.name || 'Unknown',
        problemId: sub.contestProblemId, verdict: sub.verdict, language: sub.language,
        source: sub.source, externalSubmissionId: sub.externalSubmissionId,
        externalSubmissionUrl, 
        createdAt: sub.externalCreatedAt || sub.judgedAt || sub.createdAt,
        platform: sub.contestProblem?.platform || 'Codeforces', code: sub.code
      };
    });
  } catch (error) {
    throw error;
  }
}

export async function approveParticipant(contestId: string, participantId: string, actorId: string) {
  const contest = await prisma.contest.findUnique({ where: { id: contestId }, include: { participants: true } });
  const actor = contest?.participants.find(p => p.userId === actorId);

  // Check if actor is a manager or owner (or team leader)
  if (!actor || (actor.role !== ContestParticipantRole.MANAGER && actor.userId !== contest?.createdById)) {
    throw new Error('Unauthorized: Only managers or owners can approve participants.');
  }

  return await prisma.contestParticipant.update({
    where: { id: participantId },
    data: { isOfficial: true }
  });
}