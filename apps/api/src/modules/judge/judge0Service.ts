import { CheckerType, SubmissionStatus, Verdict } from '@prisma/client';
import { prisma } from '../../prisma/client';
import { recomputeContestStandings } from '../standings/standingService';
import { analyzeSubmissionLogic, generateToughTestCases } from '../ai/aiService';

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
      return { compile_output: data.compiler_error || data.compiler_message || 'Compilation Failed', status: 'COMPILATION_ERROR' };
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

// Highly robust output normalizer to handle trailing spaces, \r\n vs \n differences
function normalizeOutput(value: string | null | undefined) {
  if (!value) return '';
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim(); 
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

async function finalizeVerdict(submissionId: string, verdict: Verdict) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId }, 
    include: { participant: true, team: true, problem: true, contestProblem: true } 
  });

  if (!submission || !submission.participant) return;

  await prisma.submission.update({ where: { id: submissionId }, data: { verdict } });

  if (verdict !== Verdict.ACCEPTED && verdict !== Verdict.COMPILATION_ERROR) {
    await prisma.contestStanding.updateMany({ 
      where: { participantId: submission.participantId }, 
      data: { penalty: { increment: 50 }, testcasePenalty: { increment: 50 } } 
    });
    
    if (submission.teamId) {
      await prisma.contestTeam.update({ where: { id: submission.teamId }, data: { penalty: { increment: 50 } } });
    }
    return;
  }

  if (verdict === Verdict.ACCEPTED) {
    const teamId = submission.teamId;
    const problemId = submission.contestProblemId;

    const pointsToAward = submission.contestProblem?.points || submission.problem?.rating || 100;

    if (teamId && problemId) {
      try {
        await prisma.teamProblemSolve.create({
          data: { teamId: teamId, contestProblemId: problemId, firstSolverId: submission.userId }
        });
        
        await prisma.contestTeam.update({ 
          where: { id: teamId }, 
          data: { score: { increment: pointsToAward } } 
        });
      } catch (err) {} 
    }

    await prisma.contestStanding.updateMany({ 
      where: { participantId: submission.participantId }, 
      data: { individualScore: { increment: pointsToAward }, individualSolved: { increment: 1 } } 
    });
  }
}

