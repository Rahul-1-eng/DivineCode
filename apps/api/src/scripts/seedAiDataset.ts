/**
 * @file seedAiDataset.ts
 * @author Rahul Kumar Sahoo
 * @description Maintenance utility for the application.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { PrismaClient } from '@prisma/client';
import { scrapeProblemFromUrl } from '../modules/external-sync/problemScraper';

// --- Robust Environment Loader ---
const rootEnv = path.resolve(process.cwd(), '.env');
const apiEnv = path.resolve(process.cwd(), 'apps/api/.env');
if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
    console.log(`✅ Loaded .env from root: ${rootEnv}`);
} else if (fs.existsSync(apiEnv)) {
    dotenv.config({ path: apiEnv });
    console.log(`✅ Loaded .env from apps/api: ${apiEnv}`);
} else {
    console.warn("⚠️ Warning: No .env file found. Ensure DATABASE_URL is set in your environment.");
}

const prisma = new PrismaClient();

// ---- Tunables ----
const CODEFORCES_LIMIT = 80;
const CODEFORCES_RATING_MIN = 800;
const CODEFORCES_RATING_MAX = 2400; // extended: senior-level questions included
const ATCODER_LIMIT = 30;
const LEETCODE_LIMIT = 60;
const REQUEST_DELAY_MS = 1500; // be polite — don't hammer source platforms

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Non-English statements (Japanese AtCoder pages, Chinese mirrors) must never
// land in the dataset — if a meaningful share of the visible text is CJK,
// store the row as redirect-only instead of showing unreadable content.
function isMostlyEnglish(html: string): boolean {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return true;
  const cjk = (text.match(/[　-ヿ㐀-鿿豈-﫿ｦ-ﾟ]/g) || []).length;
  return cjk / text.length < 0.05;
}

function difficultyFromRating(rating: number | undefined): 'Easy' | 'Medium' | 'Hard' {
  if (!rating) return 'Medium';
  if (rating < 1200) return 'Easy';
  if (rating < 1700) return 'Medium';
  return 'Hard';
}

type ImportRow = {
  title: string;
  descriptionHtml: string;
  platform: string;
  originalUrl: string;
  tags: string[];
  difficulty: 'Easy' | 'Medium' | 'Hard';
  testcases: { input: string; expectedOutput: string }[];
};

// -----------------------------------------------------------------------
// CODEFORCES — real public API for listing. Statement extraction is
// attempted via the existing scraper; when Cloudflare blocks it, the row
// is stored as redirect-only (empty description + originalUrl) instead
// of guessing at content.
// -----------------------------------------------------------------------
async function importCodeforces(): Promise<ImportRow[]> {
  console.log('Fetching Codeforces problem list...');
  const { data } = await axios.get('https://codeforces.com/api/problemset.problems');
  if (data.status !== 'OK') throw new Error('Codeforces API rejected the request');

  // Sample evenly across the rating range instead of taking the N easiest, so
  // the dataset actually contains hard (1900–2400) senior-level problems too.
  const pool = (data.result.problems as any[])
    .filter((p) => p.rating && p.rating >= CODEFORCES_RATING_MIN && p.rating <= CODEFORCES_RATING_MAX)
    .sort((a, b) => (a.rating || 0) - (b.rating || 0));
  const step = Math.max(1, Math.floor(pool.length / CODEFORCES_LIMIT));
  const candidates = pool.filter((_, i) => i % step === 0).slice(0, CODEFORCES_LIMIT);

  const rows: ImportRow[] = [];

  for (const problem of candidates) {
    const url = `https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index}`;
    console.log(`  [CF] ${problem.contestId}${problem.index} - ${problem.name}`);

    let descriptionHtml = '';
    let testcases: { input: string; expectedOutput: string }[] = [];

    try {
      const scraped = await scrapeProblemFromUrl(url);
      const extracted = scraped.success !== false && !scraped.requiresRedirect && scraped.testcases.length > 0;
      if (extracted && isMostlyEnglish(scraped.descriptionHtml)) {
        descriptionHtml = scraped.descriptionHtml;
        testcases = scraped.testcases;
      }
    } catch (err) {
      console.warn(`    extraction failed for ${url}, storing as redirect-only`);
    }

    rows.push({
      title: problem.name,
      descriptionHtml, // empty string => frontend shows "open on Codeforces" instead of fake content
      platform: 'Codeforces',
      originalUrl: url,
      tags: problem.tags || [],
      difficulty: difficultyFromRating(problem.rating),
      testcases
    });

    await sleep(REQUEST_DELAY_MS);
  }

  return rows;
}

// -----------------------------------------------------------------------
// ATCODER — no official API, but the community-run kenkoooo.com mirror is
// a stable, widely-used source for the problem list. AtCoder's pages
// don't actively block scrapers, so extraction succeeds much more often.
// -----------------------------------------------------------------------
async function scrapeAtCoderProblem(url: string) {
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const $ = cheerio.load(data);

  // ENGLISH ONLY: older tasks have no .lang-en panel — falling back to the raw
  // #task-statement used to leak Japanese statements into the AI Avatar
  // dataset. Those tasks are now stored redirect-only instead.
  const englishPanel = $('#task-statement .lang-en');
  if (!englishPanel.length) {
    return { descriptionHtml: '', testcases: [] as { input: string; expectedOutput: string }[] };
  }
  const descriptionHtml = englishPanel.html() || '';

  const testcases: { input: string; expectedOutput: string }[] = [];
  const sections = englishPanel.find('.part');
  let pendingInput: string | null = null;

  sections.each((_, section) => {
    const heading = $(section).find('h3').first().text();
    const pre = $(section).find('pre').first().text().trim();
    if (!pre) return;
    if (/sample input/i.test(heading)) {
      pendingInput = pre;
    } else if (/sample output/i.test(heading) && pendingInput !== null) {
      testcases.push({ input: pendingInput, expectedOutput: pre });
      pendingInput = null;
    }
  });

  return { descriptionHtml, testcases };
}

async function importAtCoder(): Promise<ImportRow[]> {
  console.log('Fetching AtCoder problem list (kenkoooo mirror)...');
  const { data } = await axios.get('https://kenkoooo.com/atcoder/resources/problems.json');

  // Recent Beginner Contest A–D problems: newer ABCs always carry an English
  // panel, and C/D tasks add genuinely harder material to the pool.
  const candidates = (data as any[])
    .filter((p) => /^abc\d+$/.test(p.contest_id) && /_[a-d]$/.test(p.id))
    .sort((a, b) => String(b.contest_id).localeCompare(String(a.contest_id))) // newest first → English guaranteed
    .slice(0, ATCODER_LIMIT);

  const rows: ImportRow[] = [];

  for (const problem of candidates) {
    const url = `https://atcoder.jp/contests/${problem.contest_id}/tasks/${problem.id}`;
    console.log(`  [AtCoder] ${problem.id} - ${problem.title}`);

    let descriptionHtml = '';
    let testcases: { input: string; expectedOutput: string }[] = [];

    try {
      const scraped = await scrapeAtCoderProblem(url);
      if (scraped.testcases.length > 0 && isMostlyEnglish(scraped.descriptionHtml)) {
        descriptionHtml = scraped.descriptionHtml;
        testcases = scraped.testcases;
      }
    } catch (err) {
      console.warn(`    extraction failed for ${url}, storing as redirect-only`);
    }

    rows.push({
      title: problem.title,
      descriptionHtml,
      platform: 'AtCoder',
      originalUrl: url,
      tags: [],
      difficulty: /_a$/.test(problem.id) ? 'Easy' : /_b$/.test(problem.id) ? 'Easy' : /_c$/.test(problem.id) ? 'Medium' : 'Hard',
      testcases
    });

    await sleep(REQUEST_DELAY_MS);
  }

  return rows;
}

// -----------------------------------------------------------------------
// LEETCODE — the /api/problems/all listing is public JSON; statement content
// comes from the public GraphQL endpoint (works unauthenticated for free
// problems). Paid-only problems are skipped, failures fall back to
// redirect-only rows — never fabricated content.
// -----------------------------------------------------------------------
async function fetchLeetCodeContent(titleSlug: string): Promise<string> {
  const { data } = await axios.post('https://leetcode.com/graphql', {
    operationName: 'questionContent',
    variables: { titleSlug },
    query: 'query questionContent($titleSlug: String!) { question(titleSlug: $titleSlug) { content } }'
  }, {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': `https://leetcode.com/problems/${titleSlug}/`
    },
    timeout: 15000
  });
  return data?.data?.question?.content || '';
}

async function importLeetCode(): Promise<ImportRow[]> {
  console.log('Fetching LeetCode problem list...');
  const { data } = await axios.get('https://leetcode.com/api/problems/all/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    timeout: 20000
  });

  const all = (data?.stat_status_pairs || [])
    .filter((p: any) => !p.paid_only)
    .sort((a: any, b: any) => a.stat.frontend_question_id - b.stat.frontend_question_id);

  // Even mix across difficulty levels (1=Easy, 2=Medium, 3=Hard)
  const perLevel = Math.ceil(LEETCODE_LIMIT / 3);
  const candidates = [1, 2, 3].flatMap(level =>
    all.filter((p: any) => p.difficulty?.level === level).slice(0, perLevel)
  );

  const rows: ImportRow[] = [];
  for (const p of candidates) {
    const slug = p.stat.question__title_slug;
    const url = `https://leetcode.com/problems/${slug}/`;
    console.log(`  [LeetCode] ${p.stat.frontend_question_id}. ${p.stat.question__title}`);

    let descriptionHtml = '';
    try {
      const content = await fetchLeetCodeContent(slug);
      if (content && isMostlyEnglish(content)) descriptionHtml = content;
    } catch (err) {
      console.warn(`    content fetch failed for ${slug}, storing as redirect-only`);
    }

    rows.push({
      title: p.stat.question__title,
      descriptionHtml,
      platform: 'LeetCode',
      originalUrl: url,
      tags: [],
      difficulty: p.difficulty?.level === 1 ? 'Easy' : p.difficulty?.level === 2 ? 'Medium' : 'Hard',
      testcases: [] // LeetCode judges against function signatures, not stdin — redirect to submit
    });

    await sleep(REQUEST_DELAY_MS);
  }
  return rows;
}

// -----------------------------------------------------------------------
// CODECHEF — no public listing or statement API, and the practice pages
// resist scraping. These are real, verified, well-known practice problem
// codes (checked against current CodeChef listings) — but they are
// intentionally redirect-only on principle, not a best-effort scrape
// that might silently grab the wrong thing.
// -----------------------------------------------------------------------
function codechefRedirectOnly(): ImportRow[] {
  const known = [
    { code: 'FLOW001', title: 'Add Two Numbers', difficulty: 'Easy' as const },
    { code: 'INTEST', title: 'Enormous Input Test', difficulty: 'Easy' as const },
    { code: 'HS08TEST', title: 'ATM', difficulty: 'Easy' as const },
    { code: 'START01', title: 'Number Mirror', difficulty: 'Easy' as const },
    { code: 'FLOW002', title: 'Find Remainder', difficulty: 'Easy' as const },
    { code: 'FLOW004', title: 'First and Last Digit', difficulty: 'Easy' as const },
    { code: 'FLOW006', title: 'Sum of Digits', difficulty: 'Easy' as const },
    { code: 'FLOW007', title: 'Reverse The Number', difficulty: 'Easy' as const },
    { code: 'FLOW017', title: 'Second Largest', difficulty: 'Medium' as const },
    { code: 'LUCKFOUR', title: 'Lucky Four', difficulty: 'Medium' as const },
    { code: 'FLOW010', title: 'Id and Ship', difficulty: 'Medium' as const },
    { code: 'FCTRL2', title: 'Small Factorials', difficulty: 'Medium' as const }
  ];

  return known.map((p) => ({
    title: p.title,
    descriptionHtml: '',
    platform: 'CodeChef',
    originalUrl: `https://www.codechef.com/problems/${p.code}`,
    tags: [],
    difficulty: p.difficulty,
    testcases: []
  }));
}

async function main() {
  console.log('Clearing existing fake AI Avatar dataset...');
  await prisma.aiProblemDataset.deleteMany({});

  const allRows: ImportRow[] = [];

  try {
    allRows.push(...(await importCodeforces()));
  } catch (err) {
    console.error('Codeforces import failed entirely:', err);
  }

  try {
    allRows.push(...(await importAtCoder()));
  } catch (err) {
    console.error('AtCoder import failed entirely:', err);
  }

  try {
    allRows.push(...(await importLeetCode()));
  } catch (err) {
    console.error('LeetCode import failed entirely:', err);
  }

  allRows.push(...codechefRedirectOnly());

  console.log(`Inserting ${allRows.length} real problems (some redirect-only)...`);
  await prisma.aiProblemDataset.createMany({
    data: allRows.map((r) => ({
      title: r.title,
      descriptionHtml: r.descriptionHtml,
      platform: r.platform,
      originalUrl: r.originalUrl,
      tags: r.tags,
      difficulty: r.difficulty,
      testcases: r.testcases
    }))
  });

  const extractedCount = allRows.filter((r) => r.testcases.length > 0).length;
  console.log(`✅ Done. ${allRows.length} total problems — ${extractedCount} with full statements+testcases, ${allRows.length - extractedCount} redirect-only.`);
}

main()
  .catch((e) => {
    console.error('Import failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });