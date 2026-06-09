import axios from 'axios';
import * as cheerio from 'cheerio';
import { extractProblemFromTextOrImage } from '../ai/aiService';

export interface ScrapedProblem {
  title: string;
  descriptionHtml: string; 
  testcases: { input: string; expectedOutput: string }[];
  platform: 'CODEFORCES' | 'LEETCODE' | 'OTHER';
  originalUrl: string;
  requiresRedirect?: boolean;
}

export async function scrapeProblemFromUrl(url: string) {
  try {
    if (url.includes('codeforces.com')) {
      const cfData = await scrapeCodeforces(url);
      return { ...cfData, success: true, requiresRedirect: false };
    }

    const genericData = await scrapeGenericPlatform(url);
    return { ...genericData, success: true, requiresRedirect: false };

  } catch (error) {
    console.error(`[Scraper] Full extraction failed for ${url}, enforcing redirect.`);
    
    // Clean Redirect UI - No raw error shown
    return { 
      title: 'External Platform Problem',
      descriptionHtml: `
        <div style="text-align:center; padding: 40px; background: #0f172a; border: 1px solid #334155; border-radius: 8px;">
            <h3 style="color: #38bdf8; margin-bottom: 10px;">Original Problem Required</h3>
            <p style="color: #94a3b8; margin-bottom: 25px;">Due to platform security restrictions, the full problem description could not be scraped. Please view the question on the original platform.</p>
            <a href="${url}" target="_blank" style="display: inline-block; padding: 12px 24px; background: #38bdf8; color: #000; font-weight: bold; border-radius: 6px; text-decoration: none;">View Original Problem</a>
        </div>`,
      testcases: [],
      platform: 'OTHER' as const,
      originalUrl: url,
      success: false,
      requiresRedirect: true
    };
  }
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
      originalUrl: url,
      requiresRedirect: false
    };
  } catch (error) {
    console.error('[Scraper] Codeforces extraction failed:', error);
    return {
      title: 'Codeforces Problem',
      descriptionHtml: `
        <div style="text-align:center; padding: 40px; background: #0f172a; border: 1px solid #334155; border-radius: 8px;">
            <h3 style="color: #38bdf8; margin-bottom: 10px;">Codeforces Problem</h3>
            <p style="color: #94a3b8; margin-bottom: 25px;">Codeforces Cloudflare protection blocked direct extraction. Please view the description and test cases directly on Codeforces.</p>
            <a href="${url}" target="_blank" style="display: inline-block; padding: 12px 24px; background: #38bdf8; color: #000; font-weight: bold; border-radius: 6px; text-decoration: none;">View on Codeforces</a>
        </div>`,
      testcases: [],
      platform: 'CODEFORCES',
      originalUrl: url,
      requiresRedirect: true
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
      originalUrl: url,
      requiresRedirect: false
    };
  } catch (error) {
    console.warn(`[Scraper] Generic extraction failed for ${url}. Using graceful fallback.`);
    return {
      title: 'External Problem',
      descriptionHtml: `
        <div style="text-align:center; padding: 40px; background: #0f172a; border: 1px solid #334155; border-radius: 8px;">
            <h3 style="color: #38bdf8; margin-bottom: 10px;">Scraping Blocked</h3>
            <p style="color: #94a3b8; margin-bottom: 25px;">Please read the problem statement on the original platform.</p>
            <a href="${url}" target="_blank" style="display: inline-block; padding: 12px 24px; background: #38bdf8; color: #000; font-weight: bold; border-radius: 6px; text-decoration: none;">View Original Problem</a>
        </div>`,
      testcases: [],
      platform: 'OTHER',
      originalUrl: url,
      requiresRedirect: true
    };
  }
}