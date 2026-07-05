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

// gemini-1.5-flash was retired (404s now); the -latest alias tracks whatever
// stable flash Google currently serves, so this never rots again.
const getAiModel = () => process.env.AI_MODEL || 'gemini-flash-latest';
const getApiKey = () => process.env.GEMINI_API_KEY || process.env.AI_API_KEY;
// Anthropic gets its OWN key — passing the Gemini key to the Claude client was
// silently breaking every USE_CLAUDE_API branch with auth errors.
const getClaudeKey = () => (process.env.ANTHROPIC_API_KEY || '').trim();
// claude-3-opus was retired Jan 2026 (404s now); opus-4-8 is the drop-in.
const CLAUDE_CHAT_MODEL = 'claude-opus-4-8';

// The support chat should resolve platform questions, not just algorithms.
// Keep this in sync when features change.
export const PLATFORM_GUIDE = `You are Divine AI Guide, the built-in assistant of DivineCode — a competitive programming and interview-prep platform. Besides algorithm help, resolve platform questions with these facts:
- Practice: curated DSA problems with an in-browser judge (C++, Python, Java, JS), AI hints and complexity analysis, plus a voice coach that listens to spoken answers and scores technical accuracy and English fluency.
- AI Recruiter (/recruiter): a 3-round mock interview — DSA with live code execution, then a resume-based deep dive, then behavioral. Every user gets 3 free interviews (register your mobile number once to claim them); after that a session costs 100 coins. Uploading a resume PDF personalizes Round 2. When the loop ends, a hiring-committee report with scores, strengths, weaknesses and a prep plan is available and can be downloaded as a PDF.
- Real Recruiter marketplace (/recruiter/book): book a paid 1:1 LIVE VIDEO mock interview with a verified human recruiter. Two ways to pay: online (card / UPI / netbanking / wallet — instant confirmation), or manual UPI to the platform handle + submit the UTR which the admin verifies. Total = recruiter fee + platform fee (15%, minimum Rs.49). Once confirmed, a private live video room unlocks ("Join Live Interview" on the bookings page; the link is also emailed to both sides). A booking stuck on "Payment Under Verification" just means the admin has not verified the UTR yet. Users can also apply to become a recruiter on the same page; listings go live after admin approval.
- Contests: timed rated contests with live leaderboards; registering sends a confirmation email. Duel: real-time 1v1 code battles.
- Community: video tutorials and walkthroughs posted by users, plus DivineLive — go live camera-on from the Community Hub to discuss contest problems, and anyone online can join the room on video. Every online user is notified when someone goes live.
- Emails: booking updates, recruiter application decisions, interview debrief reports, and contest registrations are delivered to the account's registered email.
- Coins: earned by solving problems and platform activity; spent on premium features like AI Recruiter sessions.
Keep answers short, friendly, and actionable. For payment or account problems you cannot resolve, direct the user to the admin.`;

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


export interface RecruiterTurnEvaluation {
  speech: string;
  technicalScore: number;
  fluencyScore: number;
  concludeRound: boolean;
  roundPassed: boolean | null;
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
  if (!apiKey && !getClaudeKey()) return "API Configuration key is missing from environment variables.";

  if (!imageBase64) {
    const cached = getCachedResponse(query);
    if (cached) return cached;
  }

