/**
 * @file aiService.ts
 * @author Rahul Kumar Sahoo
 * @description Core AI orchestration layer. Handles resilient routing between Claude and Gemini,
 * structured data extraction, and fallback logic for API rate limits.
 */
import axios from 'axios';
import { prisma } from '../../prisma/client';
import Anthropic from '@anthropic-ai/sdk';

// -----------------------------------------------------------------------------
// Engine Configuration & Telemetry
// -----------------------------------------------------------------------------
const USE_CLAUDE_API = process.env.USE_CLAUDE_API === 'true';
const CACHE_TTL_MS = 3600000; // 1 hour threshold to reduce redundant LLM calls

const getAiModel = () => process.env.AI_MODEL || 'gemini-1.5-flash';
const getApiKey = () => process.env.AI_API_KEY;

// -----------------------------------------------------------------------------
// Structural Type Contracts
// -----------------------------------------------------------------------------
export interface ResourceLink {
  title: string;
  url: string;
}

interface CacheEntry {
  response: string;
  timestamp: number;
}

interface LogicAnalysisResult {
  feedback: string;
  complexity: string;
  similarityScore: number;
  isPlagiarized: boolean;
}

interface ExtractionResult {
  title: string;
  descriptionHtml: string;
  testcases: { input: string; expectedOutput: string }[];
  requiresRedirect?: boolean;
}

interface TestCase {
  input: string;
  expectedOutput: string;
  explanation?: string;
}

interface DebugResult {
  hint: string;
  input: string;
  expectedOutput: string;
  steps?: string[];
  motivation?: string;
}

interface SolutionExplanation {
  summary: string;
  steps: string[];
  complexity: string;
}

export interface InterviewEvaluation {
  feedback: string;
  followUpQuestion: string;
  technicalScore: number;
  fluencyScore: number;
  pronunciationTips: string;
  isPassed: boolean;
}

export interface WeaknessAnalysis {
  weaknesses: { topic: string; reason: string }[];
  radarUpdates: { subject: string; scoreDelta: number }[];
}

// -----------------------------------------------------------------------------
// Internal Cache Strategy
// -----------------------------------------------------------------------------
// A lightweight in-memory cache reduces duplicate LLM calls for repeated prompts while keeping the service simple to run locally and in production.
const qaCache = new Map<string, CacheEntry>();

function getCacheKey(question: string): string {
  return question.toLowerCase().trim();
}

function getCachedResponse(question: string): string | null {
  const key = getCacheKey(question);
  const cached = qaCache.get(key);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.response;
  }
  
  qaCache.delete(key);
  return null;
}

function setCachedResponse(question: string, response: string): void {
  qaCache.set(getCacheKey(question), { response, timestamp: Date.now() });
}

// -----------------------------------------------------------------------------
// Core Utilities
// -----------------------------------------------------------------------------

/**
 * Safely parses JSON structures from raw LLM outputs.
 * Note: LLMs often hallucinate markdown wrappers or `<think>` blocks. This strips them prior to standard parsing.
 */
function parseAiJsonResponse<T>(text: string, isArray = false): T {
  try {
    let cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    
    // Attempt aggressive extraction if the model wrapped the response in conversational text
    const match = isArray ? cleanText.match(/\[[\s\S]*\]/) : cleanText.match(/\{[\s\S]*\}/);
    if (match) {
        return JSON.parse(match[0]) as T;
    }
    
    cleanText = cleanText.replace(/```json/gi, '').replace(/```/g, '').trim();
    return JSON.parse(cleanText) as T;
  } catch (err) {
    console.error('[AI Parser Error] Failed to deserialize payload:', err);
    // Return empty structures to prevent hard crashes downstream
    return (isArray ? [] : {}) as T;
  }
}

/**
 * Strips base64 image hashes from HTML payloads.
 * Extremely important to prevent blowing up the LLM context window size constraints.
 */
