export type ViewerContext = {
  userId?: string;
  email?: string;
  name?: string;
};

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function viewerFromRequest(req: any): ViewerContext {
  return {
    userId: String(req.headers?.['x-user-id'] || req.query?.viewerUserId || req.body?.viewerUserId || '').trim() || undefined,
    email: String(req.headers?.['x-user-email'] || req.query?.viewerEmail || req.body?.viewerEmail || '').trim() || undefined,
    name: String(req.headers?.['x-user-name'] || req.query?.viewerName || req.body?.viewerName || '').trim() || undefined
  };
}

export function contestEndTime(contest: any) {
  if (!contest || !contest.startTime) return new Date();
  return new Date(new Date(contest.startTime).getTime() + (contest.durationMinutes || 0) * 60000);
}

export function contestHasEnded(contest: any, now = new Date()) {
  return now.getTime() >= contestEndTime(contest).getTime();
}

export function contestHasStarted(contest: any, now = new Date()) {
  if (!contest || !contest.startTime) return false;
  return now.getTime() >= new Date(contest.startTime).getTime();
}

export function isContestOwner(contest: any, viewer: ViewerContext) {
  if (!contest) return false;
  const viewerUserId = normalize(viewer?.userId);
  const viewerEmail = normalize(viewer?.email);
  return Boolean(
    (viewerUserId && normalize(contest.createdById) === viewerUserId) ||
      (viewerEmail && normalize(contest?.createdBy?.email) === viewerEmail)
  );
}

export function findViewerParticipant(contest: any, viewer: ViewerContext) {
  if (!contest || !contest.participants) return undefined;
  const viewerUserId = normalize(viewer?.userId);
  const viewerEmail = normalize(viewer?.email);
  const viewerName = normalize(viewer?.name);

  return contest.participants.find((p: any) => {
    if (!p) return false;
    return Boolean(
      (viewerUserId && normalize(p.userId) === viewerUserId) ||
        (viewerEmail && normalize(p.user?.email) === viewerEmail) ||
        (viewerName && normalize(p.displayName) === viewerName) ||
        (viewerName && normalize(p.externalHandle?.handle) === viewerName)
    );
  });
}

export function canManageContest(contest: any, viewer: ViewerContext) {
  return isContestOwner(contest, viewer);
}

export function canSeeProblemMeta(contest: any, viewer: ViewerContext, now = new Date()) {
  if (canManageContest(contest, viewer)) return true;
  if (!contest?.hideProblemMetaDuringContest) return true;
  return contestHasEnded(contest, now);
}

function sanitizeProblem(problem: any, showMeta: boolean) {
  if (!problem) return null;
  const base = {
    id: problem.id,
    index: problem.index,
    label: problem.label || 'Q',
    title: problem.titleSnapshot || 'Unknown Problem',
    titleSnapshot: problem.titleSnapshot || 'Unknown Problem',
    platform: problem.platform || 'DIVINECODE',
    externalId: problem.externalId,
    externalUrl: problem.externalUrl,
    url: problem.externalUrl,    requiresRedirect: Boolean(problem.requiresRedirect || problem.externalUrl),    isLocked: Boolean(problem.isLocked),
    isMCQ: Boolean(problem.isMCQ || problem.interviewQuestionId),
    interviewQuestionId: problem.interviewQuestionId || null,
    mcqTimeLimitSeconds: problem.mcqTimeLimitSeconds || 0,
    customDescription: problem.customDescription || null,
    customTestCases: problem.customTestCases || null
  };

  if (!showMeta) return base;

  const problemData = problem.problem
    ? {
        id: problem.problem.id,
        slug: problem.problem.slug,
        title: problem.problem.title,
        statement: problem.problem.statement,
        inputFormat: problem.problem.inputFormat,
        outputFormat: problem.problem.outputFormat,
        constraints: problem.problem.constraints,
        difficultyRating: problem.problem.difficultyRating,
        difficultyLabel: problem.problem.difficultyLabel,
        tags: problem.problem.tags || [],
        timeLimitMs: problem.problem.timeLimitMs,
        memoryLimitMb: problem.problem.memoryLimitMb,
        testcases: problem.problem.testcases || [],
        editorial: problem.problem.editorial || null,
        officialSolutions: problem.problem.officialSolutions || []
      }
    : null;

  const result = {
    ...base,
    points: problem.points || 0,
    rating: problem.problem?.difficultyRating || null,
    difficulty: problem.problem?.difficultyLabel || null,
    tags: problem.problem?.tags || [],
    problem: problemData
  };

  // CRITICAL: Include interviewQuestion for MCQ problems
  if (problem.interviewQuestion) {
    (result as any).interviewQuestion = {
      id: problem.interviewQuestion.id,
      title: problem.interviewQuestion.title,
      prompt: problem.interviewQuestion.prompt,
      options: problem.interviewQuestion.options || [],
      correctIndices: problem.interviewQuestion.correctIndices || [],
      isMultiple: Boolean(problem.interviewQuestion.isMultiple),
      difficulty: problem.interviewQuestion.difficulty,
      expectedAnswer: problem.interviewQuestion.expectedAnswer
    };
  }

  return result;
}

