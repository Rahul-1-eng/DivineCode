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
  throw new Error('Unsupported platform URL for direct scraping.');
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