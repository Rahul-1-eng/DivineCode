import { CheckerType, Platform, ProblemSource, ProblemVisibility, TestcaseType } from '@prisma/client';
import { prisma } from '../../prisma/client';

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
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function createInternalProblem(input: CreateProblemInput) {
  const title = String(input.title || '').trim();
  const statement = String(input.statement || '').trim();
  const slug = slugify(input.slug || title);

  if (!title) throw new Error('Problem title is required');
  if (!slug) throw new Error('Problem slug is required');
  if (!statement) throw new Error('Problem statement is required');
  if (!input.testcases?.length) throw new Error('At least one testcase is required');
  if (!input.officialSolutions?.length) throw new Error('At least one official solution is required');

  return prisma.problem.create({
    data: {
      slug,
      title,
      statement,
      inputFormat: input.inputFormat || null,
      outputFormat: input.outputFormat || null,
      constraints: input.constraints || null,
      difficultyRating: input.difficultyRating || null,
      difficultyLabel: input.difficultyLabel || null,
      tags: input.tags || [],
      source: ProblemSource.INTERNAL,
      platform: Platform.DIVINECODE,
      visibility: input.visibility || ProblemVisibility.DRAFT,
      timeLimitMs: Math.max(250, Number(input.timeLimitMs || 2000)),
      memoryLimitMb: Math.max(16, Number(input.memoryLimitMb || 256)),
      checkerType: input.checkerType || CheckerType.EXACT,
      checkerCode: input.checkerCode || null,
      validatorCode: input.validatorCode || null,
      generatorCode: input.generatorCode || null,
      createdById: input.createdById || null,
      testcases: {
        create: input.testcases.map((testcase, index) => ({
          type: testcase.type || (testcase.isPublic ? TestcaseType.SAMPLE : TestcaseType.HIDDEN),
          input: String(testcase.input || ''),
          expectedOutput: String(testcase.expectedOutput || ''),
          explanation: testcase.explanation || null,
          weight: Math.max(1, Number(testcase.weight || 1)),
          order: index,
          isPublic: Boolean(testcase.isPublic)
        }))
      },
      officialSolutions: {
        create: input.officialSolutions.map((solution, index) => ({
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
    include: {
      testcases: true,
      officialSolutions: true,
      editorial: true
    }
  });
}