  try {
    // Claude is strongly preferred for code reasoning if the environment has it enabled
    if (USE_CLAUDE_API && getClaudeKey()) {
      try {
        const client = new Anthropic({ apiKey: getClaudeKey() });

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
          model: CLAUDE_CHAT_MODEL,
          max_tokens: 1024,
          system: PLATFORM_GUIDE,
          messages
        });

        const reply = response.content[0].type === 'text' ? response.content[0].text : 'Inference failed to yield text response.';

        if (!imageBase64) setCachedResponse(query, reply);
        return reply;
      } catch (claudeErr: any) {
        // fall through to Gemini rather than surfacing a dead Claude account
        console.warn('[AI Chat] Claude failed, using Gemini:', claudeErr?.message);
        if (!apiKey) throw claudeErr;
      }
    }

    // Fallback to Gemini 1.5 if Claude isn't active
    const historyContext = history.length > 0
      ? `\n--- Session Trace ---\n${history.map(m => `${m.role === 'model' || m.role === 'ai' ? 'AI Guide' : 'User'}: ${m.text}`).join('\n')}\n---------------------------\n`
      : '';

    let parts: any[] = [{
      text: `${PLATFORM_GUIDE}\n${historyContext}\nCurrent User Query: ${query}`
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
  if (!apiKey && !getClaudeKey()) {
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
    if (USE_CLAUDE_API && getClaudeKey()) {
      try {
        const client = new Anthropic({ apiKey: getClaudeKey() });
        const response = await client.messages.create({
          model: CLAUDE_CHAT_MODEL,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }]
        });

        const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
        const responseData = parseAiJsonResponse<InterviewEvaluation>(text);

        if (!responseData.feedback) throw new Error("Malformed JSON evaluation");
        return responseData;
      } catch (claudeErr: any) {
        // A dead Claude account (no credits, revoked key) must not kill the
        // voice coach — fall through and let Gemini take the turn.
        console.warn('[Voice AI] Claude failed, using Gemini:', claudeErr?.message);
        if (!apiKey) throw claudeErr;
      }
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
    if (USE_CLAUDE_API && getClaudeKey()) {
      try {
        const client = new Anthropic({ apiKey: getClaudeKey() });
        const response = await client.messages.create({
          model: CLAUDE_CHAT_MODEL,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }]
        });
        const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
        return parseAiJsonResponse<WeaknessAnalysis>(text);
      } catch (claudeErr: any) {
        console.warn('[Weakness AI] Claude failed, using Gemini:', claudeErr?.message);
        if (!apiKey) throw claudeErr;
      }
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    return parseAiJsonResponse<WeaknessAnalysis>(data.candidates[0].content.parts[0].text);
  } catch (error: any) {
    // Graceful silent failure to prevent blocking UI telemetry during report generation
    return null;
  }
}

// -----------------------------------------------------------------------------
// AI Recruiter Engine — real multi-provider inference (Claude → Gemini chain).
// No canned replies: if every provider genuinely fails, we throw a typed error
// so the route can return a retryable 503 instead of faking an interviewer.
// -----------------------------------------------------------------------------

export class RecruiterAiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecruiterAiUnavailableError';
  }
}

export interface RoundOpening {
  problemStatement: string;
  speech: string;
}

const RECRUITER_TIMEOUT_MS = 45000;

// Candidate model chains. The configured model is tried first, then known-good
// fallbacks, so a typo'd AI_MODEL env var can never take the interview down.
const CLAUDE_MODEL_CHAIN = Array.from(new Set([
  (process.env.CLAUDE_MODEL || '').trim(),
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001'
].filter(Boolean)));

const GEMINI_MODEL_CHAIN = Array.from(new Set([
  (process.env.AI_MODEL || '').trim(),
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-3-flash-preview',   // separate free-tier quota bucket from the stable models
  'gemini-2.5-flash-lite'     // last resort: lite tier has its own (larger) daily quota
].filter(Boolean)));

function clampScore(value: any, fallback = 50): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Strict JSON extraction — throws (instead of returning {}) so the provider chain can advance. */
function strictJsonExtract(text: string): any {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Model output contained no JSON object.');
  return JSON.parse(match[0]);
}

async function callClaudeRaw(prompt: string): Promise<string> {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured.');

  const client = new Anthropic({ apiKey: key, timeout: RECRUITER_TIMEOUT_MS, maxRetries: 1 });
  let lastErr: any;

  for (const model of CLAUDE_MODEL_CHAIN) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 1500,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }]
      });
      const block = response.content[0];
      const text = block && block.type === 'text' ? block.text : '';
      if (!text.trim()) throw new Error('Claude returned an empty completion.');
      return text;
    } catch (err: any) {
      lastErr = err;
      const status = err?.status;
      // Auth / billing / quota problems affect every model in the chain
      // (e.g. "credit balance is too low" is a 400) — bail to the next provider.
      if (status === 400 || status === 401 || status === 403) throw err;
    }
  }
  throw lastErr;
}

