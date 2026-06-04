import axios from 'axios';
import * as cheerio from 'cheerio';

export interface ScrapedProblem {
  title: string;
  descriptionHtml: string; // We keep HTML so images/MathJax render properly on the frontend
  testcases: { input: string; expectedOutput: string }[];
  platform: 'CODEFORCES' | 'LEETCODE' | 'OTHER';
  originalUrl: string;
}

export async function scrapeProblemFromUrl(url: string): Promise<ScrapedProblem> {
  if (url.includes('codeforces.com')) {
    return await scrapeCodeforces(url);
  }
  // Add Leetcode/Codechef routing here via Puppeteer if needed later
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
    
    // Extract Problem Description HTML (so images and MathJax stay intact)
    const descriptionHtml = $('.problem-statement > div:not(.header):not(.sample-tests)').html() || '';

    // Extract Test Cases
    const testcases: { input: string; expectedOutput: string }[] = [];
    
    $('.sample-tests .sample-test').each((_, element) => {
      const inputs = $(element).find('.input pre');
      const outputs = $(element).find('.output pre');
      
      inputs.each((index, inputElem) => {
        // CF formats inputs with <br> tags or divs inside the pre block
        let rawInput = $(inputElem).html()?.replace(/<br\s*\/?>/gi, '\n') || '';
        rawInput = cheerio.load(rawInput).text().trim(); // Strip remaining tags

        let rawOutput = $(outputs[index]).html()?.replace(/<br\s*\/?>/gi, '\n') || '';
        rawOutput = cheerio.load(rawOutput).text().trim();

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