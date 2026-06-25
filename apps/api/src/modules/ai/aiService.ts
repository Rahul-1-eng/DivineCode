import axios from 'axios';
import { prisma } from '../../prisma/client';
import Anthropic from '@anthropic-ai/sdk';

// ✅ Support for both Gemini and Claude APIs
const USE_CLAUDE_API = process.env.USE_CLAUDE_API === 'true'; // Set to 'true' to use Claude instead of Gemini

function parseAiJsonResponse(text: string, isArray = false) {
  try {
    let cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const match = isArray ? cleanText.match(/\[[\s\S]*\]/) : cleanText.match(/\{[\s\S]*\}/);
    if (match) {
        return JSON.parse(match[0]);
    }
    cleanText = cleanText.replace(/```json/gi, '').replace(/```/g, '').trim();
    return JSON.parse(cleanText);
  } catch (err) {
    console.error("AI JSON Parse Error. Raw Text:", text);
    return isArray ? [] : {};
  }
}

function sanitizeDescriptionForPrompt(html: string) {
  if (!html) return '';
  return html.replace(/<img[^>]*src="data:image[^>]*>/g, '[Image omitted for token limits]');
}

const getAiModel = () => process.env.AI_MODEL || 'gemini-1.5-flash';

// ✅ Simple in-memory cache to reduce API calls
const qaCache = new Map<string, { response: string; timestamp: number }>();
const CACHE_TTL = 3600000; // 1 hour

function getCacheKey(question: string): string {
  return question.toLowerCase().trim();
}

function getCachedResponse(question: string): string | null {
  const key = getCacheKey(question);
  const cached = qaCache.get(key);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('✅ Cache hit for question:', key.substring(0, 50));
    return cached.response;
  }
  
  qaCache.delete(key); // Expired
  return null;
}

function setCachedResponse(question: string, response: string): void {
  const key = getCacheKey(question);
  qaCache.set(key, { response, timestamp: Date.now() });
}