export async function judgeQueuedSubmission(submissionId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { problem: { include: { testcases: { orderBy: { order: 'asc' } } } }, contestProblem: true }
  });

  if (!submission) throw new Error('Submission not found');
  
  // ==========================================
  // STRICT MCQ GRADING LOGIC
  // ==========================================
  if (submission.language === 'mcq') {
    let correctIndices: number[] = [];
    
    if (submission.contestProblem?.interviewQuestionId) {
        const mcq = await prisma.interviewQuestion.findUnique({ where: { id: submission.contestProblem.interviewQuestionId } });
        correctIndices = mcq?.correctIndices || [];
    } else if (submission.contestProblem?.mcqData) {
        const data = typeof submission.contestProblem.mcqData === 'string' ? JSON.parse(submission.contestProblem.mcqData) : submission.contestProblem.mcqData;
        correctIndices = data.correctIndices || [];
    }

    let isCorrect = false;
    try {
      let submitted: any;
      try {
        submitted = JSON.parse(submission.code);
      } catch (e) {
        const num = parseInt(submission.code, 10);
        submitted = !isNaN(num) ? [num] : [];
      }
      
      if (Array.isArray(submitted) && Array.isArray(correctIndices) && correctIndices.length > 0) {
        const sortedSubmitted = [...submitted].map(Number).sort((a, b) => a - b);
        const sortedCorrect = [...correctIndices].map(Number).sort((a, b) => a - b);
        isCorrect = JSON.stringify(sortedSubmitted) === JSON.stringify(sortedCorrect);
      } else {
        isCorrect = false;
      }
    } catch (parseError) {
      console.error('[MCQ Parse Error]', parseError);
      isCorrect = false;
    }

    const verdict = isCorrect ? Verdict.ACCEPTED : Verdict.WRONG_ANSWER;
    const judged = await prisma.submission.update({ where: { id: submission.id }, data: { status: 'FINISHED', verdict, judgeMessage: isCorrect ? 'Correct Answer' : 'Incorrect Answer', judgedAt: new Date() } });
    
    await finalizeVerdict(judged.id, verdict);
    const standings = submission.contestId ? await recomputeContestStandings(submission.contestId) : null;
    return { submission: judged, standings };
  }

  if (submission.contestProblem?.requiresRedirect) {
    const judged = await prisma.submission.update({
      where: { id: submission.id },
      data: { status: 'FINISHED', verdict: Verdict.SKIPPED, judgeMessage: `External Platform URL. Redirecting...` }
    });
    return { submission: judged, standings: null };
  }

  let testcases: any[] = submission.problem?.testcases || [];
  
  if (testcases.length === 0 && submission.contestProblem?.customTestCases) {
     try {
         testcases = typeof submission.contestProblem.customTestCases === 'string' ? JSON.parse(submission.contestProblem.customTestCases) : submission.contestProblem.customTestCases;
     } catch (e) {}
  }
  
  // 👉 FIXED: Ensure AI dynamic tests generate safely for custom descriptions even if `submission.problem` is null
  const hasDescription = submission.contestProblem?.customDescription || submission.problem?.description;
  if (testcases.length === 0 && hasDescription) {
    const descriptionForAi = submission.contestProblem?.customDescription || submission.problem?.description || submission.contestProblem?.titleSnapshot || '';
    if (descriptionForAi) {
      await prisma.submission.update({ where: { id: submission.id }, data: { status: 'RUNNING', judgeMessage: 'Generating dynamic test cases via AI...' } });
      const aiCases = await generateToughTestCases(descriptionForAi);
      if (aiCases && aiCases.length > 0) {
         testcases = aiCases.map((tc: any, i: number) => ({ id: `ai-${i}`, input: tc.input, expectedOutput: tc.expectedOutput })) as any;
      }
    }
  }

  if (testcases.length === 0) {
    const res = await submitToWandbox({ sourceCode: submission.code, language: submission.language, stdin: "1\n" });
    const verdict = res.status === 'ACCEPTED' ? Verdict.ACCEPTED : Verdict.RUNTIME_ERROR;
    const judged = await prisma.submission.update({ where: { id: submission.id }, data: { status: 'FINISHED', verdict, judgeMessage: res.stderr || 'Executed successfully. No internal test cases to validate against.' } });
    
    await finalizeVerdict(judged.id, verdict);
    const standings = submission.contestId ? await recomputeContestStandings(submission.contestId) : null;
    return { submission: judged, standings };
  }

  await prisma.submission.update({ where: { id: submission.id }, data: { status: 'RUNNING', verdict: Verdict.PENDING } });
  
  let finalVerdict: Verdict = Verdict.ACCEPTED;
  let detailedMessage = '';
  let fullTestResults = [];

  for (const [index, testcase] of testcases.entries()) {
    const result = await submitToWandbox({ sourceCode: submission.code, language: submission.language, stdin: testcase.input });
    const localVerdict = evaluateVerdict(result.status, result.stdout, testcase.expectedOutput, submission.problem?.checkerType || CheckerType.EXACT);
    
    fullTestResults.push({
      submissionId: submission.id,
      testcaseId: testcase.id || `tc-${index}`,
      index,
      verdict: localVerdict,
      stdout: result.stdout?.substring(0, 500) || null,
      stderr: result.stderr?.substring(0, 500) || result.compile_output?.substring(0, 500) || null
    });

    if (localVerdict !== Verdict.ACCEPTED && finalVerdict === Verdict.ACCEPTED) {
      finalVerdict = localVerdict;
      detailedMessage = result.compile_output || result.stderr || `Failed on testcase ${index + 1}`;
    }
  }

  await prisma.submissionTestResult.createMany({ data: fullTestResults });

  const judged = await prisma.submission.update({
    where: { id: submission.id },
    data: { status: 'FINISHED', verdict: finalVerdict, judgeMessage: detailedMessage || `Passed all ${testcases.length} system tests!`, judgedAt: new Date() }
  });

  await finalizeVerdict(judged.id, finalVerdict);
  const standings = submission.contestId ? await recomputeContestStandings(submission.contestId) : null;
  
  // 👉 FIXED: Safe optional chaining for AI Logic analysis on custom problems
  if (finalVerdict === Verdict.ACCEPTED) {
    const descriptionForAi = submission.contestProblem?.customDescription || submission.problem?.description || submission.contestProblem?.titleSnapshot || 'No description available.';
    analyzeSubmissionLogic(judged.id, descriptionForAi, submission.code)
      .catch(err => console.error("AI Analysis failed in background:", err));
  }

  return { submission: judged, standings, testResults: fullTestResults };
}

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

  const actual = normalizeOutput(result.stdout);
  let verdict = 'EXECUTED';
  
  if (expectedOutput) {
    const expected = normalizeOutput(expectedOutput);
    verdict = actual === expected ? 'ACCEPTED' : 'WRONG_ANSWER';
  }

  return { verdict, stdout: result.stdout, stderr: result.stderr };
}