function sanitizeDescriptionForPrompt(html: string): string {
  if (!html) return '';
  return html.replace(/<img[^>]*src="data:image[^>]*>/g, '[Image Reference Omitted]');
}

/**
 * Provides static fallback resources if AI resolution fails or dynamic generation times out.
 */
export function resolveTopicResources(topic: string, queryTags: string[] = []): ResourceLink[] {
  const normalized = topic.toLowerCase() || (queryTags[0] ? queryTags[0].toLowerCase() : 'general');
  
  const coreRegistry: Record<string, ResourceLink[]> = {
    'dynamic programming': [
      { title: 'MIT 6.006: Dynamic Programming I', url: 'https://www.youtube.com/watch?v=OQ5jsbhAv_M' },
      { title: 'CP-Algorithms: DP Techniques', url: 'https://cp-algorithms.com/dynamic_programming/intro-to-dp.html' }
    ],
    'graphs': [
      { title: 'Graph Theory Foundations & Traversals', url: 'https://www.youtube.com/watch?v=pcKY4hjDrxk' },
      { title: 'CP-Algorithms: Breadth-First Search', url: 'https://cp-algorithms.com/graph/breadth-first-search.html' }
    ],
    'bit manipulation': [
      { title: 'Bit Twiddling Hacks & Optimization', url: 'https://graphics.stanford.edu/~seander/bithacks.html' },
      { title: 'Advanced Bitwise Operations Guide', url: 'https://www.youtube.com/watch?v=ZcoGeOIw3B4' }
    ]
  };

  for (const key of Object.keys(coreRegistry)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return coreRegistry[key];
    }
  }

  return [
    { title: 'MIT 6.006: Introduction to Algorithms', url: 'https://www.youtube.com/playlist?list=PLUl4u3cNGP61Oq3tWYp6V_F-5jb5L2iHb' },
    { title: 'Competitive Programmer Handbook Resources', url: 'https://cses.fi/book/book.pdf' }
  ];
}

// -----------------------------------------------------------------------------
// Business Logic Pipelines
// -----------------------------------------------------------------------------

