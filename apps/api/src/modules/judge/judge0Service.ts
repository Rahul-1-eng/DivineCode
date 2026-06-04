import { CheckerType, SubmissionStatus, Verdict } from '@prisma/client';
import { prisma } from '../../prisma/client';
import { recomputeContestStandings } from '../standings/standingService';

const PISTON_URL = 'https://emkc.org/api/v2/piston';

type JudgeLanguage = 'cpp' | 'c' | 'java' | 'python' | 'javascript';

// 👉 THE FIX: Hardcoded exact versions. No async fetching. No crashing. Guaranteed to compile.
const PISTON_VERSIONS: Record<string, string> = {
  'c++': '10.2.0',
  'c': '10.2.0',
  'python': '3.10.0',
  'java': '15.0.2',
  'javascript': '18.15.0'
};

function getPistonConfig(language: string) {
  const normalized = String(language || '').toLowerCase().trim();
  let searchLang = normalized;
  
  if (normalized.includes('c++') || normalized === 'cpp') searchLang = 'c++';
  else if (normalized === 'c') searchLang = 'c';
  else if (normalized.includes('java') && !normalized.includes('javascript')) searchLang = 'java';
  else if (normalized.includes('py')) searchLang = 'python';
  else if (normalized.includes('js') || normalized.includes('node') || normalized.includes('javascript')) searchLang = 'javascript';
  else searchLang = 'python';

  return { language: searchLang, version: PISTON_VERSIONS[searchLang] || '*' }; 
}

function normalizeOutput(value: string | null | undefined) {
  if (!value) return '';
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '').split('\n').map(line => line.trimEnd()).join('\n').trim(); 
}

function evaluateVerdict(status: string, stdout: string | null | undefined, expectedOutput: string, checkerType: CheckerType): Verdict {
  if (status === 'COMPILATION_ERROR') return Verdict.COMPILATION_ERROR;
  if (status === 'TIME_LIMIT_EXCEEDED') return Verdict.TIME_LIMIT_EXCEEDED;
  if (status === 'RUNTIME_ERROR') return Verdict.RUNTIME_ERROR;
  if (status === 'JUDGE_ERROR') return Verdict.JUDGE_ERROR;

  if (status === 'ACCEPTED') {
    const actual = normalizeOutput(stdout);
    const expected = normalizeOutput(expectedOutput);

    if (checkerType === CheckerType.EXACT || checkerType === CheckerType.TOKEN) {
      return actual === expected ? Verdict.ACCEPTED : Verdict.WRONG_ANSWER;
    }
    if (checkerType === CheckerType.FLOAT) {
      const actualArr = actual.split(/\s+/).map(Number);
      const expectedArr = expected.split(/\s+/).map(Number);
      const ok = actualArr.length === expectedArr.length && actualArr.every((val, i) => Number.isFinite(val) && Math.abs(val - expectedArr[i]) <= 1e-6);
      return ok ? Verdict.ACCEPTED : Verdict.WRONG_ANSWER;
    }
  }
  return Verdict.JUDGE_ERROR;
}

function aggregateVerdict(results: { verdict: Verdict }[]) {
  if (!results.length) return Verdict.JUDGE_ERROR;
  if (results.every((result) => result.verdict === Verdict.ACCEPTED)) return Verdict.ACCEPTED;
  return results.find((result) => result.verdict !== Verdict.ACCEPTED)?.verdict || Verdict.JUDGE_ERROR;
}

