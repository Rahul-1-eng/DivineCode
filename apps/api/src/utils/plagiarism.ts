// apps/api/src/utils/plagiarism.ts

/**
 * Normalizes code by stripping comments and normalizing tokens.
 * Used for plagiarism detection to ensure variable renaming doesn't bypass checks.
 */
export function normalizeCodeForAST(code: string): string {
  return code
    .replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '') // Strip comments
    .replace(/".*?"|'.*?'/g, '"STR"')        // Normalize strings to prevent string-bypass
    .replace(/\b\d+\b/g, 'NUM')              // Normalize specific numbers
    .replace(/\s+/g, '')                     // Erase all whitespace/formatting
    .trim();
}

/**
 * Calculates similarity between two strings using 3-gram sets.
 * Returns a score between 0.0 and 1.0.
 */
export function calculateStructuralSimilarity(s1: string, s2: string): number {
  const getNGrams = (s: string, n: number) => {
    const grams = new Set<string>();
    for (let i = 0; i <= s.length - n; i++) grams.add(s.substring(i, i + n));
    return grams;
  };
  
  const set1 = getNGrams(s1, 3);
  const set2 = getNGrams(s2, 3);
  if (set1.size === 0 && set2.size === 0) return 1;
  
  let intersection = 0;
  set1.forEach(g => { if (set2.has(g)) intersection++; });
  const union = set1.size + set2.size - intersection;
  return intersection / union;
}