async function callGeminiRaw(prompt: string): Promise<string> {
  const key = (process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '').trim();
  if (!key) throw new Error('GEMINI_API_KEY / AI_API_KEY not configured.');

  let lastErr: any;

  for (const model of GEMINI_MODEL_CHAIN) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        // maxOutputTokens must leave headroom for the model's internal "thinking"
        // tokens (Gemini 2.5+/3.5 count them against this cap). At 2048 the model
        // can exhaust the entire budget thinking and return an empty candidate.
        const { data } = await axios.post(url, {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.7, maxOutputTokens: 8192 }
        }, { timeout: RECRUITER_TIMEOUT_MS });

        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text || !String(text).trim()) throw new Error('Gemini returned an empty candidate (possible safety block).');
        return String(text);
      } catch (err: any) {
        lastErr = err;
        const status = err?.response?.status;
        if (status === 404) break;                          // unknown model → try the next model
        if (status && status < 500 && status !== 429) break; // hard client error → next model
        // transient (429 / 5xx / timeout) → one retry on the same model
      }
    }
  }
  throw lastErr;
}

/**
 * Runs the provider chain and validates the structured payload.
 * A malformed payload counts as a provider failure so the next engine gets a shot.
 */
async function recruiterInference<T>(prompt: string, validate: (raw: any) => T): Promise<T> {
  const providers: { name: string; call: (p: string) => Promise<string> }[] = [];
  if (USE_CLAUDE_API && (process.env.ANTHROPIC_API_KEY || '').trim()) {
    providers.push({ name: 'claude', call: callClaudeRaw });
  }
  if ((process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '').trim()) {
    providers.push({ name: 'gemini', call: callGeminiRaw });
  }

  if (providers.length === 0) {
    throw new RecruiterAiUnavailableError('No AI provider configured. Set ANTHROPIC_API_KEY or GEMINI_API_KEY/AI_API_KEY.');
  }

  const failures: string[] = [];
  for (const provider of providers) {
    try {
      const raw = await provider.call(prompt);
      return validate(strictJsonExtract(raw));
    } catch (err: any) {
      const detail = err?.response?.data?.error?.message || err?.message || 'unknown failure';
      failures.push(`${provider.name}: ${detail}`);
      console.error(`[Recruiter AI] Provider "${provider.name}" failed → ${detail}`);
    }
  }
  throw new RecruiterAiUnavailableError(`All AI providers failed. ${failures.join(' | ')}`);
}

function describeRoundFocus(roundType: string): string {
  switch (roundType) {
    case 'OA_DSA':
      return 'Data Structures & Algorithms. Scrutinize their code line by line, push on time/space complexity, edge cases, and trade-offs between approaches.';
    case 'RESUME_BASED':
      return 'Resume, projects, and system design. Stress-test their claimed tech stack: architecture decisions, scaling bottlenecks, failure modes, and why they chose each technology over alternatives.';
    case 'BEHAVIORAL':
      return 'Behavioral and situational judgement. Probe with STAR-method follow-ups: conflict resolution, ownership, deadlines, failures, and what they actually did (not what the team did).';
    default:
      return 'General technical screening.';
  }
}

function formatTechStack(techStack: any): string {
  if (Array.isArray(techStack)) return techStack.join(', ');
  if (typeof techStack === 'string') return techStack;
  return techStack ? JSON.stringify(techStack) : 'Not specified';
}

/**
 * Renders the parsed resume into a compact plain-text block for prompts.
 * Kept under ~1800 chars so it never crowds out the conversation history.
 */