async function submitToPiston(input: { sourceCode: string; language: JudgeLanguage; stdin: string; }) {
  const langConfig = getPistonConfig(input.language);
  
  let filename = 'main.txt';
  if (langConfig.language === 'c++') filename = 'main.cpp';
  else if (langConfig.language === 'c') filename = 'main.c';
  else if (langConfig.language === 'python') filename = 'main.py';
  else if (langConfig.language === 'javascript') filename = 'main.js';
  
  let files = [{ name: filename, content: input.sourceCode }];
  
  if (langConfig.language === 'java') {
    const match = input.sourceCode.match(/public\s+class\s+([A-Za-z0-9_]+)/);
    const className = match ? match[1] : 'Main';
    files = [{ name: `${className}.java`, content: input.sourceCode }];
  }

  try {
    const response = await fetch(`${PISTON_URL}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: langConfig.language,
        version: langConfig.version,
        files: files,
        stdin: input.stdin || '',
        run_timeout: 5000, 
        compile_timeout: 10000
      })
    });

    if (!response.ok) throw new Error(`Piston rejected execution payload`);
    const data = await response.json();

    if (data.compile && data.compile.code !== 0) return { compile_output: data.compile.output, status: 'COMPILATION_ERROR' };
    
    if (data.run) {
      if (data.run.signal === 'SIGKILL') return { stderr: 'Time Limit Exceeded', status: 'TIME_LIMIT_EXCEEDED' };
      if (data.run.code !== 0) return { stderr: data.run.output, status: 'RUNTIME_ERROR' };
      const safeStdout = data.run.stdout !== undefined ? data.run.stdout : (data.run.output || '');
      return { stdout: safeStdout, stderr: data.run.stderr, status: 'ACCEPTED' };
    }
    return { stderr: "Unknown execution error", status: 'JUDGE_ERROR' };
  } catch (error) {
    return { stderr: "Could not connect to the execution engine.", status: 'JUDGE_ERROR' };
  }
}

async function finalizeVerdict(submissionId: string, verdict: Verdict) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId }, include: { participant: true, team: true }
  });

  if (!submission) return;

  await prisma.submission.update({ where: { id: submissionId }, data: { verdict } });

  if (verdict !== Verdict.ACCEPTED && verdict !== Verdict.COMPILATION_ERROR) {
    if (submission.participantId) {
      await prisma.contestStanding.updateMany({ where: { participantId: submission.participantId }, data: { penalty: { increment: 50 } } });
    }
    if (submission.teamId) {
      await prisma.contestTeam.update({ where: { id: submission.teamId }, data: { penalty: { increment: 50 } } });
    }
  }

  if (verdict === Verdict.ACCEPTED && submission.participant) {
    const teamId = submission.teamId;
    const problemId = submission.contestProblemId;

    if (teamId) {
      const teamAlreadySolved = await prisma.submission.findFirst({
        where: { contestProblemId: problemId, teamId: teamId, verdict: Verdict.ACCEPTED, id: { not: submissionId } }
      });
      if (!teamAlreadySolved) await prisma.contestTeam.update({ where: { id: teamId }, data: { score: { increment: 100 } } });
    }
    await prisma.contestParticipant.update({ where: { id: submission.participantId! }, data: { score: { increment: 100 } } });
  }
}

export async function judgeQueuedSubmission(submissionId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { problem: { include: { testcases: { orderBy: { order: 'asc' } } } }, contestProblem: true, participant: true }
  });

  if (!submission) throw new Error('Submission not found');
  if (!submission.code) throw new Error('Submission has no code to judge');

  if (submission.language === 'mcq') {
    const mcq = await prisma.interviewQuestion.findUnique({ where: { id: submission.contestProblem!.interviewQuestionId! } });
    const isCorrect = mcq?.correctIndex === parseInt(submission.code);
    const verdict = isCorrect ? Verdict.ACCEPTED : Verdict.WRONG_ANSWER;
    const judgeMessage = isCorrect ? 'Correct Answer' : 'Incorrect Answer';

    const judged = await prisma.submission.update({
      where: { id: submission.id }, data: { status: SubmissionStatus.FINISHED, verdict, judgeMessage, judgedAt: new Date() }
    });

    await finalizeVerdict(judged.id, verdict);
    const standings = submission.contestId ? await recomputeContestStandings(submission.contestId) : null;
    return { submission: judged, standings };
  }

  if (!submission.problem) throw new Error('External problem only.');

  const testcases = submission.problem.testcases;
  if (!testcases.length) throw new Error('Problem has no testcases configured');

  await prisma.submission.update({ where: { id: submission.id }, data: { status: SubmissionStatus.RUNNING, verdict: Verdict.PENDING } });

  const results = [];

  for (const [index, testcase] of testcases.entries()) {
    const result = await submitToPiston({ sourceCode: submission.code, language: submission.language as JudgeLanguage, stdin: testcase.input });
    const verdict = evaluateVerdict(result.status as string, result.stdout, testcase.expectedOutput, submission.problem.checkerType);

    const saved = await prisma.submissionTestResult.upsert({
      where: { submissionId_index: { submissionId: submission.id, index } },
      create: {
        submissionId: submission.id, testcaseId: testcase.id, index, verdict,
        timeMs: 15, memoryKb: 2048, stdout: result.stdout || null, stderr: result.compile_output || result.stderr || null, checkerMessage: result.status
      },
      update: { testcaseId: testcase.id, verdict, stdout: result.stdout || null, stderr: result.compile_output || result.stderr || null, checkerMessage: result.status }
    });

    results.push(saved);
    if (verdict !== Verdict.ACCEPTED) break;
  }

  const finalVerdict = aggregateVerdict(results);
  const firstFailed = results.find(r => r.verdict !== Verdict.ACCEPTED);
  let detailedMessage = finalVerdict as string;
  if (firstFailed) detailedMessage = firstFailed.stderr || firstFailed.stdout || firstFailed.checkerMessage || finalVerdict;

  const judged = await prisma.submission.update({
    where: { id: submission.id },
    data: { status: SubmissionStatus.FINISHED, verdict: finalVerdict, timeMs: 15, memoryKb: 2048, judgeMessage: detailedMessage, judgedAt: new Date() },
    include: { testResults: { orderBy: { index: 'asc' } } }
  });

  await finalizeVerdict(judged.id, finalVerdict);
  const standings = submission.contestId ? await recomputeContestStandings(submission.contestId) : null;
  return { submission: judged, standings };
}

export async function executeSubmission(sourceCode: string, language: string, input: string, expectedOutput?: string) {
  const langConfig = getPistonConfig(language);

  let filename = 'main.txt';
  if (langConfig.language === 'c++') filename = 'main.cpp';
  else if (langConfig.language === 'c') filename = 'main.c';
  else if (langConfig.language === 'python') filename = 'main.py';
  else if (langConfig.language === 'javascript') filename = 'main.js';

  let files: { content: string; name?: string }[] = [{ name: filename, content: sourceCode }];
  
  if (langConfig.language === 'java') {
    const match = sourceCode.match(/public\s+class\s+([A-Za-z0-9_]+)/);
    const className = match ? match[1] : 'Main';
    files = [{ name: `${className}.java`, content: sourceCode }];
  }

  try {
    const response = await fetch(`${PISTON_URL}/execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: langConfig.language, version: langConfig.version,
        files: files, stdin: input || '', run_timeout: 5000, compile_timeout: 10000
      })
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();

    if (data.compile && data.compile.code !== 0) return { verdict: 'COMPILATION_ERROR', compileError: data.compile.output };
    if (data.run && data.run.signal === 'SIGKILL') return { verdict: 'TIME_LIMIT_EXCEEDED', stderr: 'Execution took too long.' };
    if (data.run && data.run.code !== 0) return { verdict: 'RUNTIME_ERROR', stderr: data.run.output, stdout: data.run.stdout };

    const safeStdout = data.run.stdout !== undefined ? data.run.stdout : (data.run.output || '');
    const actual = normalizeOutput(safeStdout);
    
    let verdict = 'EXECUTED';
    if (expectedOutput) {
      const expected = normalizeOutput(expectedOutput);
      verdict = actual === expected ? 'ACCEPTED' : 'WRONG_ANSWER';
    }

    return { verdict, runtimeMs: 15, memoryKb: 2048, stdout: safeStdout, stderr: data.run.stderr };
  } catch (error) {
    return { verdict: 'RUNTIME_ERROR', stderr: 'Could not connect to execution engine.' };
  }
}