export async function analyzeSubmissionLogic(submissionId: string, problemDescription: string, userCode: string) {
  const apiKey = getApiKey();
  if (!apiKey) return;

  const prompt = `You are an expert code reviewer. Problem Description: ${sanitizeDescriptionForPrompt(problemDescription)}\nSubmitted Code:\n${userCode}\nAnalyze this code. Provide exactly four things:\n1. A short paragraph of feedback on the logic (is it optimal?).\n2. The Big-O Time Complexity (e.g., O(N log N)).\n3. A similarity score from 0.0 to 1.0 indicating how similar this is to a standard copied template or known online solution. (0.0 = highly original, 1.0 = exact copy of common online solution).\n4. A boolean indicating if it seems highly plagiarized or AI-generated (true if similarity score > 0.85).\nRespond strictly with JSON:\n{"feedback": "...", "complexity": "O(...)", "similarityScore": 0.8, "isPlagiarized": false}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    const result = parseAiJsonResponse<LogicAnalysisResult>(data.candidates[0].content.parts[0].text);

    await prisma.submission.update({
      where: { id: submissionId },
      data: { 
        aiFeedback: result.feedback || 'System evaluation unavailable.', 
        aiComplexity: result.complexity || 'O(?)', 
        aiSimilarityScore: result.similarityScore || 0, 
        isPlagiarized: result.isPlagiarized || false 
      }
    });
  } catch (error: any) { 
    // This is an async background job, so we silently absorb transient AI provider faults.
    console.warn(`[AI Engine] Background analysis failed for submission ${submissionId}`);
  }
}

export async function askAiChatbot(query: string, history: any[] = [], imageBase64?: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) return "API Configuration key is missing from environment variables.";

  if (!imageBase64) {
    const cached = getCachedResponse(query);
    if (cached) return cached;
  }

  try {
    // Claude is strongly preferred for code reasoning if the environment has it enabled
    if (USE_CLAUDE_API) {
      const client = new Anthropic({ apiKey });
      
      const messages = history.map(m => ({
        role: (m.role === 'ai' || m.role === 'model' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.text
      }));
      
      messages.push({
        role: 'user',
        content: imageBase64 
          ? [
              { type: 'text', text: query },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64.replace(/^data:image\/\w+;base64,/, '') } }
            ]
          : query
      });

      const response = await client.messages.create({
        model: 'claude-3-opus-20240229',
        max_tokens: 1024,
        messages
      });

      const reply = response.content[0].type === 'text' ? response.content[0].text : 'Inference failed to yield text response.';
      
      if (!imageBase64) setCachedResponse(query, reply);
      return reply;
    }

    // Fallback to Gemini 1.5 if Claude isn't active
    const historyContext = history.length > 0
      ? `\n--- Session Trace ---\n${history.map(m => `${m.role === 'model' || m.role === 'ai' ? 'AI Guide' : 'User'}: ${m.text}`).join('\n')}\n---------------------------\n`
      : '';

    let parts: any[] = [{ 
      text: `You are a technical engineering assistant for DivineCode. Provide clear, concise algorithmic support.\n${historyContext}\nCurrent User Query: ${query}` 
    }];

    if (imageBase64) {
      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      parts.push({
        inlineData: { mimeType: "image/jpeg", data: cleanBase64 }
      });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { 
      contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.7 } 
    });
    
    const reply = data.candidates[0].content.parts[0].text.trim();
    
    if (!imageBase64) setCachedResponse(query, reply);
    return reply;
  } catch (err: any) {
    const apiErrorDetails = err.response?.data?.error?.message || err.message || 'Inference engine unreachable.';
    
    if (apiErrorDetails.includes('429') || apiErrorDetails.includes('quota')) {
      return `Rate Limited: API Quota Exceeded. Please try again later.`;
    }
    
    return `AI Service Error: ${apiErrorDetails}`;
  }
}

export function buildMockInterviewPrompt(problemPrompt: string, userResponse: string, chatHistory: string = '', currentCode?: string): string {
  const codeContext = currentCode && currentCode.trim() !== '' && !currentCode.includes('// Implementation source framework entry')
    ? `\nCandidate's Current Editor Code:\n\`\`\`\n${currentCode}\n\`\`\`\n\nCross-reference their spoken response with the code they have written.`
    : '';

  return `You are a senior technical interviewer conducting a mock interview.
  The candidate is answering: "${problemPrompt}"
  
  Previous Conversation:
  ${chatHistory}

  Candidate's Latest Spoken Response: "${userResponse}"${codeContext}

  Evaluate the candidate's latest response on TWO fronts: Technical and Communication.
  IF the candidate says something completely off-topic or nonsensical (e.g., "I am a disco dancer"), politely steer them back and set technicalScore to 0.

  1. Technical: Provide constructive feedback on their algorithm, complexity, and code accuracy.
  2. Communication & Fluency: Evaluate their English speaking structure.
  3. If their answer is incomplete or off-topic, ask a guiding follow-up question.
  4. Assign a technical score (0-100) and an English fluency score (0-100).
  5. Set "isPassed" to true ONLY if they thoroughly answered the core concept optimally.

  CRITICAL: Respond ONLY with the raw JSON object. Do not wrap it in markdown code blocks or conversational text.
  
  Format: 
  {"feedback": "...", "followUpQuestion": "...", "technicalScore": 85, "fluencyScore": 90, "pronunciationTips": "...", "isPassed": false}`;
}

export async function conductAiInterview(problemPrompt: string, userResponse: string, chatHistory: any[] = [], currentCode?: string): Promise<InterviewEvaluation> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      feedback: 'The AI interview engine is currently offline, so I will provide a structured fallback review. Please explain your approach in a few steps and mention the expected time complexity.',
      followUpQuestion: 'What would change if the input size doubled?',
      technicalScore: 60,
      fluencyScore: 60,
      pronunciationTips: 'Keep your explanation concise and tie each idea to the problem constraints.',
      isPassed: false
    };
  }

 const historyString = chatHistory.map(msg => `${(msg.role || 'user').toUpperCase()}: ${msg.text}`).join('\n');
  
  // Truncate the code sent to the voice AI to 1000 characters to prevent overloading the context window
  const safeCode = currentCode ? currentCode.substring(0, 1000) : '';
  const prompt = buildMockInterviewPrompt(problemPrompt, userResponse, historyString, safeCode);

  try {
    if (USE_CLAUDE_API) {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: 'claude-3-opus-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
      const responseData = parseAiJsonResponse<InterviewEvaluation>(text);
      
      if (!responseData.feedback) throw new Error("Malformed JSON evaluation");
      return responseData;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { 
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
      // Removed the strict responseMimeType config so Gemini doesn't crash on off-topic text
    });
    
    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts?.[0]?.text) {
       throw new Error("Empty candidate returned by AI (possible safety block).");
    }

    const responseData = parseAiJsonResponse<InterviewEvaluation>(candidate.content.parts[0].text);
    
    if (!responseData.feedback) {
        responseData.feedback = "I didn't quite catch the technical details of your answer. Could you elaborate on your approach?";
        responseData.followUpQuestion = "What data structures would be best here?";
        responseData.technicalScore = 0;
        responseData.fluencyScore = 50;
        responseData.pronunciationTips = "Try to stay focused on the algorithmic concepts.";
        responseData.isPassed = false;
    }
    return responseData;

  } catch (error: any) {
    console.error("[Voice AI Error]:", error.response?.data || error.message);
    return {
        feedback: "I am having trouble connecting to my neural core. Let's keep going—could you summarize the time complexity boundaries of your approach one more time?",
        followUpQuestion: "What happens if the input size is doubled?",
        technicalScore: 50,
        fluencyScore: 50,
        pronunciationTips: "Network connection unstable. Speech structure not evaluated.",
        isPassed: false
    };
  }
}

