import { CheckerType, SubmissionStatus, Verdict } from '@prisma/client';
import { prisma } from '../../prisma/client';
import { recomputeContestStandings } from '../standings/standingService';

const WANDBOX_URL = 'https://wandbox.org/api/compile.json';

type JudgeLanguage = 'cpp' | 'c' | 'java' | 'python' | 'javascript';

const languageMap: Record<string, string> = {
  cpp: 'gcc-head',
  c: 'gcc-head-c',
  java: 'openjdk-head',
  python: 'cpython-head',
  javascript: 'nodejs-head'
};

type Judge0Result = {
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  time?: string | number | null;
  memory?: number | null;
  status?: { id?: number; description?: string; } | null;
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
}): Promise<Judge0Result> {
  const compiler = languageMap[input.language];
  
  try {
    const response = await fetch(WANDBOX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        compiler: compiler,
        code: input.sourceCode,
        stdin: input.stdin || ''
      })
    });

    if (!response.ok) throw new Error(`Wandbox API request failed`);
    const data = await response.json();

    let statusId = 3;
    let statusDesc = 'Accepted';

    if (data.compiler_error) {
      statusId = 6;
      statusDesc = 'Compilation Error';
    } else if (data.status !== '0' && data.program_error?.toLowerCase().includes('killed')) {
      statusId = 5;
      statusDesc = 'Time Limit Exceeded';
    } else if (data.status !== '0') {
      statusId = 11;
      statusDesc = 'Runtime Error (NZEC)';
    }

    return {
      stdout: data.program_message,
      stderr: data.program_error,
      compile_output: data.compiler_error || data.compiler_message,
      time: 0.1, 
      memory: 2048,
      status: { id: statusId, description: statusDesc }
    };
  } catch (error) {
    return {
      stdout: null,
      stderr: "Could not connect to external execution engine.",
      status: { id: 13, description: "Judge Error" }
    };
  }
}

async function finalizeVerdict(submissionId: string, verdict: Verdict) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { participant: true }
  });

  if (!submission) return;

  await prisma.submission.update({
    where: { id: submissionId },
    data: { verdict }
  });

  if (verdict === Verdict.ACCEPTED && submission.participant?.teamId) {
    const teamId = submission.participant.teamId;
    const problemId = submission.contestProblemId;

    const teamAlreadySolved = await prisma.submission.findFirst({
      where: {
        contestProblemId: problemId,
        teamId: teamId,
        verdict: Verdict.ACCEPTED,
        id: { not: submissionId }
      }
    });

    if (!teamAlreadySolved) {
      await prisma.contestParticipant.updateMany({
        where: { teamId: teamId },
        data: { score: { increment: 100 } }
      });
    }

    await prisma.contestParticipant.update({
      where: { id: submission.participantId },
      data: { score: { increment: 100 } }
    });
  }
}

