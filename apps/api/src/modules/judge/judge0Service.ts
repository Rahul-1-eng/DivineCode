import { CheckerType, SubmissionStatus, Verdict } from '@prisma/client';
import { prisma } from '../../prisma/client';
import { recomputeContestStandings } from '../standings/standingService';

const WANDBOX_URL = 'https://wandbox.org/api/compile.json';

const WANDBOX_COMPILERS: Record<string, string> = {
  'c++': 'gcc-head',
  'c': 'gcc-head-c',
  'python': 'cpython-head',
  'java': 'openjdk-head',
  'javascript': 'nodejs-head'
};

export async function submitToWandbox(input: { sourceCode: string; language: string; stdin: string; }) {
  const normalizedLang = input.language.toLowerCase().replace('cpp', 'c++');
  const compiler = WANDBOX_COMPILERS[normalizedLang] || 'cpython-head';

  try {
    const response = await fetch(WANDBOX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: input.sourceCode,
        compiler: compiler,
        stdin: input.stdin || ''
      })
    });

    if (!response.ok) throw new Error(`Wandbox API rejected payload: ${response.status}`);
    const data = await response.json();

    if (data.compiler_error || (data.status !== "0" && !data.program_message && !data.program_error)) {
      return { 
        compile_output: data.compiler_error || data.compiler_message || 'Compilation Failed', 
        status: 'COMPILATION_ERROR' 
      };
    }

    if (data.status !== "0") {
      if (data.signal === "SIGKILL" || data.status === "137") {
        return { stderr: 'Time Limit Exceeded or Memory Limit Reached', status: 'TIME_LIMIT_EXCEEDED' };
      }
      return { stderr: data.program_error || data.program_message || 'Runtime Exception', status: 'RUNTIME_ERROR' };
    }

    return { stdout: data.program_message || '', stderr: data.program_error || '', status: 'ACCEPTED' };
  } catch (error: any) {
    return { verdict: 'RUNTIME_ERROR', stderr: `Execution engine offline: ${error.message}` };
  }
}

function normalizeOutput(value: string | null | undefined) {
  if (!value) return '';
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '').split('\n').map(line => line.trimEnd()).join('\n').trim(); 
}

function evaluateVerdict(status: string, stdout: string | null | undefined, expectedOutput: string, checkerType: CheckerType): Verdict {
  if (status === 'COMPILATION_ERROR') return Verdict.COMPILATION_ERROR;
  if (status === 'TIME_LIMIT_EXCEEDED') return Verdict.TIME_LIMIT_EXCEEDED;
  if (status === 'RUNTIME_ERROR') return Verdict.RUNTIME_ERROR;

  if (status === 'ACCEPTED') {
    const actual = normalizeOutput(stdout);
    const expected = normalizeOutput(expectedOutput);
    if (checkerType === CheckerType.EXACT || checkerType === CheckerType.TOKEN) {
      return actual === expected ? Verdict.ACCEPTED : Verdict.WRONG_ANSWER;
    }
  }
  return Verdict.JUDGE_ERROR;
}

export async function judgeQueuedSubmission(submissionId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { problem: { include: { testcases: { orderBy: { order: 'asc' } } } }, contestProblem: true }
  });

  if (!submission) throw new Error('Submission not found');
  
  // MCQ Assessment Logic
  if (submission.language === 'mcq') {
    const mcq = await prisma.interviewQuestion.findUnique({ where: { id: submission.contestProblem!.interviewQuestionId! } });
    let isCorrect = false;
    try {
      const submitted = JSON.parse(submission.code);
      isCorrect = Array.isArray(submitted) && mcq?.correctIndices && submitted.length === mcq.correctIndices.length && submitted.every(v => mcq.correctIndices.includes(v));
    } catch {
      isCorrect = mcq?.correctIndex === parseInt(submission.code);
    }
    const verdict = isCorrect ? Verdict.ACCEPTED : Verdict.WRONG_ANSWER;
    const judged = await prisma.submission.update({ where: { id: submission.id }, data: { status: 'FINISHED', verdict, judgeMessage: isCorrect ? 'Correct Answer' : 'Incorrect Answer', judgedAt: new Date() } });
    return { submission: judged };
  }

  // FALLBACK LINK NO-ERROR CLAUSE
  if (!submission.problem) {
    const judged = await prisma.submission.update({
      where: { id: submission.id },
      data: { status: 'FINISHED', verdict: Verdict.ACCEPTED, judgeMessage: `Verification URL Fallback: Check original description link.` }
    });
    return { submission: judged };
  }

  const testcases = submission.problem.testcases;
  if (!testcases || testcases.length === 0) {
    const res = await submitToWandbox({ sourceCode: submission.code, language: submission.language, stdin: "1\n" });
    const verdict = res.status === 'ACCEPTED' ? Verdict.ACCEPTED : Verdict.RUNTIME_ERROR;
    const judged = await prisma.submission.update({ where: { id: submission.id }, data: { status: 'FINISHED', verdict, judgeMessage: res.stderr || 'Executed successfully. No internal test cases to validate against.' } });
    return { submission: judged };
  }

  await prisma.submission.update({ where: { id: submission.id }, data: { status: 'RUNNING', verdict: Verdict.PENDING } });
  
  let finalVerdict: Verdict = Verdict.ACCEPTED;
  let detailedMessage = '';

  for (const [index, testcase] of testcases.entries()) {
    const result = await submitToWandbox({ sourceCode: submission.code, language: submission.language, stdin: testcase.input });
    const localVerdict = evaluateVerdict(result.status, result.stdout, testcase.expectedOutput, submission.problem.checkerType);
    
    if (localVerdict !== Verdict.ACCEPTED) {
      finalVerdict = localVerdict;
      detailedMessage = result.compile_output || result.stderr || 'Wrong Answer';
      break;
    }
  }

  const judged = await prisma.submission.update({
    where: { id: submission.id },
    data: { status: 'FINISHED', verdict: finalVerdict, judgeMessage: detailedMessage || 'All standard sample arrays match.', judgedAt: new Date() }
  });

  return { submission: judged };
}

// 👉 UPDATED: 4-Argument function allowing expectedOutput checking
export async function executeSubmission(sourceCode: string, language: string, input: string, expectedOutput?: string) {
  const result = await submitToWandbox({ sourceCode, language, stdin: input });
  
  if (result.status === 'COMPILATION_ERROR') {
    return { verdict: 'COMPILATION_ERROR', compileError: result.compile_output };
  }
  if (result.status === 'TIME_LIMIT_EXCEEDED') {
    return { verdict: 'TIME_LIMIT_EXCEEDED', stderr: result.stderr };
  }
  if (result.status === 'RUNTIME_ERROR') {
    return { verdict: 'RUNTIME_ERROR', stderr: result.stderr };
  }

  // Normalize outputs
  const actual = normalizeOutput(result.stdout);
  let verdict = 'EXECUTED';
  
  // Custom Output Grading
  if (expectedOutput) {
    const expected = normalizeOutput(expectedOutput);
    verdict = actual === expected ? 'ACCEPTED' : 'WRONG_ANSWER';
  }

  return { verdict, stdout: result.stdout, stderr: result.stderr };
}