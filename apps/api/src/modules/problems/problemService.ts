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

  return prisma.problem.create({
    data: {
      problemCode: slug,            // Fills the required problemCode field
      slug: slug,                   // Fills the optional slug field
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
          input: String(testcase.input || ''),
          expectedOutput: String(testcase.expectedOutput || ''),
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
    include: {
      testcases: true,
      officialSolutions: true,
      editorial: true
    }
  });
}
