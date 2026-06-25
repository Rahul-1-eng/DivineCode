// apps/api/src/utils/plagiarism.test.ts
import { normalizeCodeForAST, calculateStructuralSimilarity } from './plagiarism';

describe('Plagiarism Engine', () => {
  
  test('normalizeCodeForAST should strip comments and whitespace', () => {
    const code = `
      // This is a comment
      int x = 10; /* block comment */
      printf("Hello");
    `;
    const normalized = normalizeCodeForAST(code);
    expect(normalized).not.toContain('//');
    expect(normalized).not.toContain('/*');
    expect(normalized).toContain('intx=NUM;'); // Normalized variable and number
    expect(normalized).toContain('"STR"');      // Normalized string
  });

  test('calculateStructuralSimilarity should detect high similarity', () => {
    const codeA = 'int a = 1; int b = 2; return a + b;';
    const codeB = 'int x = 5; int y = 8; return x + y;'; // Renamed variables, different numbers
    
    const normA = normalizeCodeForAST(codeA);
    const normB = normalizeCodeForAST(codeB);
    
    const score = calculateStructuralSimilarity(normA, normB);
    
    // Should be very high because structural logic is identical
    expect(score).toBeGreaterThan(0.85);
  });

  test('calculateStructuralSimilarity should return low score for different code', () => {
    const codeA = 'for(int i=0; i<10; i++) print(i);';
    const codeB = 'if(x > 5) return true; else return false;';
    
    const score = calculateStructuralSimilarity(normalizeCodeForAST(codeA), normalizeCodeForAST(codeB));
    
    expect(score).toBeLessThan(0.3);
  });
});