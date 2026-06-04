import axios from 'axios';
import * as cheerio from 'cheerio';

export interface ScrapedProblem {
  title: string;
  descriptionHtml: string; 
  testcases: { input: string; expectedOutput: string }[];
  platform: 'CODEFORCES' | 'LEETCODE' | 'OTHER';
  originalUrl: string;
}

export async function scrapeProblemFromUrl(url: string): Promise<ScrapedProblem> {
  if (url.includes('codeforces.com')) {
    return await scrapeCodeforces(url);
  }
  
  // 👉 NEW: If it's not Codeforces, try the Universal Generic Scraper
  return await scrapeGenericPlatform(url);
}

async function scrapeCodeforces(url: string): Promise<ScrapedProblem> {
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const $ = cheerio.load(data);
    
    // Extract Title
    const title = $('.problem-statement .header .title').text().trim();
    
    // Extract Problem Description HTML
    const descriptionHtml = $('.problem-statement > div:not(.header):not(.sample-tests)').html() || '';

    // Extract Test Cases
    const testcases: { input: string; expectedOutput: string }[] = [];
    
    $('.sample-tests .sample-test').each((_, element) => {
      const inputs = $(element).find('.input pre');
      const outputs = $(element).find('.output pre');
      
      inputs.each((index, inputElem) => {
        // 👉 TS FIX: We load the HTML snippet, select the body, then extract text.
        // This bypasses the TS2339 Root type error completely.
        const rawInputHtml = $(inputElem).html()?.replace(/<br\s*\/?>/gi, '\n') || '';
        const parsedInput$ = cheerio.load(rawInputHtml);
        const rawInput = parsedInput$('body').text().trim();

        const rawOutputHtml = $(outputs[index]).html()?.replace(/<br\s*\/?>/gi, '\n') || '';
        const parsedOutput$ = cheerio.load(rawOutputHtml);
        const rawOutput = parsedOutput$('body').text().trim();

        if (rawInput && rawOutput) {
          testcases.push({ input: rawInput, expectedOutput: rawOutput });
        }
      });
    });

    return {
      title,
      descriptionHtml,
      testcases,
      platform: 'CODEFORCES',
      originalUrl: url
    };
  } catch (error) {
    console.error('[Scraper] Codeforces extraction failed:', error);
    throw new Error('Failed to parse the Codeforces problem. Ensure the URL is accessible.');
  }
}

// 👉 NEW FUNCTION: Universal Fetcher for ANY website
async function scrapeGenericPlatform(url: string): Promise<ScrapedProblem> {
  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0' }
    });

    const $ = cheerio.load(data);
    
    // 1. Extract Title
    const title = $('h1').first().text().trim() || $('title').text().trim() || 'External Problem';
    
    // 2. Clean and Extract Main Content
    // Remove useless elements before extracting HTML
    $('script, style, nav, footer, header, aside, .sidebar').remove();
    const descriptionHtml = $('article').html() || $('main').html() || $('body').html() || `<p>View original problem: <a href="${url}">${url}</a></p>`;

    // 3. Fallback Test Cases (Hunt for <pre> tags. Assume even indexes are input, odds are output)
    const testcases: { input: string; expectedOutput: string }[] = [];
    const preTags = $('pre');
    
    if (preTags.length >= 2) {
      for (let i = 0; i < preTags.length - 1; i += 2) {
        const input = $(preTags[i]).text().trim();
        const output = $(preTags[i+1]).text().trim();
        if (input && output) {
          testcases.push({ input, expectedOutput: output });
        }
      }
    }

    return {
      title,
      descriptionHtml: `<h3>${title}</h3><div style="margin-top: 15px;">${descriptionHtml}</div>`,
      testcases,
      platform: 'OTHER',
      originalUrl: url
    };
  } catch (error) {
    console.warn(`[Scraper] Generic extraction failed for ${url}. Throwing to trigger URL Fallback.`);
    throw new Error('Failed to parse external URL.');
  }
}