export async function extractProblemFromTextOrImage(rawTextOrUrl: string) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API configuration missing.");
  
  const prompt = `You are a competitive programming parser. I will provide either raw scraped HTML, or OCR text from an image. Extract the problem details into a clean format. Find the hidden system tests if you can deduce them.\nData:\n${rawTextOrUrl}\nRespond strictly with JSON:\n{"title": "...", "descriptionHtml": "...", "testcases": [{"input": "...", "expectedOutput": "..."}], "requiresRedirect": false}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    return parseAiJsonResponse<ExtractionResult>(data.candidates[0].content.parts[0].text);
  } catch (error) {
    return { title: "Origin Mapping Fault", descriptionHtml: "Direct navigation required.", testcases: [], requiresRedirect: true };
  }
}

export async function extractProblemFromImageBase64(base64Data: string, mimeType: string = 'image/jpeg') {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API configuration missing.");
  
  const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
  const prompt = `You are an expert Optical Character Recognition (OCR) system and competitive programming parser. I have provided an image of a coding problem. 1. Extract all text accurately. 2. Format the problem description beautifully into HTML (use <h3>, <p>, <ul>, and <pre> tags for constraints and code). 3. Identify the sample inputs and outputs. 4. Generate 5 additional tricky hidden test cases based on the constraints.\nRespond strictly with JSON:\n{"title": "Extracted Problem Title", "descriptionHtml": "<div class='problem-statement'>...</div>", "testcases": [{"input": "...", "expectedOutput": "..."}]}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [ { text: prompt }, { inlineData: { mimeType, data: cleanBase64 } } ] }], generationConfig: { responseMimeType: "application/json" } });
    return parseAiJsonResponse<ExtractionResult>(data.candidates[0].content.parts[0].text);
  } catch (error: any) {
    throw new Error("OCR parsing failed on provided image buffer.");
  }
}

export async function generateTestCasesWithAI(problemDescription: string, masterSolution: string) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API configuration missing.");
  
  const prompt = `You are an expert competitive programming judge. Problem Description: ${sanitizeDescriptionForPrompt(problemDescription)}\nMaster Solution (Always Correct):\n${masterSolution}\nGenerate 20 tricky, edge-case system test cases for this problem. Include edge cases like 0, negative numbers, maximum constraints, or empty arrays where applicable. This is for the serial judge system. Respond strictly with a JSON array of objects. Do not include markdown formatting.\nFormat: [{"input": "...", "expectedOutput": "...", "explanation": "..."}]`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    return parseAiJsonResponse<TestCase[]>(data.candidates[0].content.parts[0].text, true);
  } catch (error: any) {
    return [];
  }
}