function formatResumeContext(resumeParsed: any): string {
  if (!resumeParsed || typeof resumeParsed !== 'object') return '';
  const r = resumeParsed as any;
  const lines: string[] = [];
  if (r.summary) lines.push(`Summary: ${r.summary}`);
  if (Array.isArray(r.skills) && r.skills.length) lines.push(`Skills: ${r.skills.join(', ')}`);
  if (Array.isArray(r.projects) && r.projects.length) {
    lines.push('Projects:');
    for (const p of r.projects.slice(0, 5)) {
      lines.push(`  - ${p.name || 'Untitled'}${p.tech ? ` [${Array.isArray(p.tech) ? p.tech.join(', ') : p.tech}]` : ''}: ${p.description || ''}`);
    }
  }
  if (Array.isArray(r.experience) && r.experience.length) {
    lines.push('Experience:');
    for (const e of r.experience.slice(0, 4)) {
      lines.push(`  - ${e.role || ''} at ${e.company || ''} (${e.duration || 'n/a'}): ${Array.isArray(e.highlights) ? e.highlights.join('; ') : (e.highlights || '')}`);
    }
  }
  if (Array.isArray(r.education) && r.education.length) lines.push(`Education: ${r.education.map((e: any) => typeof e === 'string' ? e : `${e.degree || ''} ${e.institution || ''} ${e.year || ''}`.trim()).join(' | ')}`);
  if (Array.isArray(r.achievements) && r.achievements.length) lines.push(`Achievements: ${r.achievements.slice(0, 6).join('; ')}`);
  if (lines.length === 0 && r.rawText) lines.push(String(r.rawText).substring(0, 1500));
  return lines.join('\n').substring(0, 1800);
}

export interface ParsedResume {
  summary: string;
  skills: string[];
  projects: { name: string; description: string; tech: string[] }[];
  experience: { company: string; role: string; duration: string; highlights: string[] }[];
  education: string[];
  achievements: string[];
}

/**
 * Structures raw resume text (extracted via pdf-parse) into the JSON shape the
 * interviewer prompts consume. Throws RecruiterAiUnavailableError when every
 * provider fails, so callers can fall back to storing raw text.
 */
export async function parseResumeToProfile(rawText: string): Promise<ParsedResume> {
  const clipped = rawText.replace(/\s+/g, ' ').trim().substring(0, 12000);

  const prompt = `You are a technical recruiter's parsing engine. Extract a structured profile from this raw resume text.

RESUME TEXT:
"""
${clipped}
"""

Rules:
- Extract ONLY what is actually present; never invent employers, dates, or projects.
- "summary" is a 1-2 sentence third-person snapshot of the candidate.
- "skills" is a flat deduplicated list of technologies/languages/tools.
- Cap projects at 6, experience at 5, achievements at 8.

Respond ONLY with raw JSON:
{"summary": "...", "skills": ["..."], "projects": [{"name": "...", "description": "...", "tech": ["..."]}], "experience": [{"company": "...", "role": "...", "duration": "...", "highlights": ["..."]}], "education": ["..."], "achievements": ["..."]}`;

  return recruiterInference<ParsedResume>(prompt, (raw) => {
    if (typeof raw?.summary !== 'string' && !Array.isArray(raw?.skills)) {
      throw new Error('Resume payload missing both summary and skills.');
    }
    return {
      summary: typeof raw.summary === 'string' ? raw.summary.trim() : '',
      skills: Array.isArray(raw.skills) ? raw.skills.map(String).slice(0, 40) : [],
      projects: Array.isArray(raw.projects) ? raw.projects.slice(0, 6) : [],
      experience: Array.isArray(raw.experience) ? raw.experience.slice(0, 5) : [],
      education: Array.isArray(raw.education) ? raw.education.map((e: any) => typeof e === 'string' ? e : JSON.stringify(e)).slice(0, 4) : [],
      achievements: Array.isArray(raw.achievements) ? raw.achievements.map(String).slice(0, 8) : []
    };
  });
}

