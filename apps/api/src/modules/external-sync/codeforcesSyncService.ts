import { ExternalSyncStatus, Platform, SubmissionSource, SubmissionStatus, Verdict } from '@prisma/client';
import crypto from 'crypto';
import { prisma } from '../../prisma/client';
import { recomputeContestStandings } from '../standings/standingService';

// 👉 FIXED: Added robust regex to parse Gym & Mashup URLs securely
function parseCodeforcesProblem(problem: any) {
  const externalId = String(problem.externalId || '').trim().toUpperCase();
  const idMatch = externalId.match(/^(\d+)([A-Z][0-9]?)$/);
  if (idMatch) return { contestCode: idMatch[1], problemIndex: idMatch[2] };

  const urlMatch = String(problem.externalUrl || '').match(/(?:problem|contest)\/(\d+)\/(?:problem\/)?([A-Z][0-9]?)/i);
  if (urlMatch) return { contestCode: urlMatch[1], problemIndex: urlMatch[2].toUpperCase() };

  // Enables matching for: https://codeforces.com/gym/100000/problem/A
  const gymMatch = String(problem.externalUrl || '').match(/gym\/(\d+)\/problem\/([A-Z][0-9]?)/i);
  if (gymMatch) return { contestCode: gymMatch[1], problemIndex: gymMatch[2].toUpperCase() };

  return null;
}

// Maps raw Codeforces string verdicts directly to your application's Prisma Verdict schema
function mapCfVerdictToPrisma(cfVerdict: string | undefined): Verdict {
  if (!cfVerdict) return Verdict.WRONG_ANSWER; 
  switch (cfVerdict.toUpperCase()) {
    case 'OK': return Verdict.ACCEPTED;
    case 'WRONG_ANSWER': return Verdict.WRONG_ANSWER;
    case 'TIME_LIMIT_EXCEEDED': return Verdict.TIME_LIMIT_EXCEEDED;
    case 'MEMORY_LIMIT_EXCEEDED': return Verdict.MEMORY_LIMIT_EXCEEDED;
    case 'COMPILATION_ERROR': return Verdict.COMPILATION_ERROR;
    case 'RUNTIME_ERROR': return Verdict.RUNTIME_ERROR;
    default: return Verdict.WRONG_ANSWER; 
  }
}

// 👉 FIXED: Added SHA-512 API Key signing so you can fetch submissions from PRIVATE Mashups
async function fetchCodeforcesUserStatus(handle: string, count = 100) {
  const apiKey = process.env.CF_API_KEY;
  const apiSecret = process.env.CF_API_SECRET;

  let url = `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=${count}`;

  // If environment variables are set, authorize the request to see private gym solves
  if (apiKey && apiSecret) {
    const time = Math.floor(Date.now() / 1000);
    const rand = Math.random().toString(36).substring(2, 8);
    const params = `apiKey=${apiKey}&count=${count}&from=1&handle=${handle}&time=${time}`;
    
    const hash = crypto.createHash('sha512').update(`${rand}/user.status?${params}#${apiSecret}`).digest('hex');
    url = `https://codeforces.com/api/user.status?${params}&apiSig=${rand}${hash}`;
  }

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

    // 2. Loop through participants (Only 1 API call per participant total)
    for (const participant of contest.participants) {
      const handle = participant.externalHandle?.platform === Platform.CODEFORCES ? participant.externalHandle.handle : null;
      if (!handle) continue;

      try {
        const submissions = await fetchCodeforcesUserStatus(handle, 100);

        for (const sub of submissions) {
          const subTime = new Date(sub.creationTimeSeconds * 1000);

          const cfContestId = sub.problem?.contestId;
          const cfIndex = sub.problem?.index;
          if (!cfContestId || !cfIndex) continue;

          const matchKey = `${cfContestId}-${cfIndex}`.toUpperCase();
          const targetContestProblem = problemLookup.get(matchKey);

          if (targetContestProblem) {
            const externalSubmissionId = String(sub.id);
            const targetVerdict = mapCfVerdictToPrisma(sub.verdict);
            const isAccepted = targetVerdict === Verdict.ACCEPTED;

            // 👉 FIXED: Codeforces separates standard contests (< 100000) from Gyms/Mashups (>= 100000)
            const isGym = Number(cfContestId) >= 100000;
            const submissionUrl = isGym 
              ? `https://codeforces.com/gym/${cfContestId}/submission/${externalSubmissionId}`
              : `https://codeforces.com/contest/${cfContestId}/submission/${externalSubmissionId}`;

            // Inject the exact URL directly into the code block so the UI has it ready
            const codePayload = `// ----------------------------------------------------
// External submission synced from Codeforces
// 👉 View original submission here:
// ${submissionUrl}
// ----------------------------------------------------`;

            await prisma.$transaction(async (tx) => {
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

              const existingSubmission = await tx.submission.findFirst({
                where: {
                  source: SubmissionSource.EXTERNAL_SYNC,
                  externalSubmissionId
                }
              });

              if (!existingSubmission) {
                const created = await tx.submission.create({
                  data: {
                    userId: participant.userId as string,
                    participantId: participant.id,
                    // 👉 OPTIMIZATION: Strict team mapping fallback to prevent background worker typing errors
                    teamId: participant.teamId || null,
                    contestId,
                    contestProblemId: targetContestProblem.id,
                    problemId: targetContestProblem.problemId || null,
                    code: codePayload, 
                    source: SubmissionSource.EXTERNAL_SYNC,
                    status: SubmissionStatus.FINISHED,
                    verdict: targetVerdict,
                    language: sub.programmingLanguage || 'external',
                    externalSubmissionId,
                    externalCreatedAt: subTime,
                    createdAt: subTime, 
                    judgedAt: new Date()
                  }
                });
                synced.push(created);
              }
            });
          }
        }

        // Rate-limiting cushion
        await new Promise((resolve) => setTimeout(resolve, 500));

      } catch (error) {
        errors.push({
          participantId: participant.id,
          handle,
          error: error instanceof Error ? error.message : 'User submission history sync failed'
        });
      }
    }

    // 👉 OPTIMIZATION: Conditional Recomputation
    // Only hammer the database to rebuild the scoreboard if we ACTUALLY synced new records.
    let standings = null;
    if (synced.length > 0) {
      standings = await recomputeContestStandings(contestId);
    }

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