export function sanitizeContestForViewer(contest: any, viewer: ViewerContext, now = new Date()) {
  if (!contest) return null;
  
  const canManage = canManageContest(contest, viewer);
  const participant = findViewerParticipant(contest, viewer) || null;
  const showMeta = canSeeProblemMeta(contest, viewer, now);
  
  const validParticipants = (contest.participants || []).filter(Boolean);
  const participantById = new Map(validParticipants.map((row: any) => [row.id, row]));
  
  const members = validParticipants.map((p: any) => ({
    id: p.id,
    name: p.displayName || 'Unknown',
    displayName: p.displayName || 'Unknown',
    team: p.teamName || 'Individuals',
    teamName: p.teamName || 'Individuals',
    email: p.user?.email || '',
    codeforcesHandle: p.externalHandle?.handle || '',
    handle: p.externalHandle?.handle || '',
    role: p.role || 'PARTICIPANT',
    isOfficial: Boolean(p.isOfficial),
    ratingBefore: p.ratingBefore || null,
    ratingAfter: contestHasEnded(contest, now) || canManage ? p.ratingAfter : null
  }));

  return {
    id: contest.id,
    inviteCode: contest.inviteCode,
    title: contest.title || 'Untitled Contest',
    description: contest.description || '',
    type: contest.type || 'GROUP',
    status: contest.status || 'DRAFT',
    startTime: contest.startTime,
    endTime: contestEndTime(contest),
    freezeTime: contest.freezeTime,
    durationMinutes: contest.durationMinutes || 120,
    isRated: Boolean(contest.isRated),
    allowLateJoin: Boolean(contest.allowLateJoin),
    allowTeamSubmissionView: Boolean(contest.allowTeamSubmissionView),
    createdAt: contest.createdAt,
    canManage,
    viewerMember: participant
      ? {
          id: participant.id,
          name: participant.displayName || 'Unknown',
          displayName: participant.displayName || 'Unknown',
          team: participant.teamName || 'Individuals',
          teamName: participant.teamName || 'Individuals',
          email: participant.user?.email || '',
          codeforcesHandle: participant.externalHandle?.handle || '',
          handle: participant.externalHandle?.handle || ''
        }
      : null,
    visibility: {
      canSeeProblemMeta: showMeta,
      canViewAllSubmissions: canManage,
      submissionScope: canManage ? 'all' : (participant?.teamName && participant.teamName !== 'Individuals' && contest.allowTeamSubmissionView) ? 'team' : participant ? 'own' : 'none'
    },
    owner: contest.createdBy
      ? { id: contest.createdBy.id, username: contest.createdBy.username, name: contest.createdBy.name }
      : null,
    viewer: {
      canManage,
      participantId: participant?.id || null,
      role: participant?.role || (canManage ? 'OWNER' : null),
      canSeeProblemMeta: showMeta,
      submissionScope: canManage ? 'all' : (participant?.teamName && participant.teamName !== 'Individuals' && contest.allowTeamSubmissionView) ? 'team' : participant ? 'own' : 'none'
    },
    participants: members,
    members,
    problems: (contest.problems || []).map((problem: any) => sanitizeProblem(problem, showMeta)).filter(Boolean),
    standings: (contest.standings || []).map((standing: any) => {
      if (!standing) return null;
      const standingParticipant = standing.participant || participantById.get(standing.participantId) || {};
      return {
        ...standing,
        memberId: standing.participantId,
        name: standingParticipant.displayName || standingParticipant.user?.name || standing.participantId || 'Unknown',
        team: standingParticipant.teamName || 'Individuals'
      };
    }).filter(Boolean)
  };
}

export function sanitizeSubmissionForViewer(submission: any, fullAccess: boolean) {
  if (!submission) return null;
  const base = {
    id: submission.id,
    contestId: submission.contestId,
    contestProblemId: submission.contestProblemId,
    problemId: submission.contestProblemId || submission.problemId,
    participantId: submission.participantId,
    memberId: submission.participantId,
    source: submission.source || 'INTERNAL_JUDGE',
    status: submission.status || 'QUEUED',
    verdict: submission.verdict || 'PENDING',
    language: submission.language || 'cpp',
    timeMs: submission.timeMs,
    memoryKb: submission.memoryKb,
    externalCreatedAt: submission.externalCreatedAt,
    createdAt: submission.createdAt,
    judgedAt: submission.judgedAt
  };

  if (!fullAccess) return base;

  return {
    ...base,
    code: submission.code,
    stdout: submission.stdout,
    stderr: submission.stderr,
    compileOutput: submission.compileOutput,
    judgeMessage: submission.judgeMessage,
    testResults: submission.testResults || []
  };
}