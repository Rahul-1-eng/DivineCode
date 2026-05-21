import { CheckerType, SubmissionStatus, Verdict } from '@prisma/client';
import { prisma } from '../../prisma/client';
import { recomputeContestStandings } from '../standings/standingService';

type JudgeLanguage = 'cpp' | 'c' | 'java' | 'python' | 'javascript';

type Judge0Result = {
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  time?: string | number | null;
  memory?: number | null;
  status?: {
    id?: number;
    description?: string;
  } | null;
};

const languageMap: Record<JudgeLanguage, number> = {
  cpp: 54,
  c: 50,
  java: 62,
  python: 71,
  javascript: 63
};

function normalizeOutput(value: string | null | undefined) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function verdictFromJudge0(statusDescription: string, stdout: string | null | undefined, expectedOutput: string, checkerType: CheckerType) {
  if (statusDescription === 'Compilation Error') return Verdict.COMPILATION_ERROR;
  if (statusDescription === 'Runtime Error (NZEC)' || statusDescription.includes('Runtime')) return Verdict.RUNTIME_ERROR;
  if (statusDescription === 'Time Limit Exceeded') return Verdict.TIME_LIMIT_EXCEEDED;
  if (statusDescription === 'Memory Limit Exceeded') return Verdict.MEMORY_LIMIT_EXCEEDED;
  if (statusDescription !== 'Accepted') return Verdict.JUDGE_ERROR;

  if (checkerType === CheckerType.EXACT || checkerType === CheckerType.TOKEN) {
    return normalizeOutput(stdout) === normalizeOutput(expectedOutput) ? Verdict.ACCEPTED : Verdict.WRONG_ANSWER;
  }

  if (checkerType === CheckerType.FLOAT) {
    const actual = normalizeOutput(stdout).split(' ').map(Number);
    const expected = normalizeOutput(expectedOutput).split(' ').map(Number);
    const ok =
      actual.length === expected.length &&
      actual.every((value, index) => Number.isFinite(value) && Math.abs(value - expected[index]) <= 1e-6);
    return ok ? Verdict.ACCEPTED : Verdict.WRONG_ANSWER;
  }

  return Verdict.JUDGE_ERROR;
}

function aggregateVerdict(results: { verdict: Verdict }[]) {
  if (!results.length) return Verdict.JUDGE_ERROR;
  if (results.every((result) => result.verdict === Verdict.ACCEPTED)) return Verdict.ACCEPTED;
  return results.find((result) => result.verdict !== Verdict.ACCEPTED)?.verdict || Verdict.JUDGE_ERROR;
}

async function submitToJudge0(input: {
  sourceCode: string;
  language: JudgeLanguage;
  stdin: string;
  expectedOutput: string;
}) {
  const judgeUrl = process.env.JUDGE0_URL;
  if (!judgeUrl) throw new Error('JUDGE0_URL is not configured');

  const response = await fetch(`${judgeUrl}/submissions?base64_encoded=false&wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_code: input.sourceCode,
      language_id: languageMap[input.language],
      stdin: input.stdin,
      expected_output: input.expectedOutput
    })
  });

  if (!response.ok) throw new Error(`Judge0 request failed with status ${response.status}`);
  return (await response.json()) as Judge0Result;
}

export async function judgeQueuedSubmission(submissionId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      problem: {
        include: {
          testcases: {
            orderBy: { order: 'asc' }
          }
        }
      },
      contestProblem: true
    }
  });

  if (!submission) throw new Error('Submission not found');
  if (!submission.code) throw new Error('Submission has no code to judge');
  if (!languageMap[submission.language as JudgeLanguage]) throw new Error(`Unsupported language: ${submission.language}`);

  if (!submission.problem) {
    throw new Error('This submission is linked to an external-only problem. Use external platform sync instead.');
  }

  const testcases = submission.problem.testcases;
  if (!testcases.length) throw new Error('Problem has no testcases configured');
  if (submission.problem.checkerType === CheckerType.CUSTOM) {
    throw new Error('Custom checkers are not implemented in the Judge0 V2 path yet');
  }

  await prisma.submission.update({
    where: { id: submission.id },
    data: {
      status: SubmissionStatus.RUNNING,
      verdict: Verdict.PENDING
    }
  });

  const results = [];

  for (const [index, testcase] of testcases.entries()) {
    const result = await submitToJudge0({
      sourceCode: submission.code,
      language: submission.language as JudgeLanguage,
      stdin: testcase.input,
      expectedOutput: testcase.expectedOutput
    });

    const statusDescription = result.status?.description || 'Judge Error';
    const verdict = verdictFromJudge0(statusDescription, result.stdout, testcase.expectedOutput, submission.problem.checkerType);

    const saved = await prisma.submissionTestResult.upsert({
      where: {
        submissionId_index: {
          submissionId: submission.id,
          index
        }
      },
      create: {
        submissionId: submission.id,
        testcaseId: testcase.id,
        index,
        verdict,
        timeMs: result.time ? Math.ceil(Number(result.time) * 1000) : null,
        memoryKb: result.memory || null,
        stdout: result.stdout || null,
        stderr: result.stderr || null,
        checkerMessage: statusDescription
      },
      update: {
        testcaseId: testcase.id,
        verdict,
        timeMs: result.time ? Math.ceil(Number(result.time) * 1000) : null,
        memoryKb: result.memory || null,
        stdout: result.stdout || null,
        stderr: result.stderr || null,
        checkerMessage: statusDescription
      }
    });

    results.push(saved);

    if (verdict !== Verdict.ACCEPTED) break;
  }

  const finalVerdict = aggregateVerdict(results);
  const maxTimeMs = results.reduce((max, result) => Math.max(max, result.timeMs || 0), 0);
  const maxMemoryKb = results.reduce((max, result) => Math.max(max, result.memoryKb || 0), 0);

  const judged = await prisma.submission.update({
    where: { id: submission.id },
    data: {
      status: SubmissionStatus.FINISHED,
      verdict: finalVerdict,
      timeMs: maxTimeMs || null,
      memoryKb: maxMemoryKb || null,
      judgeMessage: finalVerdict,
      judgedAt: new Date()
    },
    include: {
      testResults: {
        orderBy: { index: 'asc' }
      }
    }
  });

  const standings = submission.contestId ? await recomputeContestStandings(submission.contestId) : null;

  return {
    submission: judged,
    standings
  };
}