/**
 * Generates the round's opening: a dynamic, profile-tailored problem statement
 * plus the interviewer's spoken introduction. Nothing is hardcoded.
 */
export async function generateRoundOpening(
  profile: { field: string; goal: string; techStack: any; resumeParsed?: any },
  roundType: string,
  roundOrder: number
): Promise<RoundOpening> {
  const stack = formatTechStack(profile.techStack);
  const resumeContext = formatResumeContext(profile.resumeParsed);

  let brief: string;
  if (roundType === 'OA_DSA') {
    brief = `Author ONE original medium-difficulty Data Structures & Algorithms coding problem calibrated to a "${profile.goal}" candidate. The "problemStatement" must be plain text (no markdown syntax) and include: the problem description, 2 worked examples with Input/Output, explicit constraints, and the target time complexity. It must be solvable in ~25 minutes.`;
  } else if (roundType === 'RESUME_BASED') {
    brief = `Author the round briefing for a resume/system-design deep dive. The candidate's stack is: ${stack}. ${resumeContext ? 'You have their ACTUAL parsed resume below — anchor the briefing to their real projects and experience by name.' : ''} The "problemStatement" must be plain text describing the discussion scope: which parts of their stack you will drill into, and a concrete opening system-design scenario built around technologies they claim (e.g. scaling, caching, schema design, failure handling).`;
  } else {
    brief = `Author the round briefing for a behavioral interview targeting "${profile.goal}". The "problemStatement" must be plain text listing the themes you will cover (ownership, conflict, failure, deadlines) and open with one concrete situational scenario question.${resumeContext ? ' Where possible, ground scenarios in the real experience on their resume below.' : ''}`;
  }

  const prompt = `You are a senior engineering interviewer at a top-tier tech company preparing round ${roundOrder} of a live interview.

CANDIDATE PROFILE:
- Field: ${profile.field}
- Target role: ${profile.goal}
- Tech stack: ${stack}
${resumeContext ? `\nPARSED RESUME:\n${resumeContext}\n` : ''}

TASK: ${brief}

Also write "speech": your spoken opening as the interviewer (max 70 words). It is read aloud by text-to-speech, so it must be natural conversational English — no markdown, no lists, no code. Greet the candidate briefly, then present the question/scenario so they can start immediately.

Respond ONLY with raw JSON:
{"problemStatement": "...", "speech": "..."}`;

  return recruiterInference<RoundOpening>(prompt, (raw) => {
    // Minimum lengths guard against degenerate outputs: a token-starved model can
    // emit literal placeholder JSON like {"problemStatement": "...", "speech": "..."}.
    if (typeof raw?.problemStatement !== 'string' || raw.problemStatement.trim().length < 40) throw new Error('Opening payload missing or truncated problemStatement.');
    if (typeof raw?.speech !== 'string' || raw.speech.trim().length < 20) throw new Error('Opening payload missing or truncated speech.');
    return { problemStatement: raw.problemStatement.trim(), speech: raw.speech.trim() };
  });
}

