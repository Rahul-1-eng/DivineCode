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
  return new Date(new Date(contest.startTime).getTime() + contest.durationMinutes * 60000);
}

export function contestHasEnded(contest: any, now = new Date()) {
  return now.getTime() >= contestEndTime(contest).getTime();
}

export function contestHasStarted(contest: any, now = new Date()) {
  return now.getTime() >= new Date(contest.startTime).getTime();
}

export function isContestOwner(contest: any, viewer: ViewerContext) {
  const viewerUserId = normalize(viewer.userId);
  const viewerEmail = normalize(viewer.email);
  return Boolean(
    (viewerUserId && normalize(contest.createdById) === viewerUserId) ||
      (viewerEmail && normalize(contest.createdBy?.email) === viewerEmail)
  );
}

export function findViewerParticipant(contest: any, viewer: ViewerContext) {
  const viewerUserId = normalize(viewer.userId);
  const viewerEmail = normalize(viewer.email);
  const viewerName = normalize(viewer.name);

  return (contest.participants || []).find((participant: any) => {
    return Boolean(
      (viewerUserId && normalize(participant.userId) === viewerUserId) ||
        (viewerEmail && normalize(participant.user?.email) === viewerEmail) ||
        (viewerName && normalize(participant.displayName) === viewerName) ||
        (viewerName && normalize(participant.externalHandle?.handle) === viewerName)
    );
  });
}

export function canManageContest(contest: any, viewer: ViewerContext) {
  return isContestOwner(contest, viewer);
}

export function canSeeProblemMeta(contest: any, viewer: ViewerContext, now = new Date()) {
  if (canManageContest(contest, viewer)) return true;
  if (!contest.hideProblemMetaDuringContest) return true;
  return contestHasEnded(contest, now);
}

function sanitizeProblem(problem: any, showMeta: boolean) {
  const base = {
    id: problem.id,
    index: problem.index,
    label: problem.label,
    title: problem.titleSnapshot,
    platform: problem.platform,
    externalId: problem.externalId,
    externalUrl: problem.externalUrl,
    url: problem.externalUrl,
    isLocked: problem.isLocked
  };

  if (!showMeta) return base;

  return {
    ...base,
    points: problem.points,
    rating: problem.problem?.difficultyRating || null,
    difficulty: problem.problem?.difficultyLabel || null,
    tags: problem.problem?.tags || [],
    problem: problem.problem
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
          tags: problem.problem.tags,
          timeLimitMs: problem.problem.timeLimitMs,
          memoryLimitMb: problem.problem.memoryLimitMb,
          editorial: problem.problem.editorial || null,
          officialSolutions: problem.problem.officialSolutions || []
        }
      : null
  };
}

export function sanitizeContestForViewer(contest: any, viewer: ViewerContext, now = new Date()) {
  const canManage = canManageContest(contest, viewer);
  const participant = findViewerParticipant(contest, viewer) || null;
  const showMeta = canSeeProblemMeta(contest, viewer, now);
  const participantById = new Map((contest.participants || []).map((row: any) => [row.id, row]));
  const members = (contest.participants || []).map((participantRow: any) => ({
    id: participantRow.id,
    name: participantRow.displayName,
    displayName: participantRow.displayName,
    team: participantRow.teamName,
    teamName: participantRow.teamName,
    email: participantRow.user?.email || '',
    codeforcesHandle: participantRow.externalHandle?.handle || '',
    handle: participantRow.externalHandle?.handle || '',
    role: participantRow.role,
    isOfficial: participantRow.isOfficial,
    ratingBefore: participantRow.ratingBefore,
    ratingAfter: contestHasEnded(contest, now) || canManage ? participantRow.ratingAfter : null
  }));

  return {
    id: contest.id,
    inviteCode: contest.inviteCode,
    title: contest.title,
    description: contest.description,
    type: contest.type,
    status: contest.status,
    startTime: contest.startTime,
    endTime: contestEndTime(contest),
    freezeTime: contest.freezeTime,
    durationMinutes: contest.durationMinutes,
    isRated: contest.isRated,
    allowLateJoin: contest.allowLateJoin,
    allowTeamSubmissionView: contest.allowTeamSubmissionView,
    createdAt: contest.createdAt,
    canManage,
    viewerMember: participant
      ? {
          id: participant.id,
          name: participant.displayName,
          displayName: participant.displayName,
          team: participant.teamName,
          teamName: participant.teamName,
          email: participant.user?.email || '',
          codeforcesHandle: participant.externalHandle?.handle || '',
          handle: participant.externalHandle?.handle || ''
        }
      : null,
    visibility: {
      canSeeProblemMeta: showMeta,
      canViewAllSubmissions: canManage,
      submissionScope: canManage ? 'all' : participant?.teamName && contest.allowTeamSubmissionView ? 'team' : participant ? 'own' : 'none'
    },
    owner: canManage
      ? contest.createdBy
      : contest.createdBy
        ? { id: contest.createdBy.id, username: contest.createdBy.username, name: contest.createdBy.name }
        : null,
    viewer: {
      canManage,
      participantId: participant?.id || null,
      role: participant?.role || (canManage ? 'OWNER' : null),
      canSeeProblemMeta: showMeta,
      submissionScope: canManage ? 'all' : participant?.teamName && contest.allowTeamSubmissionView ? 'team' : participant ? 'own' : 'none'
    },
    participants: members,
    members,
    problems: (contest.problems || []).map((problem: any) => sanitizeProblem(problem, showMeta)),
    standings: (contest.standings || []).map((standing: any) => {
      const standingParticipant = standing.participant || participantById.get(standing.participantId) || {};
      return {
        ...standing,
        memberId: standing.participantId,
        name: standingParticipant.displayName || standing.participantId,
        team: standingParticipant.teamName || 'Individuals'
      };
    })
  };
}

export function sanitizeSubmissionForViewer(submission: any, fullAccess: boolean) {
  const base = {
    id: submission.id,
    contestId: submission.contestId,
    contestProblemId: submission.contestProblemId,
    problemId: submission.contestProblemId || submission.problemId,
    participantId: submission.participantId,
    memberId: submission.participantId,
    source: submission.source,
    status: submission.status,
    verdict: submission.verdict,
    language: submission.language,
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
