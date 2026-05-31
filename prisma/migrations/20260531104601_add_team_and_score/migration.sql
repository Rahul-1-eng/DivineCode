/*
  Warnings:

  - You are about to drop the column `checkerCode` on the `Problem` table. All the data in the column will be lost.
  - You are about to drop the column `constraints` on the `Problem` table. All the data in the column will be lost.
  - You are about to drop the column `createdById` on the `Problem` table. All the data in the column will be lost.
  - You are about to drop the column `difficultyLabel` on the `Problem` table. All the data in the column will be lost.
  - You are about to drop the column `difficultyRating` on the `Problem` table. All the data in the column will be lost.
  - You are about to drop the column `externalId` on the `Problem` table. All the data in the column will be lost.
  - You are about to drop the column `externalUrl` on the `Problem` table. All the data in the column will be lost.
  - You are about to drop the column `generatorCode` on the `Problem` table. All the data in the column will be lost.
  - You are about to drop the column `inputFormat` on the `Problem` table. All the data in the column will be lost.
  - You are about to drop the column `memoryLimitMb` on the `Problem` table. All the data in the column will be lost.
  - You are about to drop the column `outputFormat` on the `Problem` table. All the data in the column will be lost.
  - You are about to drop the column `statement` on the `Problem` table. All the data in the column will be lost.
  - You are about to drop the column `timeLimitMs` on the `Problem` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Problem` table. All the data in the column will be lost.
  - You are about to drop the column `validatorCode` on the `Problem` table. All the data in the column will be lost.
  - The primary key for the `ProblemTopic` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `weight` on the `ProblemTopic` table. All the data in the column will be lost.
  - You are about to drop the column `compileOutput` on the `Submission` table. All the data in the column will be lost.
  - You are about to drop the column `stderr` on the `Submission` table. All the data in the column will be lost.
  - You are about to drop the column `stdout` on the `Submission` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[problemCode]` on the table `Problem` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[problemId,topicId]` on the table `ProblemTopic` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `description` to the `Problem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `problemCode` to the `Problem` table without a default value. This is not possible if the table is not empty.
  - The required column `id` was added to the `ProblemTopic` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Made the column `userId` on table `Submission` required. This step will fail if there are existing NULL values in that column.
  - Made the column `code` on table `Submission` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Problem" DROP CONSTRAINT "Problem_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_userId_fkey";

-- DropIndex
DROP INDEX "Problem_platform_externalId_key";

-- DropIndex
DROP INDEX "Problem_platform_idx";

-- DropIndex
DROP INDEX "Problem_visibility_difficultyRating_idx";

-- DropIndex
DROP INDEX "Submission_contestId_participantId_contestProblemId_idx";

-- DropIndex
DROP INDEX "Submission_createdAt_idx";

-- DropIndex
DROP INDEX "Submission_problemId_verdict_idx";

-- AlterTable
ALTER TABLE "Problem" DROP COLUMN "checkerCode",
DROP COLUMN "constraints",
DROP COLUMN "createdById",
DROP COLUMN "difficultyLabel",
DROP COLUMN "difficultyRating",
DROP COLUMN "externalId",
DROP COLUMN "externalUrl",
DROP COLUMN "generatorCode",
DROP COLUMN "inputFormat",
DROP COLUMN "memoryLimitMb",
DROP COLUMN "outputFormat",
DROP COLUMN "statement",
DROP COLUMN "timeLimitMs",
DROP COLUMN "updatedAt",
DROP COLUMN "validatorCode",
ADD COLUMN     "authorId" TEXT,
ADD COLUMN     "boilerplateJson" TEXT,
ADD COLUMN     "description" TEXT NOT NULL,
ADD COLUMN     "problemCode" TEXT NOT NULL,
ADD COLUMN     "rating" INTEGER,
ADD COLUMN     "url" TEXT,
ALTER COLUMN "slug" DROP NOT NULL,
ALTER COLUMN "visibility" SET DEFAULT 'PUBLIC';

-- AlterTable
ALTER TABLE "ProblemTopic" DROP CONSTRAINT "ProblemTopic_pkey",
DROP COLUMN "weight",
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "ProblemTopic_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Submission" DROP COLUMN "compileOutput",
DROP COLUMN "stderr",
DROP COLUMN "stdout",
ALTER COLUMN "userId" SET NOT NULL,
ALTER COLUMN "code" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Problem_problemCode_key" ON "Problem"("problemCode");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemTopic_problemId_topicId_key" ON "ProblemTopic"("problemId", "topicId");

-- CreateIndex
CREATE INDEX "Submission_userId_idx" ON "Submission"("userId");

-- CreateIndex
CREATE INDEX "Submission_contestId_idx" ON "Submission"("contestId");

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
