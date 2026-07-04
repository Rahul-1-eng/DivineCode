import { buildMockInterviewPrompt } from './aiService';

describe('buildMockInterviewPrompt', () => {
  it('includes the problem prompt, latest response, and code context when provided', () => {
    const prompt = buildMockInterviewPrompt('Two Sum', 'I would use a hashmap.', 'Candidate: I would use a hashmap.', 'function solve() {}');

    expect(prompt).toContain('Two Sum');
    expect(prompt).toContain('I would use a hashmap.');
    expect(prompt).toContain('Candidate: I would use a hashmap.');
    expect(prompt).toContain('function solve() {}');
  });

  it('omits code context when there is no code', () => {
    const prompt = buildMockInterviewPrompt('Queue', 'I would use a deque.', '');

    expect(prompt).toContain('Queue');
    expect(prompt).not.toContain('Candidate\'s Current Editor Code');
  });
});
