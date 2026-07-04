/**
 * @file problemScraper.ts
 * @author Rahul Kumar Sahoo
 * @description Extracts problem statements and sample cases from supported coding platforms.
 */
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
  success?: boolean;
}

export async function scrapeProblemFromUrl(url: string) {
  let result: ScrapedProblem;

  try {
    if (url.includes('codeforces.com')) {
      result = await scrapeCodeforces(url);
      result.success = true;
      result.requiresRedirect = false;
    } else if (url.includes('leetcode.com')) {
      result = await scrapeGenericPlatform(url);
      result.success = true;
      result.requiresRedirect = false;
    } else {
      result = await scrapeGenericPlatform(url);
      result.success = true;
      result.requiresRedirect = false;
    }
  } catch (error) {
    console.error(`[Scraper] Full extraction failed for ${url}, enforcing redirect.`);
    result = { 
      title: 'External Platform Problem',
      descriptionHtml: `
        <div style="text-align:center; padding: 40px; background: #0f172a; border: 1px solid #334155; border-radius: 8px;">
            <h3 style="color: #38bdf8; margin-bottom: 10px;">Original Problem Required</h3>
            <p style="color: #94a3b8; margin-bottom: 25px;">Due to platform security restrictions, the full problem description could not be scraped. Please view the question on the original platform.</p>
            <a href="${url}" target="_blank" style="display: inline-block; padding: 12px 24px; background: #38bdf8; color: #000; font-weight: bold; border-radius: 6px; text-decoration: none;">View Original Problem</a>
        </div>`,
      testcases: [],
      platform: 'OTHER',
      originalUrl: url,
      success: false,
      requiresRedirect: true
    };
  }

  // The scraper now focuses on problem content and avoids unrelated media enrichment.

  return result;
}

async function scrapeCodeforces(url: string): Promise<ScrapedProblem> {
  try {
    const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
    const $ = cheerio.load(data);
    const title = $('.problem-statement .header .title').text().trim() || 'Codeforces Problem';
    const descriptionHtml = $('.problem-statement > div:not(.header):not(.sample-tests)').html() || '';

    const testcases: { input: string; expectedOutput: string }[] = [];
    $('.sample-tests .sample-test').each((_, element) => {
      const inputs = $(element).find('.input pre');
      const outputs = $(element).find('.output pre');
      inputs.each((index, inputElem) => {
        const rawInput = cheerio.load($(inputElem).html()?.replace(/<br\s*\/?>/gi, '\n') || '')('body').text().trim();
        const rawOutput = cheerio.load($(outputs[index]).html()?.replace(/<br\s*\/?>/gi, '\n') || '')('body').text().trim();
        if (rawInput && rawOutput) testcases.push({ input: rawInput, expectedOutput: rawOutput });
      });
    });

    return { title, descriptionHtml, testcases, platform: 'CODEFORCES', originalUrl: url, requiresRedirect: false };
  } catch (error) {
    return {
      title: 'Codeforces Problem',
      descriptionHtml: `<div style="text-align:center; padding: 40px; background: #0f172a; border: 1px solid #334155; border-radius: 8px;"><h3 style="color: #38bdf8; margin-bottom: 10px;">Codeforces Problem</h3><p style="color: #94a3b8; margin-bottom: 25px;">Codeforces Cloudflare protection blocked direct extraction. Please view the description directly on Codeforces.</p><a href="${url}" target="_blank" style="display: inline-block; padding: 12px 24px; background: #38bdf8; color: #000; font-weight: bold; border-radius: 6px; text-decoration: none;">View on Codeforces</a></div>`,
      testcases: [], platform: 'CODEFORCES', originalUrl: url, requiresRedirect: true
    };
  }
}

async function scrapeGenericPlatform(url: string): Promise<ScrapedProblem> {
  try {
    const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
    const $ = cheerio.load(data);
    const title = $('h1').first().text().trim() || $('title').text().trim() || 'External Problem';
    
    $('script, style, nav, footer, header').remove();
    
    let descriptionHtml = $('.problem-description').html() || 
                          $('.question-content').html() || 
                          $('article').html() || 
                          $('main').html() || '';

    const testcases: { input: string; expectedOutput: string }[] = [];
    const preTags = $('pre');
    if (preTags.length >= 2) {
      for (let i = 0; i < preTags.length - 1; i += 2) {
        const input = $(preTags[i]).text().trim();
        const output = $(preTags[i+1]).text().trim();
        if (input && output) testcases.push({ input, expectedOutput: output });
      }
    }

    return { 
      title, 
      descriptionHtml: descriptionHtml ? `<h3>${title}</h3><div style="margin-top: 15px;">${descriptionHtml}</div>` : 'Description formatting failed, please use the external link.', 
      testcases, 
      platform: 'OTHER', 
      originalUrl: url, 
      requiresRedirect: false 
    };
  } catch (error) {
    return {
      title: 'External Problem',
      descriptionHtml: `<div style="text-align:center; padding: 40px; background: #0f172a; border: 1px solid #334155; border-radius: 8px;"><h3 style="color: #38bdf8; margin-bottom: 10px;">Scraping Blocked</h3><p style="color: #94a3b8; margin-bottom: 25px;">Please read the problem statement on the original platform.</p><a href="${url}" target="_blank" style="display: inline-block; padding: 12px 24px; background: #38bdf8; color: #000; font-weight: bold; border-radius: 6px; text-decoration: none;">View Original Problem</a></div>`,
      testcases: [], platform: 'OTHER', originalUrl: url, requiresRedirect: true
    };
  }
}