export async function analyzeSubmissionLogic(submissionId: string, problemDescription: string, userCode: string) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return;

  const prompt = `You are an expert code reviewer. Problem Description: ${sanitizeDescriptionForPrompt(problemDescription)}\nSubmitted Code:\n${userCode}\nAnalyze this code. Provide exactly four things:\n1. A short paragraph of feedback on the logic (is it optimal?).\n2. The Big-O Time Complexity (e.g., O(N log N)).\n3. A similarity score from 0.0 to 1.0 indicating how similar this is to a standard copied template or known online solution. (0.0 = highly original, 1.0 = exact copy of common online solution).\n4. A boolean indicating if it seems highly plagiarized or AI-generated (true if similarity score > 0.85).\nRespond strictly with JSON:\n{"feedback": "...", "complexity": "O(...)", "similarityScore": 0.8, "isPlagiarized": false}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    const result = parseAiJsonResponse(data.candidates[0].content.parts[0].text);

    await prisma.submission.update({
      where: { id: submissionId },
      data: { aiFeedback: result.feedback || 'No feedback generated.', aiComplexity: result.complexity || 'O(?)', aiSimilarityScore: result.similarityScore || 0, isPlagiarized: result.isPlagiarized || false }
    });
  } catch (error: any) { 
    console.error("AI Logic Analysis Error:", error.response?.data || error.message); 
  }
}

// ✅ IMPROVED: AI Chatbot with caching and Claude support
export async function askAiChatbot(query: string, history: any[] = [], imageBase64?: string): Promise<string> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return "AI Configuration key is missing from server architecture variables environment maps.";

  // Check cache first (only for text queries without images)
  if (!imageBase64) {
    const cached = getCachedResponse(query);
    if (cached) return cached;
  }

  try {
    // ✅ CLAUDE API PATH
    if (USE_CLAUDE_API) {
      console.log('🚀 Using Claude API for chatbot');
      const client = new Anthropic({ apiKey });
      
      // Format history for Claude
      const messages = history.map(m => ({
        role: m.role === 'ai' ? 'assistant' : 'user',
        content: m.text
      }));
      
      // Add current query
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
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        messages
      });

      const reply = response.content[0].type === 'text' ? response.content[0].text : 'No response';
      
      // Cache the response
      if (!imageBase64) {
        setCachedResponse(query, reply);
      }
      
      return reply;
    }

    // ✅ GEMINI API PATH (Original)
    console.log('🚀 Using Gemini API for chatbot');
    const historyContext = history.length > 0
      ? `\n--- Previous Conversation ---\n${history.map(m => `${m.role === 'model' || m.role === 'ai' ? 'AI Guide' : 'User'}: ${m.text}`).join('\n')}\n---------------------------\n`
      : '';

    let parts: any[] = [{ 
      text: `You are a helpful engineering assistant for DivineCode. Provide clear, concise help.\n${historyContext}\nCurrent User Query: ${query}` 
    }];

    if (imageBase64) {
      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      parts.push({
        inlineData: { mimeType: "image/jpeg", data: cleanBase64 }
      });
    }

    const contents = [{ role: 'user', parts }];

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { 
      contents,
      generationConfig: { maxOutputTokens: 1024, temperature: 0.7 } 
    });
    
    const reply = data.candidates[0].content.parts[0].text.trim();
    
    // Cache the response
    if (!imageBase64) {
      setCachedResponse(query, reply);
    }
    
    return reply;
  } catch (err: any) {
    console.error("❌ AI Chatbot Error:", err.response?.data || err.message);
    
    const apiErrorDetails = err.response?.data?.error?.message || 'The model may be rate-limited or unavailable.';
    const errorMsg = `AI Service Error: ${apiErrorDetails}`;
    
    // Check if it's a rate limit error
    if (apiErrorDetails.includes('429') || apiErrorDetails.includes('quota')) {
      return `🔴 Rate Limited: ${apiErrorDetails}. Fix: Upgrade API plan or switch to Claude API.`;
    }
    
    return errorMsg;
  }
}

// ✅ IMPROVED: AI Interview with Claude support
export async function conductAiInterview(problemPrompt: string, userResponse: string, chatHistory: any[] = [], currentCode?: string) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY is missing from the environment.");

  const historyString = chatHistory.map(msg => `${(msg.role || 'user').toUpperCase()}: ${msg.text}`).join('\n');

  const codeContext = currentCode && currentCode.trim() !== '' && !currentCode.includes('// Implementation source framework entry')
    ? `\nCandidate's Current Editor Code:\n\`\`\`\n${currentCode}\n\`\`\`\n\nCross-reference their spoken response with the code they have written. Does their spoken logic align with their actual code implementation?`
    : '';

  const prompt = `You are a senior FAANG technical interviewer conducting a mock interview.
  The candidate is answering: "${problemPrompt}"
  
  Previous Conversation:
  ${historyString}

  Candidate's Latest Spoken Response: "${userResponse}"${codeContext}

  Evaluate the candidate's latest response on TWO fronts: Technical and Communication.
  1. Technical: Provide constructive feedback on their algorithm, complexity, and code accuracy.
  2. Communication & Fluency: Evaluate their English speaking structure. Are there grammatical errors in their transcribed text? How fluent and professional does their explanation sound?
  3. If their answer is incomplete, ask a guiding follow-up question.
  4. Assign a technical score (0-100) and an English fluency score (0-100).
  5. Set "isPassed" to true ONLY if they thoroughly answered the core concept optimally.

  Respond strictly with JSON. Format: 
  {"feedback": "...", "followUpQuestion": "...", "technicalScore": 85, "fluencyScore": 90, "pronunciationTips": "...", "isPassed": false}`;

  try {
    // ✅ CLAUDE API PATH
    if (USE_CLAUDE_API) {
      console.log('🚀 Using Claude API for interview');
      const client = new Anthropic({ apiKey });
      
      const response = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
      const responseData = parseAiJsonResponse(text);
      
      if (!responseData.feedback) {
        return {
            feedback: "I am having trouble processing the details of that response. Could you elaborate on your approach?",
            followUpQuestion: "What is the time complexity of your proposed solution?",
            technicalScore: 50,
            fluencyScore: 50,
            pronunciationTips: "Speak clearly and confidently.",
            isPassed: false
        };
      }
      
      return responseData;
    }

    // ✅ GEMINI API PATH (Original)
    console.log('🚀 Using Gemini API for interview');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { 
      contents: [{ role: 'user', parts: [{ text: prompt }] }], 
      generationConfig: { responseMimeType: "application/json" } 
    });
    
    const responseData = parseAiJsonResponse(data.candidates[0].content.parts[0].text);
    
    if (!responseData.feedback) {
        return {
            feedback: "I am having trouble processing the details of that response. Could you elaborate on your approach?",
            followUpQuestion: "What is the time complexity of your proposed solution?",
            technicalScore: 50,
            fluencyScore: 50,
            pronunciationTips: "Speak clearly and confidently.",
            isPassed: false
        };
    }
    
    return responseData;
  } catch (error: any) {
    console.error("❌ AI Interview Error:", error.response?.data || error.message);
    
    return {
        feedback: "The connection to the AI Interviewer timed out due to heavy load. Let's continue.",
        followUpQuestion: "Can you summarize your approach one more time?",
        technicalScore: 0,
        fluencyScore: 0,
        pronunciationTips: "Connection error - check server logs.",
        isPassed: false
    };
  }
}