export async function findFailingTestCaseWithAI(problemDescription: string, userCode: string) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API configuration missing.");
  
  const prompt = `You are an expert competitive programming tutor. Problem Description: ${sanitizeDescriptionForPrompt(problemDescription)}\nUser's Failing Code:\n${userCode}\nThe user's code is getting a "Wrong Answer" or "Runtime Error". 1. Find the logical flaw. 2. Provide exactly ONE short test case input that makes their code fail. 3. Provide the expected correct output for that input. 4. Provide a 1-sentence hint (do NOT give them the code solution).\nRespond strictly with a JSON object.\nFormat: {"input": "...", "expectedOutput": "...", "hint": "..."}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    return parseAiJsonResponse<DebugResult>(data.candidates[0].content.parts[0].text);
  } catch (error: any) {
    throw new Error("Failed to parse AI inference debug response.");
  }
}

export async function generateSolutionExplanationWithAI(problemDescription: string) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API configuration missing.");
  
  const prompt = `You are an AI programming tutor. A student is stuck on this problem:\n${sanitizeDescriptionForPrompt(problemDescription)}\nBreak down the optimal approach step-by-step. Do not just output raw code. Explain the logic, data structures used, and time complexity. Respond strictly with a JSON object.\nFormat: {"summary": "...", "steps": ["step 1...", "step 2..."], "complexity": "..."}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    return parseAiJsonResponse<SolutionExplanation>(data.candidates[0].content.parts[0].text);
  } catch (error: any) {
    throw new Error("Failed to generate structural explanation.");
  }
}

export async function generateToughTestCases(problemDescriptionHtml: string) {
  const apiKey = getApiKey();
  if (!apiKey) return [];
  
  const prompt = `You are an expert competitive programming judge. Read the following problem description:\n${sanitizeDescriptionForPrompt(problemDescriptionHtml)}\nGenerate exactly 20 tricky, edge-case system test cases for this problem to feed the serial judge. Respond strictly with a JSON array of objects. Format: [{"input": "...", "expectedOutput": "..."}]`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    return parseAiJsonResponse<TestCase[]>(data.candidates[0].content.parts[0].text, true);
  } catch (error: any) {
    return []; 
  }
}

export async function debugCodeWithAI(userCode: string, problemDescription: string) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API configuration missing.");
  
  const prompt = `You are a competitive programming debugger. Problem Description: ${sanitizeDescriptionForPrompt(problemDescription)}\nUser Code: ${userCode}\nFind the logical error. Provide: 1. A short hint about the bug. 2. A minimal input that breaks the code. 3. The expected correct output for that input.\nReturn ONLY JSON: {"hint": "...", "input": "...", "expectedOutput": "..."}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    return parseAiJsonResponse<DebugResult>(data.candidates[0].content.parts[0].text);
  } catch (error: any) {
    return { hint: "Syntax constraint mapping failure.", input: "", expectedOutput: "" };
  }
}

export async function analyzeUserWeaknesses(submissions: { problemTitle: string, code: string, verdict: string }[]): Promise<WeaknessAnalysis | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const submissionsText = submissions.map((s, i) => `Problem ${i+1}: ${s.problemTitle}\nVerdict: ${s.verdict}\nCode:\n${s.code}`).join('\n\n---\n\n');

  const prompt = `You are a competitive programming coach. Analyze the following recent FAILED submissions by a student:
  
  ${submissionsText}

  Task: Identify their core algorithmic and structural weaknesses based on the code provided. 
  1. Determine exactly 3 core competitive programming topics they are failing at (e.g., "Dynamic Programming", "Graph Theory", "Greedy Math", "Data Structures", "String Algorithms").
  2. For the "radarUpdates", deduct points from their mastery score based on severity (e.g., -5 to -15).

  Respond strictly with JSON:
  {
    "weaknesses": [
      {"topic": "Dynamic Programming", "reason": "Failed to identify overlapping subproblems in Problem 1..."},
      {"topic": "Graph Theory", "reason": "DFS traversal lacked cycle detection..."}
    ],
    "radarUpdates": [
      {"subject": "Dynamic Programming", "scoreDelta": -10},
      {"subject": "Graph Theory", "scoreDelta": -5}
    ]
  }`;

  try {
    if (USE_CLAUDE_API) {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: 'claude-3-opus-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      });
      const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
      return parseAiJsonResponse<WeaknessAnalysis>(text);
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    return parseAiJsonResponse<WeaknessAnalysis>(data.candidates[0].content.parts[0].text);
  } catch (error: any) {
    // Graceful silent failure to prevent blocking UI telemetry during report generation
    return null;
  }
}