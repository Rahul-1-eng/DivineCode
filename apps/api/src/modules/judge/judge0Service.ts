import { CheckerType, SubmissionStatus, Verdict } from '@prisma/client';
import { prisma } from '../../prisma/client';
import { recomputeContestStandings } from '../standings/standingService';

// 👉 BYPASSING PISTON: We are using the 100% Free Wandbox API (No Keys Required)
const WANDBOX_URL = 'https://wandbox.org/api/compile.json';

type JudgeLanguage = 'cpp' | 'c' | 'java' | 'python' | 'javascript';

// Map your frontend languages to Wandbox's specific compiler strings
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

// ---------------------------------------------------------
// 1. CONTEST SUBMISSION PATH (WANDBOX)
// ---------------------------------------------------------
async function submitToJudge0(input: {
  sourceCode: string;
  language: JudgeLanguage;
  stdin: string;
  expectedOutput: string;
}): Promise<Judge0Result> {
  const compiler = languageMap[input.language];
  
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
    time: 0.1, // Mocked for free tier
    memory: 2048,
    status: { id: statusId, description: statusDesc }
  };
}

export async function judgeQueuedSubmission(submissionId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      problem: { include: { testcases: { orderBy: { order: 'asc' } } } },
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
    throw new Error('Custom checkers are not implemented in the V2 path yet');
  }

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
    include: { testResults: { orderBy: { index: 'asc' } } }
  });

  const standings = submission.contestId ? await recomputeContestStandings(submission.contestId) : null;

  return { submission: judged, standings };
}

// ---------------------------------------------------------
// 2. LIVE EDITOR PATH (WANDBOX)
// ---------------------------------------------------------
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

    // 1. Compilation Error
    if (data.compiler_error) {
      return { verdict: 'COMPILATION_ERROR', compileError: data.compiler_error };
    }

    // 2. Runtime Error
    if (data.status !== '0') {
      const isTimeout = data.program_error?.toLowerCase().includes('killed');
      return { 
        verdict: isTimeout ? 'TIME_LIMIT_EXCEEDED' : 'RUNTIME_ERROR', 
        stderr: data.program_error || 'Runtime error occurred', 
        stdout: data.program_message 
      };
    }

    // 3. Output comparison (If expected output is provided)
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