// ✅ Other existing functions (unchanged)
export async function extractProblemFromTextOrImage(rawTextOrUrl: string) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY is missing from the environment.");
  const prompt = `You are a competitive programming parser. I will provide either raw scraped HTML, or OCR text from an image. Extract the problem details into a clean format. Find the hidden system tests if you can deduce them.\nData:\n${rawTextOrUrl}\nRespond strictly with JSON:\n{"title": "...", "descriptionHtml": "...", "testcases": [{"input": "...", "expectedOutput": "..."}], "requiresRedirect": false}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    return parseAiJsonResponse(data.candidates[0].content.parts[0].text);
  } catch (error) {
    return { title: "Custom Problem", descriptionHtml: "View source link.", testcases: [], requiresRedirect: true };
  }
}

export async function extractProblemFromImageBase64(base64Data: string, mimeType: string = 'image/jpeg') {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY is missing from the environment.");
  const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
  const prompt = `You are an expert Optical Character Recognition (OCR) system and competitive programming parser. I have provided an image of a coding problem. 1. Extract all text accurately. 2. Format the problem description beautifully into HTML (use <h3>, <p>, <ul>, and <pre> tags for constraints and code). 3. Identify the sample inputs and outputs. 4. Generate 5 additional tricky hidden test cases based on the constraints.\nRespond strictly with JSON:\n{"title": "Extracted Problem Title", "descriptionHtml": "<div class='problem-statement'>...</div>", "testcases": [{"input": "...", "expectedOutput": "..."}]}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [ { text: prompt }, { inlineData: { mimeType, data: cleanBase64 } } ] }], generationConfig: { responseMimeType: "application/json" } });
    return parseAiJsonResponse(data.candidates[0].content.parts[0].text);
  } catch (error: any) {
    console.error("AI Image OCR Error:", error.response?.data || error.message);
    throw new Error("Failed to parse problem from image.");
  }
}

export async function generateTestCasesWithAI(problemDescription: string, masterSolution: string) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY is missing from the environment.");
  const prompt = `You are an expert competitive programming judge. Problem Description: ${sanitizeDescriptionForPrompt(problemDescription)}\nMaster Solution (Always Correct):\n${masterSolution}\nGenerate 20 tricky, edge-case system test cases for this problem. Include edge cases like 0, negative numbers, maximum constraints, or empty arrays where applicable. This is for the serial judge system. Respond strictly with a JSON array of objects. Do not include markdown formatting.\nFormat: [{"input": "...", "expectedOutput": "...", "explanation": "..."}]`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    return parseAiJsonResponse(data.candidates[0].content.parts[0].text, true);
  } catch (error: any) {
    console.error("AI Generation Error from Google:", error.response?.data || error.message);
    return [];
  }
}

export async function findFailingTestCaseWithAI(problemDescription: string, userCode: string) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY is missing from the environment.");
  const prompt = `You are an expert competitive programming tutor. Problem Description: ${sanitizeDescriptionForPrompt(problemDescription)}\nUser's Failing Code:\n${userCode}\nThe user's code is getting a "Wrong Answer" or "Runtime Error". 1. Find the logical flaw. 2. Provide exactly ONE short test case input that makes their code fail. 3. Provide the expected correct output for that input. 4. Provide a 1-sentence hint (do NOT give them the code solution).\nRespond strictly with a JSON object.\nFormat: {"input": "...", "expectedOutput": "...", "hint": "..."}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    return parseAiJsonResponse(data.candidates[0].content.parts[0].text);
  } catch (error: any) {
    console.error("AI Debug Error from Google:", error.response?.data || error.message);
    throw new Error("Failed to parse AI debug response.");
  }
}

export async function generateSolutionExplanationWithAI(problemDescription: string) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY is missing from the environment.");
  const prompt = `You are an AI programming tutor. A student is stuck on this problem:\n${sanitizeDescriptionForPrompt(problemDescription)}\nBreak down the optimal approach step-by-step. Do not just output raw code. Explain the logic, data structures used, and time complexity. Respond strictly with a JSON object.\nFormat: {"summary": "...", "steps": ["step 1...", "step 2..."], "complexity": "..."}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    return parseAiJsonResponse(data.candidates[0].content.parts[0].text);
  } catch (error: any) {
    console.error("AI Explanation Error from Google:", error.response?.data || error.message);
    throw new Error("Failed to generate AI explanation.");
  }
}

export async function generateToughTestCases(problemDescriptionHtml: string) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return [];
  const prompt = `You are an expert competitive programming judge. Read the following problem description:\n${sanitizeDescriptionForPrompt(problemDescriptionHtml)}\nGenerate exactly 20 tricky, edge-case system test cases for this problem to feed the serial judge. Respond strictly with a JSON array of objects. Format: [{"input": "...", "expectedOutput": "..."}]`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    return parseAiJsonResponse(data.candidates[0].content.parts[0].text, true);
  } catch (error: any) {
    console.error("AI Generation Error from Google:", error.response?.data || error.message);
    return []; 
  }
}

export async function debugCodeWithAI(userCode: string, problemDescription: string) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY missing");
  const prompt = `You are a competitive programming debugger. Problem Description: ${sanitizeDescriptionForPrompt(problemDescription)}\nUser Code: ${userCode}\nFind the logical error. Provide: 1. A short hint about the bug. 2. A minimal input that breaks the code. 3. The expected correct output for that input.\nReturn ONLY JSON: {"hint": "...", "input": "...", "expectedOutput": "..."}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    return parseAiJsonResponse(data.candidates[0].content.parts[0].text);
  } catch (error: any) {
    return { hint: "Could not parse AI response", input: "", expectedOutput: "" };
  }
}