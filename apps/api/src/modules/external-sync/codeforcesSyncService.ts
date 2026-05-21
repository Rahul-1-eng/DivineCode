import { ExternalSyncStatus, Platform, SubmissionSource, SubmissionStatus, Verdict } from '@prisma/client';
import { prisma } from '../../prisma/client';
import { recomputeContestStandings } from '../standings/standingService';

// Safely parses your problem configurations
function parseCodeforcesProblem(problem: any) {
  const externalId = String(problem.externalId || '').trim().toUpperCase();
  const idMatch = externalId.match(/^(\d+)([A-Z][0-9]?)$/);
  if (idMatch) return { contestCode: idMatch[1], problemIndex: idMatch[2] };

  const urlMatch = String(problem.externalUrl || '').match(/problem\/(\d+)\/([A-Z][0-9]?)/i);
  if (urlMatch) return { contestCode: urlMatch[1], problemIndex: urlMatch[2].toUpperCase() };

  return null;
}

// Maps raw Codeforces string verdicts directly to your application's Prisma Verdict schema
function mapCfVerdictToPrisma(cfVerdict: string | undefined): Verdict {
  if (!cfVerdict) return Verdict.WRONG_ANSWER; 
  switch (cfVerdict.toUpperCase()) {
    case 'OK':
      return Verdict.ACCEPTED;
    case 'WRONG_ANSWER':
      return Verdict.WRONG_ANSWER;
    case 'TIME_LIMIT_EXCEEDED':
      return Verdict.TIME_LIMIT_EXCEEDED;
    case 'MEMORY_LIMIT_EXCEEDED':
      return Verdict.MEMORY_LIMIT_EXCEEDED;
    case 'COMPILATION_ERROR':
      return Verdict.COMPILATION_ERROR;
    case 'RUNTIME_ERROR':
      return Verdict.RUNTIME_ERROR;
    default:
      return Verdict.WRONG_ANSWER; // Default to wrong answer fallback for standings penalties
  }
}

// Fetches the entire submission page for a user at once
async function fetchCodeforcesUserStatus(handle: string, count = 100) {
  const url = `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=${count}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Codeforces API status ${response.status}`);
  const payload = await response.json();
  if (payload.status !== 'OK') throw new Error(payload.comment || 'Codeforces fetch failed');
  return payload.result || [];
}

export async function syncCodeforcesContest(contestId: string) {
  const job = await prisma.externalSyncJob.create({
    data: {
      contestId,
      platform: Platform.CODEFORCES,
      targetKind: 'CONTEST',
      targetId: contestId,
      status: ExternalSyncStatus.RUNNING,
      startedAt: new Date()
    }
  });

  const synced: any[] = [];
  const errors: any[] = [];

  try {
    const contest = await prisma.contest.findUnique({
      where: { id: contestId },
      include: {
        participants: { include: { externalHandle: true } },
        problems: true
      }
    });

    if (!contest) throw new Error('Contest not found');

    // 1. Map out and index your problems for immediate O(1) lookup
    const problemLookup = new Map<string, any>();
    contest.problems
      .filter((p) => p.platform === Platform.CODEFORCES)
      .forEach((p) => {
        const parsed = parseCodeforcesProblem(p);
        if (parsed) {
          const key = `${parsed.contestCode}-${parsed.problemIndex}`.toUpperCase();
          problemLookup.set(key, p);
        }
      });

    // 2. Loop through participants (Only 1 API call per participant total!)
    for (const participant of contest.participants) {
      const handle = participant.externalHandle?.platform === Platform.CODEFORCES ? participant.externalHandle.handle : null;
      if (!handle) continue;

      try {
        // Fetch up to 100 recent submissions for this individual user (captures both OK and failed attempts)
        const submissions = await fetchCodeforcesUserStatus(handle, 100);

        for (const sub of submissions) {
          const subTime = new Date(sub.creationTimeSeconds * 1000);
          // Ensure submission fell cleanly within the active mashup window
          // if (subTime < contest.startTime || subTime > contest.endTime) continue;

          const cfContestId = sub.problem?.contestId;
          const cfIndex = sub.problem?.index;
          if (!cfContestId || !cfIndex) continue;

          const matchKey = `${cfContestId}-${cfIndex}`.toUpperCase();
          const targetContestProblem = problemLookup.get(matchKey);

          // If this external submission matches one of your mashup assignments, process it
          if (targetContestProblem) {
            const externalSubmissionId = String(sub.id);
            const targetVerdict = mapCfVerdictToPrisma(sub.verdict);
            const isAccepted = targetVerdict === Verdict.ACCEPTED;

            await prisma.$transaction(async (tx) => {
              // Track sync logging event history
              await tx.externalSyncEvent.upsert({
                where: {
                  platform_externalSubmissionId: {
                    platform: Platform.CODEFORCES,
                    externalSubmissionId
                  }
                },
                create: {
                  syncJobId: job.id,
                  platform: Platform.CODEFORCES,
                  externalSubmissionId,
                  accepted: isAccepted,
                  payload: sub as any,
                  processedAt: new Date()
                },
                update: {
                  syncJobId: job.id,
                  accepted: isAccepted,
                  payload: sub as any,
                  processedAt: new Date()
                }
              });

              const existingSubmission = await tx.submission.findUnique({
                where: {
                  source_externalSubmissionId: {
                    source: SubmissionSource.EXTERNAL_SYNC,
                    externalSubmissionId
                  }
                }
              });

              // Write the submission records into storage whether they passed or failed!
              if (!existingSubmission) {
                const created = await tx.submission.create({
                  data: {
                    userId: participant.userId,
                    participantId: participant.id,
                    contestId,
                    contestProblemId: targetContestProblem.id,
                    problemId: targetContestProblem.problemId,
                    source: SubmissionSource.EXTERNAL_SYNC,
                    status: SubmissionStatus.FINISHED,
                    verdict: targetVerdict,
                    language: sub.programmingLanguage || 'external',
                    externalSubmissionId,
                    externalCreatedAt: subTime,
                    judgedAt: new Date()
                  }
                });
                synced.push(created);
              }
            });
          }
        }

        // Rate-limiting cushion: pause half a second between users to protect your server IP
        await new Promise((resolve) => setTimeout(resolve, 500));

      } catch (error) {
        errors.push({
          participantId: participant.id,
          handle,
          error: error instanceof Error ? error.message : 'User submission history sync failed'
        });
      }
    }

    // 3. Recompute scores with new historical points/penalties factored in
    const standings = await recomputeContestStandings(contestId);

    await prisma.externalSyncJob.update({
      where: { id: job.id },
      data: {
        status: errors.length ? ExternalSyncStatus.FAILED : ExternalSyncStatus.SUCCESS,
        error: errors.length ? JSON.stringify(errors).slice(0, 2000) : null,
        finishedAt: new Date()
      }
    });

    return { jobId: job.id, synced, errors, standings };
  } catch (error) {
    await prisma.externalSyncJob.update({
      where: { id: job.id },
      data: {
        status: ExternalSyncStatus.FAILED,
        error: error instanceof Error ? error.message : 'Fatal codeforces sync failed',
        finishedAt: new Date()
      }
    });
    throw error;
  }
}