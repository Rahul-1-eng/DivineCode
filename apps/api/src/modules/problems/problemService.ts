// apps/api/src/modules/problems/problemService.ts
import { CheckerType, Platform, ProblemSource, ProblemVisibility, TestcaseType } from '@prisma/client';
import { prisma } from '../../prisma/client';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { generateTestCasesWithAI } from '../ai/aiService';

type TestcaseInput = {
  type?: TestcaseType;
  input?: string;
  expectedOutput?: string;
  explanation?: string;
  weight?: number;
  isPublic?: boolean;
};

type OfficialSolutionInput = {
  language?: string;
  code?: string;
  complexity?: string;
  explanation?: string;
  isPrimary?: boolean;
};

type CreateProblemInput = {
  slug?: string;
  title?: string;
  statement?: string;
  inputFormat?: string;
  outputFormat?: string;
  constraints?: string;
  difficultyRating?: number;
  difficultyLabel?: string;
  tags?: string[];
  visibility?: ProblemVisibility;
  timeLimitMs?: number;
  memoryLimitMb?: number;
  checkerType?: CheckerType;
  checkerCode?: string;
  validatorCode?: string;
  generatorCode?: string;
  createdById?: string;
  testcases?: TestcaseInput[];
  officialSolutions?: OfficialSolutionInput[];
  editorial?: {
    title?: string;
    bodyMarkdown?: string;
    hints?: unknown;
    published?: boolean;
  };
};

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function createInternalProblem(input: CreateProblemInput) {
  const title = String(input.title || '').trim();
  const statement = String(input.statement || '').trim();
  const slug = slugify(input.slug || title);

  if (!title) throw new Error('Problem title is required');
  if (!slug) throw new Error('Problem slug is required');
  if (!statement) throw new Error('Problem statement is required');

  return prisma.problem.create({
    data: {
      problemCode: slug,
      slug: slug,
      title: title,
      description: statement,
      rating: input.difficultyRating || null,
      tags: input.tags || [],
      source: ProblemSource.INTERNAL,
      platform: Platform.DIVINECODE,
      visibility: input.visibility || ProblemVisibility.DRAFT,
      checkerType: input.checkerType || CheckerType.EXACT,
      authorId: input.createdById || null,
      testcases: {
        create: (input.testcases || []).map((testcase, index) => ({
          type: testcase.type || (testcase.isPublic ? TestcaseType.SAMPLE : TestcaseType.HIDDEN),
          input: testcase.input ?? '',
          expectedOutput: testcase.expectedOutput ?? '',
          explanation: testcase.explanation || null,
          weight: Math.max(1, Number(testcase.weight || 1)),
          order: index,
          isPublic: Boolean(testcase.isPublic)
        }))
      },
      officialSolutions: {
        create: (input.officialSolutions || []).map((solution, index) => ({
          language: String(solution.language || 'cpp'),
          code: String(solution.code || ''),
          complexity: solution.complexity || null,
          explanation: String(solution.explanation || ''),
          isPrimary: index === 0 || Boolean(solution.isPrimary)
        }))
      },
      editorial: input.editorial?.bodyMarkdown
        ? {
            create: {
              title: input.editorial.title || `${title} Editorial`,
              bodyMarkdown: input.editorial.bodyMarkdown,
              hints: input.editorial.hints as any,
              publishedAt: input.editorial.published ? new Date() : null
            }
          }
        : undefined
    },
    include: { testcases: true, officialSolutions: true, editorial: true }
  });
}

// 👉 NEW: AI Test Case Generator
// Replace the existing function with this one:
export async function generateAndAppendAITestcases(problemId: string, providedMasterSolution: string) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId } });
  if (!problem) throw new Error('Problem not found');
  
  // Use the provided solution from the frontend prompt
  const generatedCases = await generateTestCasesWithAI(problem.description || problem.title, providedMasterSolution);

  const testcaseRecords = generatedCases.map((tc: any, index: number) => ({
    problemId: problem.id,
    type: TestcaseType.SYSTEM,
    input: tc.input,
    expectedOutput: tc.expectedOutput,
    explanation: tc.explanation,
    isPublic: false,
    weight: 1,
    order: index + 100 
  }));

  await prisma.testcase.createMany({ data: testcaseRecords });
  return generatedCases;
}
export async function syncTestCasesFromCodeforces(problemId: string, url: string) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const scrapedCases: TestcaseInput[] = [];

    $('.input pre').each((i, el) => {
      const input = $(el).text();
      const expectedOutput = $('.output pre').eq(i).text();
      
      scrapedCases.push({
        type: TestcaseType.SAMPLE,
        input: input.trim(),
        expectedOutput: expectedOutput.trim(),
        isPublic: true,
        weight: 1
      });
    });

    return await prisma.problem.update({
      where: { id: problemId },
      data: {
        testcases: {
          create: scrapedCases.map((tc, index) => ({
            type: tc.type || TestcaseType.SAMPLE,
            input: tc.input ?? '',
            expectedOutput: tc.expectedOutput ?? '',
            weight: tc.weight || 1,
            order: index,
            isPublic: !!tc.isPublic
          }))
        }
      }
    });
  } catch (error) {
    console.error(error);
    throw new Error('Failed to scrape Codeforces test cases');
  }
}