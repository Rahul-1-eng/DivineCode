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
    const title = $('.problem-statement .header .title').text().trim() || 'Codeforces Problem';
    const descriptionHtml = $('.problem-statement > div:not(.header):not(.sample-tests)').html() || '';

    const testcases: { input: string; expectedOutput: string }[] = [];
    
    $('.sample-tests .sample-test').each((_, element) => {
      const inputs = $(element).find('.input pre');
      const outputs = $(element).find('.output pre');
      
      inputs.each((index, inputElem) => {
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
    // 👉 FALLBACK INSTEAD OF ERROR
    return {
      title: 'Codeforces Problem',
      descriptionHtml: `<div style="text-align:center; padding: 20px;"><h3>Problem description could not be extracted automatically.</h3><p>Please view the full description and test cases directly on Codeforces.</p><br/><a href="${url}" target="_blank" style="padding: 10px 15px; background: #3b82f6; color: white; border-radius: 6px; text-decoration: none;">View Original Problem ↗</a></div>`,
      testcases: [],
      platform: 'CODEFORCES',
      originalUrl: url
    };
  }
}

async function scrapeGenericPlatform(url: string): Promise<ScrapedProblem> {
  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });

    const $ = cheerio.load(data);
    const title = $('h1').first().text().trim() || $('title').text().trim() || 'External Problem';
    
    $('script, style, nav, footer, header, aside, .sidebar').remove();
    const descriptionHtml = $('article').html() || $('main').html() || $('body').html() || '';

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
    console.warn(`[Scraper] Generic extraction failed for ${url}. Using graceful fallback.`);
    // 👉 FALLBACK INSTEAD OF ERROR
    return {
      title: 'External Problem',
      descriptionHtml: `<div style="text-align:center; padding: 20px;"><h3>Problem description could not be extracted automatically.</h3><p>Please read the problem statement on the original platform.</p><br/><a href="${url}" target="_blank" style="padding: 10px 15px; background: #3b82f6; color: white; border-radius: 6px; text-decoration: none;">View Original Problem ↗</a></div>`,
      testcases: [],
      platform: 'OTHER',
      originalUrl: url
    };
  }
}