export async function processRecruiterTurn(
  profile: { field: string; goal: string; techStack: any; resumeParsed?: any },
  round: { type: string; order: number; cutoffScore: number; problemStatement?: string | null },
  history: { role: string; text: string }[],
  candidateSpeech: string,
  candidateCode?: string,
  executionResult?: string
): Promise<RecruiterTurnEvaluation> {

  const historyTrace = history.length > 0
    ? history.map(h => `${h.role === 'INTERVIEWER' ? 'Interviewer' : 'Candidate'}: ${h.text}`).join('\n')
    : '(No prior exchanges this round.)';

  const candidateAnswers = history.filter(h => h.role === 'CANDIDATE').length + 1;
  const safeCode = candidateCode ? candidateCode.substring(0, 4000) : '';
  const hasCode = safeCode.trim().length > 10 && !safeCode.includes('// Initialize solution architecture here');
  const resumeContext = round.type === 'RESUME_BASED' || round.type === 'BEHAVIORAL' ? formatResumeContext(profile.resumeParsed) : '';
  const safeExecution = executionResult ? String(executionResult).substring(0, 1200) : '';

  const prompt = `You are a Senior Engineering Manager at a top-tier tech company conducting round ${round.order} of a LIVE technical interview. You are a real human interviewer: warm but rigorous, probing, and you never break character or mention being an AI.

ROUND FOCUS: ${describeRoundFocus(round.type)}

CANDIDATE PROFILE:
- Field: ${profile.field}
- Target role: ${profile.goal}
- Tech stack: ${formatTechStack(profile.techStack)}
${resumeContext ? `\nPARSED RESUME (drill into these real projects/experiences — verify their claims match it):\n${resumeContext}\n` : ''}
ACTIVE PROBLEM GIVEN TO THE CANDIDATE:
${round.problemStatement || '(General discussion for this round.)'}

CONVERSATION SO FAR THIS ROUND:
${historyTrace}

CANDIDATE'S LATEST SPOKEN ANSWER (answer #${candidateAnswers} this round):
"${candidateSpeech}"
${hasCode ? `\nCANDIDATE'S CURRENT EDITOR CODE:\n\`\`\`\n${safeCode}\n\`\`\`\nCross-reference their spoken claims against this exact code — call out mismatches, bugs, or complexity issues by referring to specific parts of it.` : ''}${safeExecution ? `\nRESULT OF THE CANDIDATE'S LAST CODE EXECUTION (real compiler output — factor correctness signals into your technicalScore):\n${safeExecution}` : ''}

RULES:
1. Score THIS answer: "technicalScore" 0-100 (correctness, depth, complexity awareness) and "fluencyScore" 0-100 (clarity and structure of communication).
2. If the answer is off-topic, evasive, or gibberish: politely steer them back to the problem and set technicalScore to 10 or below.
3. Your "speech" is read aloud by text-to-speech: natural conversational English, under 90 words, NO markdown, NO code blocks, NO bullet lists.
4. Unless concluding, react specifically to what they said/wrote, then ask exactly ONE focused follow-up question. Never ask generic filler questions.
5. This is answer #${candidateAnswers} of the round. If it is answer #6 or later you MUST conclude. Conclude earlier only if they have fully and optimally solved it, or are clearly unable to make progress.
6. When concluding: give a short natural wrap-up, set "concludeRound" to true, and set "roundPassed" to your honest verdict for the ENTIRE round (pass means their overall performance would clear ${round.cutoffScore}/100). Otherwise "concludeRound" is false and "roundPassed" is null.

Respond ONLY with raw JSON:
{"speech": "...", "technicalScore": 0, "fluencyScore": 0, "concludeRound": false, "roundPassed": null}`;

  return recruiterInference<RecruiterTurnEvaluation>(prompt, (raw) => {
    if (typeof raw?.speech !== 'string' || raw.speech.trim().length < 10) throw new Error('Turn payload missing or truncated speech.');
    const concludeRound = raw.concludeRound === true;
    return {
      speech: raw.speech.trim(),
      technicalScore: clampScore(raw.technicalScore),
      fluencyScore: clampScore(raw.fluencyScore),
      concludeRound,
      roundPassed: concludeRound ? raw.roundPassed === true : null
    };
  });
}

export interface SessionReport {
  verdictSummary: string;
  hireRecommendation: 'STRONG_HIRE' | 'HIRE' | 'LEAN_HIRE' | 'NO_HIRE';
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  roundAnalysis: { round: number; headline: string; analysis: string }[];
  actionPlan: string[];
}

/**
 * Post-mortem debrief for a concluded interview session. Deterministic score
 * math happens in the route; this produces only the narrative judgement.
 */
