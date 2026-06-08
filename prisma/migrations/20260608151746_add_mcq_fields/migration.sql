/*
  Warnings:

  - You are about to drop the column `difficultyLabel` on the `InterviewQuestion` table. All the data in the column will be lost.
  - You are about to drop the `ContestProblem` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'REVIEWED', 'DISMISSED', 'ACTION_TAKEN');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'MANUAL');

-- DropForeignKey
ALTER TABLE "ContestProblem" DROP CONSTRAINT "ContestProblem_addedById_fkey";

-- DropForeignKey
ALTER TABLE "ContestProblem" DROP CONSTRAINT "ContestProblem_contestId_fkey";

-- DropForeignKey
ALTER TABLE "ContestProblem" DROP CONSTRAINT "ContestProblem_problemId_fkey";

-- DropForeignKey
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_contestProblemId_fkey";

-- DropIndex
DROP INDEX "Submission_contestId_idx";

-- AlterTable
ALTER TABLE "ContestParticipant" ADD COLUMN     "score" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "teamId" TEXT;

-- AlterTable
ALTER TABLE "ContestStanding" ADD COLUMN     "individualScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "individualSolved" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "testcasePenalty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "InterviewQuestion" DROP COLUMN "difficultyLabel",
ADD COLUMN     "correctIndex" INTEGER,
ADD COLUMN     "correctIndices" INTEGER[],
ADD COLUMN     "difficulty" TEXT NOT NULL DEFAULT 'Medium',
ADD COLUMN     "isApproved" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isMultiple" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "options" JSONB,
ADD COLUMN     "submittedById" TEXT;

-- AlterTable
ALTER TABLE "Problem" ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "aiComplexity" TEXT,
ADD COLUMN     "aiFeedback" TEXT,
ADD COLUMN     "aiSimilarityScore" DOUBLE PRECISION,
ADD COLUMN     "isFlagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPlagiarized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "manualPoints" INTEGER,
ADD COLUMN     "teamId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "coins" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "ContestProblem";

-- CreateTable
CREATE TABLE "UnlockedTestcase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "contestProblemId" TEXT NOT NULL,
    "testcaseId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnlockedTestcase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionReport" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmissionReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestTeam" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "penalty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContestTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamProblemSolve" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "contestProblemId" TEXT NOT NULL,
    "firstSolverId" TEXT NOT NULL,
    "solvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamProblemSolve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMessage" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_problems" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "problemId" TEXT,
    "interviewQuestionId" TEXT,
    "titleSnapshot" TEXT NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'DIVINECODE',
    "externalId" TEXT,
    "externalUrl" TEXT,
    "imageUrl" TEXT,
    "requiresRedirect" BOOLEAN NOT NULL DEFAULT false,
    "aiExtractionStatus" "ExtractionStatus" NOT NULL DEFAULT 'COMPLETED',
    "index" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1000,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "addedById" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isMCQ" BOOLEAN NOT NULL DEFAULT false,
    "mcqTimeLimitSeconds" INTEGER NOT NULL DEFAULT 0,
    "mcqData" JSONB,
    "customTitle" TEXT,
    "customDescription" TEXT,
    "customTestCases" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "contest_problems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProblemDataset" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "descriptionHtml" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "originalUrl" TEXT,
    "tags" TEXT[],
    "difficulty" TEXT NOT NULL,
    "testcases" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiProblemDataset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnlockedTestcase_teamId_idx" ON "UnlockedTestcase"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "UnlockedTestcase_userId_testcaseId_key" ON "UnlockedTestcase"("userId", "testcaseId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionReport_submissionId_reporterId_key" ON "SubmissionReport"("submissionId", "reporterId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestTeam_inviteCode_key" ON "ContestTeam"("inviteCode");

-- CreateIndex
CREATE INDEX "ContestTeam_contestId_idx" ON "ContestTeam"("contestId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamProblemSolve_teamId_contestProblemId_key" ON "TeamProblemSolve"("teamId", "contestProblemId");

-- CreateIndex
CREATE INDEX "TeamMessage_teamId_createdAt_idx" ON "TeamMessage"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "contest_problems_contestId_idx" ON "contest_problems"("contestId");

-- CreateIndex
CREATE INDEX "contest_problems_problemId_idx" ON "contest_problems"("problemId");

-- CreateIndex
CREATE UNIQUE INDEX "contest_problems_contestId_index_key" ON "contest_problems"("contestId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "contest_problems_contestId_label_key" ON "contest_problems"("contestId", "label");

-- CreateIndex
CREATE INDEX "ContestParticipant_contestId_idx" ON "ContestParticipant"("contestId");

-- CreateIndex
CREATE INDEX "ContestParticipant_userId_idx" ON "ContestParticipant"("userId");

-- CreateIndex
CREATE INDEX "Submission_contestId_createdAt_idx" ON "Submission"("contestId", "createdAt");

-- AddForeignKey
ALTER TABLE "UnlockedTestcase" ADD CONSTRAINT "UnlockedTestcase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnlockedTestcase" ADD CONSTRAINT "UnlockedTestcase_testcaseId_fkey" FOREIGN KEY ("testcaseId") REFERENCES "Testcase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnlockedTestcase" ADD CONSTRAINT "UnlockedTestcase_contestProblemId_fkey" FOREIGN KEY ("contestProblemId") REFERENCES "contest_problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnlockedTestcase" ADD CONSTRAINT "UnlockedTestcase_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "ContestTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_contestProblemId_fkey" FOREIGN KEY ("contestProblemId") REFERENCES "contest_problems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "ContestTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionReport" ADD CONSTRAINT "SubmissionReport_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionReport" ADD CONSTRAINT "SubmissionReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestTeam" ADD CONSTRAINT "ContestTeam_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamProblemSolve" ADD CONSTRAINT "TeamProblemSolve_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "ContestTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamProblemSolve" ADD CONSTRAINT "TeamProblemSolve_contestProblemId_fkey" FOREIGN KEY ("contestProblemId") REFERENCES "contest_problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamProblemSolve" ADD CONSTRAINT "TeamProblemSolve_firstSolverId_fkey" FOREIGN KEY ("firstSolverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMessage" ADD CONSTRAINT "TeamMessage_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMessage" ADD CONSTRAINT "TeamMessage_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "ContestTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMessage" ADD CONSTRAINT "TeamMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipant" ADD CONSTRAINT "ContestParticipant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "ContestTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_problems" ADD CONSTRAINT "contest_problems_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_problems" ADD CONSTRAINT "contest_problems_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_problems" ADD CONSTRAINT "contest_problems_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_problems" ADD CONSTRAINT "contest_problems_interviewQuestionId_fkey" FOREIGN KEY ("interviewQuestionId") REFERENCES "InterviewQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
