-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'PROBLEM_SETTER', 'ADMIN');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('DIVINECODE', 'CODEFORCES', 'LEETCODE', 'ATCODER', 'CODECHEF', 'HACKERRANK', 'OTHER');

-- CreateEnum
CREATE TYPE "HandleVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProblemSource" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "ProblemVisibility" AS ENUM ('DRAFT', 'PRIVATE', 'PUBLIC', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TestcaseType" AS ENUM ('SAMPLE', 'PRETEST', 'HIDDEN', 'SYSTEM', 'STRESS');

-- CreateEnum
CREATE TYPE "CheckerType" AS ENUM ('EXACT', 'TOKEN', 'FLOAT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ContestType" AS ENUM ('SOLO', 'GROUP', 'MASHUP', 'DUEL_TOURNAMENT');

-- CreateEnum
CREATE TYPE "ContestStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'FROZEN', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContestParticipantRole" AS ENUM ('OWNER', 'MANAGER', 'PARTICIPANT', 'OBSERVER');

-- CreateEnum
CREATE TYPE "SubmissionSource" AS ENUM ('INTERNAL_JUDGE', 'EXTERNAL_SYNC', 'MANUAL_ADMIN');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('QUEUED', 'RUNNING', 'FINISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('ACCEPTED', 'WRONG_ANSWER', 'COMPILATION_ERROR', 'RUNTIME_ERROR', 'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED', 'PRESENTATION_ERROR', 'JUDGE_ERROR', 'SECURITY_VIOLATION', 'PENDING', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ExternalSyncStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'PAUSED');

-- CreateEnum
CREATE TYPE "DuelMode" AS ENUM ('MCQ', 'DEBUGGING', 'COUNTEREXAMPLE', 'CODE_SPRINT', 'HYBRID');

-- CreateEnum
CREATE TYPE "DuelStatus" AS ENUM ('WAITING', 'RUNNING', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RatingEventType" AS ENUM ('CONTEST', 'DUEL', 'EXTERNAL_SYNC', 'ADMIN');

-- CreateEnum
CREATE TYPE "InterviewTrackType" AS ENUM ('DSA', 'OOPS', 'DATABASE', 'COMPILER', 'OPERATING_SYSTEM', 'NETWORKS', 'SYSTEM_DESIGN', 'BEHAVIORAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT,
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "rating" INTEGER NOT NULL DEFAULT 1200,
    "duelRating" INTEGER NOT NULL DEFAULT 1200,
    "globalRating" INTEGER NOT NULL DEFAULT 1200,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalHandle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "handle" TEXT NOT NULL,
    "externalUserId" TEXT,
    "rating" INTEGER,
    "maxRating" INTEGER,
    "status" "HandleVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "rawProfile" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalHandle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "inputFormat" TEXT,
    "outputFormat" TEXT,
    "constraints" TEXT,
    "difficultyRating" INTEGER,
    "difficultyLabel" TEXT,
    "tags" TEXT[],
    "source" "ProblemSource" NOT NULL DEFAULT 'INTERNAL',
    "platform" "Platform" NOT NULL DEFAULT 'DIVINECODE',
    "externalId" TEXT,
    "externalUrl" TEXT,
    "visibility" "ProblemVisibility" NOT NULL DEFAULT 'DRAFT',
    "timeLimitMs" INTEGER NOT NULL DEFAULT 2000,
    "memoryLimitMb" INTEGER NOT NULL DEFAULT 256,
    "checkerType" "CheckerType" NOT NULL DEFAULT 'EXACT',
    "checkerCode" TEXT,
    "validatorCode" TEXT,
    "generatorCode" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemTopic" (
    "problemId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "ProblemTopic_pkey" PRIMARY KEY ("problemId","topicId")
);

-- CreateTable
CREATE TABLE "Testcase" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "type" "TestcaseType" NOT NULL DEFAULT 'HIDDEN',
    "input" TEXT NOT NULL,
    "expectedOutput" TEXT NOT NULL,
    "explanation" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Testcase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficialSolution" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "complexity" TEXT,
    "explanation" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficialSolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Editorial" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "hints" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Editorial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contest" (
    "id" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "ContestType" NOT NULL DEFAULT 'GROUP',
    "status" "ContestStatus" NOT NULL DEFAULT 'DRAFT',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "freezeTime" TIMESTAMP(3),
    "durationMinutes" INTEGER NOT NULL,
    "isRated" BOOLEAN NOT NULL DEFAULT false,
    "allowLateJoin" BOOLEAN NOT NULL DEFAULT false,
    "hideProblemMetaDuringContest" BOOLEAN NOT NULL DEFAULT true,
    "allowTeamSubmissionView" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestParticipant" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "userId" TEXT,
    "externalHandleId" TEXT,
    "displayName" TEXT NOT NULL,
    "teamName" TEXT,
    "role" "ContestParticipantRole" NOT NULL DEFAULT 'PARTICIPANT',
    "isOfficial" BOOLEAN NOT NULL DEFAULT true,
    "ratingBefore" INTEGER,
    "ratingAfter" INTEGER,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestProblem" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "problemId" TEXT,
    "titleSnapshot" TEXT NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'DIVINECODE',
    "externalId" TEXT,
    "externalUrl" TEXT,
    "index" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1000,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "addedById" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "participantId" TEXT,
    "problemId" TEXT,
    "contestId" TEXT,
    "contestProblemId" TEXT,
    "source" "SubmissionSource" NOT NULL DEFAULT 'INTERNAL_JUDGE',
    "status" "SubmissionStatus" NOT NULL DEFAULT 'QUEUED',
    "verdict" "Verdict" NOT NULL DEFAULT 'PENDING',
    "language" TEXT NOT NULL,
    "code" TEXT,
    "externalSubmissionId" TEXT,
    "externalCreatedAt" TIMESTAMP(3),
    "timeMs" INTEGER,
    "memoryKb" INTEGER,
    "stdout" TEXT,
    "stderr" TEXT,
    "compileOutput" TEXT,
    "judgeMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "judgedAt" TIMESTAMP(3),

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionTestResult" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "testcaseId" TEXT,
    "index" INTEGER NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "timeMs" INTEGER,
    "memoryKb" INTEGER,
    "stdout" TEXT,
    "stderr" TEXT,
    "checkerMessage" TEXT,

    CONSTRAINT "SubmissionTestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestStanding" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "rank" INTEGER,
    "solved" INTEGER NOT NULL DEFAULT 0,
    "penalty" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "solvedProblemIds" TEXT[],
    "lastAcceptedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContestStanding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalSyncJob" (
    "id" TEXT NOT NULL,
    "contestId" TEXT,
    "platform" "Platform" NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" "ExternalSyncStatus" NOT NULL DEFAULT 'PENDING',
    "cursor" TEXT,
    "lastSubmissionId" TEXT,
    "error" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalSyncEvent" (
    "id" TEXT NOT NULL,
    "syncJobId" TEXT,
    "platform" "Platform" NOT NULL,
    "externalSubmissionId" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalSyncEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuelMatch" (
    "id" TEXT NOT NULL,
    "mode" "DuelMode" NOT NULL DEFAULT 'MCQ',
    "status" "DuelStatus" NOT NULL DEFAULT 'WAITING',
    "roomId" TEXT NOT NULL,
    "createdById" TEXT,
    "questionSeconds" INTEGER NOT NULL DEFAULT 20,
    "isRated" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuelMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuelPlayer" (
    "id" TEXT NOT NULL,
    "duelId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "socketId" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "ratingBefore" INTEGER,
    "ratingAfter" INTEGER,
    "rank" INTEGER,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "DuelPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuelRound" (
    "id" TEXT NOT NULL,
    "duelId" TEXT NOT NULL,
    "problemId" TEXT,
    "prompt" TEXT NOT NULL,
    "options" JSONB,
    "correctAnswer" JSONB,
    "topic" TEXT,
    "difficultyRating" INTEGER,
    "order" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "DuelRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuelAnswer" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "answer" JSONB NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "responseMs" INTEGER,
    "scoreDelta" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuelAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatingHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" "RatingEventType" NOT NULL,
    "oldRating" INTEGER NOT NULL,
    "newRating" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "contestId" TEXT,
    "duelId" TEXT,
    "externalPlatform" "Platform",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RatingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicMastery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "ability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "solved" INTEGER NOT NULL DEFAULT 0,
    "lastPracticedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicMastery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ratingFloor" INTEGER NOT NULL,
    "ratingCeil" INTEGER NOT NULL,
    "topicWeights" JSONB NOT NULL,
    "problemIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewTrack" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "InterviewTrackType" NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InterviewTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewQuestion" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "difficultyLabel" TEXT,
    "expectedAnswer" TEXT,
    "tags" TEXT[],
    "sourceCompany" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "confidence" INTEGER,
    "notes" TEXT,
    "lastReviewedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "contestId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "ExternalHandle_userId_idx" ON "ExternalHandle"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalHandle_platform_handle_key" ON "ExternalHandle"("platform", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalHandle_userId_platform_key" ON "ExternalHandle"("userId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_slug_key" ON "Topic"("slug");

-- CreateIndex
CREATE INDEX "Topic_parentId_idx" ON "Topic"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Problem_slug_key" ON "Problem"("slug");

-- CreateIndex
CREATE INDEX "Problem_visibility_difficultyRating_idx" ON "Problem"("visibility", "difficultyRating");

-- CreateIndex
CREATE INDEX "Problem_platform_idx" ON "Problem"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "Problem_platform_externalId_key" ON "Problem"("platform", "externalId");

-- CreateIndex
CREATE INDEX "Testcase_problemId_type_idx" ON "Testcase"("problemId", "type");

-- CreateIndex
CREATE INDEX "OfficialSolution_problemId_idx" ON "OfficialSolution"("problemId");

-- CreateIndex
CREATE UNIQUE INDEX "Editorial_problemId_key" ON "Editorial"("problemId");

-- CreateIndex
CREATE UNIQUE INDEX "Contest_inviteCode_key" ON "Contest"("inviteCode");

-- CreateIndex
CREATE INDEX "Contest_status_startTime_idx" ON "Contest"("status", "startTime");

-- CreateIndex
CREATE INDEX "Contest_createdById_idx" ON "Contest"("createdById");

-- CreateIndex
CREATE INDEX "ContestParticipant_contestId_teamName_idx" ON "ContestParticipant"("contestId", "teamName");

-- CreateIndex
CREATE INDEX "ContestParticipant_externalHandleId_idx" ON "ContestParticipant"("externalHandleId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestParticipant_contestId_userId_key" ON "ContestParticipant"("contestId", "userId");

-- CreateIndex
CREATE INDEX "ContestProblem_contestId_idx" ON "ContestProblem"("contestId");

-- CreateIndex
CREATE INDEX "ContestProblem_problemId_idx" ON "ContestProblem"("problemId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestProblem_contestId_index_key" ON "ContestProblem"("contestId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "ContestProblem_contestId_label_key" ON "ContestProblem"("contestId", "label");

-- CreateIndex
CREATE INDEX "Submission_contestId_participantId_contestProblemId_idx" ON "Submission"("contestId", "participantId", "contestProblemId");

-- CreateIndex
CREATE INDEX "Submission_problemId_verdict_idx" ON "Submission"("problemId", "verdict");

-- CreateIndex
CREATE INDEX "Submission_createdAt_idx" ON "Submission"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_source_externalSubmissionId_key" ON "Submission"("source", "externalSubmissionId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionTestResult_submissionId_index_key" ON "SubmissionTestResult"("submissionId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "ContestStanding_participantId_key" ON "ContestStanding"("participantId");

-- CreateIndex
CREATE INDEX "ContestStanding_contestId_rank_idx" ON "ContestStanding"("contestId", "rank");

-- CreateIndex
CREATE INDEX "ContestStanding_contestId_solved_penalty_idx" ON "ContestStanding"("contestId", "solved", "penalty");

-- CreateIndex
CREATE INDEX "ExternalSyncJob_platform_targetKind_targetId_idx" ON "ExternalSyncJob"("platform", "targetKind", "targetId");

-- CreateIndex
CREATE INDEX "ExternalSyncJob_status_nextRunAt_idx" ON "ExternalSyncJob"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "ExternalSyncEvent_syncJobId_idx" ON "ExternalSyncEvent"("syncJobId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSyncEvent_platform_externalSubmissionId_key" ON "ExternalSyncEvent"("platform", "externalSubmissionId");

-- CreateIndex
CREATE UNIQUE INDEX "DuelMatch_roomId_key" ON "DuelMatch"("roomId");

-- CreateIndex
CREATE INDEX "DuelPlayer_duelId_score_idx" ON "DuelPlayer"("duelId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "DuelPlayer_duelId_userId_key" ON "DuelPlayer"("duelId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DuelRound_duelId_order_key" ON "DuelRound"("duelId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "DuelAnswer_roundId_playerId_key" ON "DuelAnswer"("roundId", "playerId");

-- CreateIndex
CREATE INDEX "RatingHistory_userId_createdAt_idx" ON "RatingHistory"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TopicMastery_userId_topicId_key" ON "TopicMastery"("userId", "topicId");

-- CreateIndex
CREATE INDEX "RecommendationSnapshot_userId_createdAt_idx" ON "RecommendationSnapshot"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewTrack_slug_key" ON "InterviewTrack"("slug");

-- CreateIndex
CREATE INDEX "InterviewQuestion_trackId_idx" ON "InterviewQuestion"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewProgress_userId_questionId_key" ON "InterviewProgress"("userId", "questionId");

-- CreateIndex
CREATE INDEX "AuditLog_contestId_createdAt_idx" ON "AuditLog"("contestId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "ExternalHandle" ADD CONSTRAINT "ExternalHandle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTopic" ADD CONSTRAINT "ProblemTopic_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTopic" ADD CONSTRAINT "ProblemTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Testcase" ADD CONSTRAINT "Testcase_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficialSolution" ADD CONSTRAINT "OfficialSolution_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Editorial" ADD CONSTRAINT "Editorial_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipant" ADD CONSTRAINT "ContestParticipant_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipant" ADD CONSTRAINT "ContestParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipant" ADD CONSTRAINT "ContestParticipant_externalHandleId_fkey" FOREIGN KEY ("externalHandleId") REFERENCES "ExternalHandle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ContestParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_contestProblemId_fkey" FOREIGN KEY ("contestProblemId") REFERENCES "ContestProblem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionTestResult" ADD CONSTRAINT "SubmissionTestResult_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionTestResult" ADD CONSTRAINT "SubmissionTestResult_testcaseId_fkey" FOREIGN KEY ("testcaseId") REFERENCES "Testcase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestStanding" ADD CONSTRAINT "ContestStanding_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestStanding" ADD CONSTRAINT "ContestStanding_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ContestParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSyncJob" ADD CONSTRAINT "ExternalSyncJob_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSyncEvent" ADD CONSTRAINT "ExternalSyncEvent_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "ExternalSyncJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelMatch" ADD CONSTRAINT "DuelMatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelPlayer" ADD CONSTRAINT "DuelPlayer_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "DuelMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelPlayer" ADD CONSTRAINT "DuelPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelRound" ADD CONSTRAINT "DuelRound_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "DuelMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelRound" ADD CONSTRAINT "DuelRound_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelAnswer" ADD CONSTRAINT "DuelAnswer_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "DuelRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelAnswer" ADD CONSTRAINT "DuelAnswer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "DuelPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingHistory" ADD CONSTRAINT "RatingHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingHistory" ADD CONSTRAINT "RatingHistory_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingHistory" ADD CONSTRAINT "RatingHistory_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "DuelMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicMastery" ADD CONSTRAINT "TopicMastery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicMastery" ADD CONSTRAINT "TopicMastery_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationSnapshot" ADD CONSTRAINT "RecommendationSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "InterviewTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewProgress" ADD CONSTRAINT "InterviewProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewProgress" ADD CONSTRAINT "InterviewProgress_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "InterviewQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