export async function generateSessionReport(
  profile: { field: string; goal: string; techStack: any; resumeParsed?: any },
  sessionStatus: string,
  rounds: {
    order: number;
    type: string;
    passed: boolean | null;
    finalScore: number | null;
    cutoffScore: number;
    problemStatement?: string | null;
    turns: { role: string; text: string; technicalScore?: number | null; fluencyScore?: number | null }[];
  }[]
): Promise<SessionReport> {

  const roundDigests = rounds.map(r => {
    const exchanges = r.turns
      .map(t => `${t.role === 'INTERVIEWER' ? 'Interviewer' : 'Candidate'}${t.technicalScore != null ? ` [tech:${t.technicalScore}, fluency:${t.fluencyScore}]` : ''}: ${t.text.substring(0, 400)}`)
      .join('\n');
    return `ROUND ${r.order} (${r.type}) — verdict: ${r.passed === true ? 'PASSED' : r.passed === false ? 'FAILED' : 'NOT REACHED'}, finalScore: ${r.finalScore ?? 'n/a'}/${r.cutoffScore} cutoff
Problem: ${(r.problemStatement || 'n/a').substring(0, 300)}
Transcript:
${exchanges || '(round never started)'}`;
  }).join('\n\n');

  const prompt = `You are the hiring-committee chair at a top-tier tech company writing the post-interview debrief for a completed 3-round loop (DSA coding, resume/system-design deep dive, behavioral). Final loop outcome: ${sessionStatus}.

CANDIDATE:
- Field: ${profile.field}
- Target role: ${profile.goal}
- Tech stack: ${formatTechStack(profile.techStack)}

FULL INTERVIEW RECORD:
${roundDigests.substring(0, 14000)}

Write the debrief the candidate will read. Rules:
- Be specific: quote or paraphrase actual moments from the transcript, never generic advice.
- "verdictSummary": 2-3 sentence overall judgement in second person ("You ...").
- "hireRecommendation": one of STRONG_HIRE, HIRE, LEAN_HIRE, NO_HIRE — consistent with the round verdicts.
- "overallScore": 0-100 holistic calibration against a real ${profile.goal} bar.
- "strengths"/"weaknesses": 3-5 concrete bullet strings each, referencing real answers.
- "roundAnalysis": one entry per round that was reached — "headline" is a 5-8 word verdict, "analysis" is 2-4 sentences on what actually happened.
- "actionPlan": 4-6 prioritized, actionable prep steps tailored to what failed or wobbled.

Respond ONLY with raw JSON:
{"verdictSummary": "...", "hireRecommendation": "HIRE", "overallScore": 0, "strengths": ["..."], "weaknesses": ["..."], "roundAnalysis": [{"round": 1, "headline": "...", "analysis": "..."}], "actionPlan": ["..."]}`;

  return recruiterInference<SessionReport>(prompt, (raw) => {
    if (typeof raw?.verdictSummary !== 'string' || raw.verdictSummary.trim().length < 20) throw new Error('Report payload missing verdictSummary.');
    const rec = ['STRONG_HIRE', 'HIRE', 'LEAN_HIRE', 'NO_HIRE'].includes(raw.hireRecommendation) ? raw.hireRecommendation : 'NO_HIRE';
    return {
      verdictSummary: raw.verdictSummary.trim(),
      hireRecommendation: rec,
      overallScore: clampScore(raw.overallScore),
      strengths: Array.isArray(raw.strengths) ? raw.strengths.map(String).slice(0, 6) : [],
      weaknesses: Array.isArray(raw.weaknesses) ? raw.weaknesses.map(String).slice(0, 6) : [],
      roundAnalysis: Array.isArray(raw.roundAnalysis)
        ? raw.roundAnalysis.slice(0, 3).map((r: any) => ({
            round: Number(r?.round) || 0,
            headline: String(r?.headline || '').substring(0, 120),
            analysis: String(r?.analysis || '').substring(0, 1000)
          }))
        : [],
      actionPlan: Array.isArray(raw.actionPlan) ? raw.actionPlan.map(String).slice(0, 6) : []
    };
  });
}