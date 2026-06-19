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

// 🚀 NEW: Invisible YouTube Fetcher
async function fetchYouTubeTutorial(problemTitle: string, platform: string): Promise<string | null> {
  try {
    const query = encodeURIComponent(`${platform} ${problemTitle} solution tutorial`);
    const { data } = await axios.get(`https://www.youtube.com/results?search_query=${query}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    // Extract the very first video ID from the raw YouTube state graph
    const match = data.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    if (match && match[1]) {
      return match[1]; 
    }
  } catch (e) {
    console.error("[YouTube Fetcher] Failed to grab tutorial.", e);
  }
  return null;
}

export async function scrapeProblemFromUrl(url: string) {
  let result: ScrapedProblem;
  let platformName = 'OTHER';

  try {
    if (url.includes('codeforces.com')) {
      platformName = 'Codeforces';
      result = await scrapeCodeforces(url);
      result.success = true;
      result.requiresRedirect = false;
    } else if (url.includes('leetcode.com')) {
      platformName = 'LeetCode';
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

  // 🚀 Auto-Fetch and Inject YouTube Tutorial into the HTML
  const ytVideoId = await fetchYouTubeTutorial(result.title, platformName);
  if (ytVideoId) {
    result.descriptionHtml += `
      <div style="margin-top: 40px; padding: 20px; background: #0f172a; border-radius: 12px; border: 1px solid #1e293b; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
          <h3 style="color: #f87171; margin: 0 0 15px; display: flex; align-items: center; gap: 8px;">
              ▶️ Auto-Fetched Video Tutorial
          </h3>
          <div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; border-radius: 8px; border: 1px solid #334155; background: #000;">
              <iframe style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" src="https://www.youtube.com/embed/${ytVideoId}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
          </div>
          <p style="color: #64748b; font-size: 12px; margin-top: 10px; text-align: center;">Fetched dynamically based on the problem title.</p>
      </div>`;
  }

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