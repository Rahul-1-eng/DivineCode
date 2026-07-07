/**
 * @file language.ts
 * @author Rahul
 * @description Language heuristics for imported problem content. The platform
 * serves an English-speaking audience — statements that are mostly CJK
 * (Japanese AtCoder tasks, Chinese mirrors) are treated as unreadable.
 */

/** True when less than 5% of the visible characters are CJK. */
export function isMostlyEnglish(htmlOrText: string): boolean {
  const text = String(htmlOrText || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return true;
  // Hiragana/Katakana (U+3000–30FF), CJK Unified (U+3400–9FFF),
  // compatibility ideographs (U+F900–FAFF), half-width kana (U+FF66–FF9F)
  const cjk = (text.match(/[　-ヿ㐀-鿿豈-﫿ｦ-ﾟ]/g) || []).length;
  return cjk / text.length < 0.05;
}