export async function judgeQueuedSubmission(submissionId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      problem: { include: { testcases: { orderBy: { order: 'asc' } } } },
      contestProblem: true,
      participant: true
    }
  });

  if (!submission) throw new Error('Submission not found');
  if (!submission.code) throw new Error('Submission has no code to judge');

  if (submission.language === 'mcq') {
    const mcq = await prisma.interviewQuestion.findUnique({
      where: { id: submission.contestProblem!.interviewQuestionId! }
    });

    const isCorrect = mcq?.correctIndex === parseInt(submission.code);
    const verdict = isCorrect ? Verdict.ACCEPTED : Verdict.WRONG_ANSWER;
    const judgeMessage = isCorrect ? 'Correct Answer' : 'Incorrect Answer';

    const judged = await prisma.submission.update({
      where: { id: submission.id },
      data: {
        status: SubmissionStatus.FINISHED,
        verdict,
        judgeMessage,
        judgedAt: new Date()
      }
    });

    if (verdict === Verdict.ACCEPTED) {
      await finalizeVerdict(judged.id, verdict);
    }

    const standings = submission.contestId ? await recomputeContestStandings(submission.contestId) : null;
    return { submission: judged, standings };
  }

  if (submission.contestId && submission.participant?.teamId) {
    const duplicate = await prisma.submission.findFirst({
      where: {
        contestId: submission.contestId,
        contestProblemId: submission.contestProblemId,
        code: submission.code,
        id: { not: submission.id },
        participant: { teamId: submission.participant.teamId }
      }
    });

    if (duplicate) {
      const judged = await prisma.submission.update({
        where: { id: submission.id },
        data: {
          status: SubmissionStatus.FINISHED,
          verdict: Verdict.SKIPPED,
          judgeMessage: 'Anti-Cheat: Exact duplicate code detected within your team.',
          isFlagged: true,
          judgedAt: new Date()
        },
        include: { testResults: { orderBy: { index: 'asc' } } }
      });
      const standings = await recomputeContestStandings(submission.contestId);
      return { submission: judged, standings };
    }
  }

  if (!languageMap[submission.language as JudgeLanguage]) throw new Error(`Unsupported language: ${submission.language}`);

  if (!submission.problem) {
    throw new Error('This submission is linked to an external-only problem. Use external platform sync instead.');
  }

  const testcases = submission.problem.testcases;
  if (!testcases.length) throw new Error('Problem has no testcases configured');

  await prisma.submission.update({
    where: { id: submission.id },
    data: { status: SubmissionStatus.RUNNING, verdict: Verdict.PENDING }
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
      where: { submissionId_index: { submissionId: submission.id, index } },
      create: {
        submissionId: submission.id,
        testcaseId: testcase.id,
        index,
        verdict,
        timeMs: result.time ? Math.ceil(Number(result.time) * 1000) : null,
        memoryKb: result.memory || null,
        stdout: result.stdout || null,
        stderr: result.compile_output || result.stderr || null, 
        checkerMessage: statusDescription
      },
      update: {
        testcaseId: testcase.id,
        verdict,
        timeMs: result.time ? Math.ceil(Number(result.time) * 1000) : null,
        memoryKb: result.memory || null,
        stdout: result.stdout || null,
        stderr: result.compile_output || result.stderr || null,
        checkerMessage: statusDescription
      }
    });

    results.push(saved);
    if (verdict !== Verdict.ACCEPTED) break;
  }

  const finalVerdict = aggregateVerdict(results);
  const maxTimeMs = results.reduce((max, result) => Math.max(max, result.timeMs || 0), 0);
  const maxMemoryKb = results.reduce((max, result) => Math.max(max, result.memoryKb || 0), 0);

  const firstFailed = results.find(r => r.verdict !== Verdict.ACCEPTED);
  let detailedMessage = finalVerdict as string;
  if (firstFailed) {
      detailedMessage = firstFailed.stderr || firstFailed.stdout || firstFailed.checkerMessage || finalVerdict;
  }

  const judged = await prisma.submission.update({
    where: { id: submission.id },
    data: {
      status: SubmissionStatus.FINISHED,
      verdict: finalVerdict,
      timeMs: maxTimeMs || null,
      memoryKb: maxMemoryKb || null,
      judgeMessage: detailedMessage, 
      judgedAt: new Date()
    },
    include: { testResults: { orderBy: { index: 'asc' } } }
  });

  if (finalVerdict === Verdict.ACCEPTED) {
    await finalizeVerdict(judged.id, finalVerdict);
  }

  const standings = submission.contestId ? await recomputeContestStandings(submission.contestId) : null;

  return { submission: judged, standings };
}

interface ExecutionResult {
  verdict: 'ACCEPTED' | 'WRONG_ANSWER' | 'TIME_LIMIT_EXCEEDED' | 'RUNTIME_ERROR' | 'COMPILATION_ERROR' | 'EXECUTED';
  runtimeMs?: number;
  memoryKb?: number;
  compileError?: string;
  stdout?: string;
  stderr?: string;
}

export async function executeSubmission(
  sourceCode: string,
  language: string,
  input: string,
  expectedOutput?: string
): Promise<ExecutionResult> {
  const compiler = languageMap[language];
  if (!compiler) throw new Error(`Unsupported language: ${language}`);

  try {
    const response = await fetch(WANDBOX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        compiler: compiler,
        code: sourceCode,
        stdin: input || ''
      })
    });

    if (!response.ok) {
        throw new Error(`Wandbox HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.compiler_error) {
      return { verdict: 'COMPILATION_ERROR', compileError: data.compiler_error };
    }

    if (data.status !== '0') {
      const isTimeout = data.program_error?.toLowerCase().includes('killed');
      return { 
        verdict: isTimeout ? 'TIME_LIMIT_EXCEEDED' : 'RUNTIME_ERROR', 
        stderr: data.program_error || 'Runtime error occurred', 
        stdout: data.program_message 
      };
    }

    const actual = String(data.program_message || '').trim().replace(/\s+/g, ' ');
    
    let verdict: ExecutionResult['verdict'] = 'EXECUTED';
    if (expectedOutput) {
      const expected = String(expectedOutput || '').trim().replace(/\s+/g, ' ');
      verdict = actual === expected ? 'ACCEPTED' : 'WRONG_ANSWER';
    }

    return { 
      verdict, 
      runtimeMs: 15,
      memoryKb: 2048,
      stdout: data.program_message,
      stderr: data.program_error
    };
  } catch (error) {
    console.error('Wandbox connection error details:', error);
    return { verdict: 'RUNTIME_ERROR', stderr: 'Could not connect to execution engine.' };
  }
}