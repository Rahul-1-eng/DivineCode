import axios from 'axios';
import { prisma } from '../../prisma/client';

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

const getAiModel = () => process.env.AI_MODEL || 'gemini-3.5-flash';

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
  } catch (error: any) { console.error("AI Logic Analysis Error:", error.response?.data || error.message); }
}

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

type CachedQA = { keywords: string[]; response: string };

const FAQ_RESOURCES: CachedQA[] = [
  {
    keywords: ["submit", "code", "run", "arena", "button"],
    response: "To evaluate a challenge, implement your structural code block inside the editor context container on the space panel layout workspace, allocate the matching language interpreter extension token via the parameter selection toggle node, and trigger the green 'Submit 🚀' action layout."
  },
  {
    keywords: ["cph", "extension", "localhost", "helper", "port"],
    response: "The Competitive Programming Helper (CPH) framework relies on a client-side execution interface operating on localhost standard route port 10043. Confirm the browser execution agent is running natively before attempting data block synchronization."
  },
  {
    keywords: ["duel", "arena", "attempts", "penalty", "matchmaking"],
    response: "The Duel challenge container features head-to-head 1v1 execution structures. Each target matrix question allocates a strict ceiling limit of exactly 2 evaluation attempts. Correct allocations award +100 score metrics, while false processing yields a -20 item offset deduction."
  },
  {
    keywords: ["rating", "score", "coins", "update", "allocation"],
    response: "Elo parameters, global profile rating structures, and won currency coins are calculated atomically by the server engine when a contest enters ContestStatus.ENDED state. Team parameters utilize the initial historical correct allocation profile timestamp node."
  }
];

export async function askAiChatbot(query: string): Promise<string> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return "AI Configuration key is missing from server architecture variables environment maps.";

  const tokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  
  let bestMatch: CachedQA | null = null;
  let maxMatchPercentage = 0;

  for (const entry of FAQ_RESOURCES) {
    const intersections = entry.keywords.filter(keyword => tokens.includes(keyword));
    const matchPercentage = intersections.length / entry.keywords.length;

    if (matchPercentage > 0.5 && matchPercentage > maxMatchPercentage) {
      maxMatchPercentage = matchPercentage;
      bestMatch = entry;
    }
  }

  if (bestMatch) {
    return bestMatch.response;
  }

  try {
    const prompt = `You are a helpful engineering assistant for the DivineCode platform. Provide a crisp, directly helpful answer for this query without markdown errors or unnecessary code blocks: ${query}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }] });
    
    let aiResponse = data.candidates[0].content.parts[0].text;
    return aiResponse.trim();
  } catch (err: any) {
    console.error("AI Fallback Error:", err.response?.data || err.message);
    return "AI Service Error: Failed to generate a response. The model may be rate-limited or unavailable.";
  }
}

// --------------------------------------------------------
// FAANG Technical Interview AI Engine (With Gapless Live Code Support)
// --------------------------------------------------------

// 👉 ADDED: The `currentCode` parameter to process what is in their IDE.
export async function conductAiInterview(problemPrompt: string, userResponse: string, chatHistory: any[] = [], currentCode?: string) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY is missing from the environment.");

  const historyString = chatHistory.map(msg => `${msg.role.toUpperCase()}: ${msg.text}`).join('\n');

  // 👉 ADDED: Contextualizes the prompt if code is present
  const codeContext = currentCode && currentCode.trim() !== '' && currentCode.trim() !== '// Implementation source framework entry' && currentCode.trim() !== '// Write your solution here...'
    ? `\nCandidate's Current Editor Code:\n\`\`\`\n${currentCode}\n\`\`\`\n\nCross-reference their spoken response with the code they have written. Does their spoken logic align with their actual code implementation? Point out discrepancies if any.`
    : '';

  const prompt = `You are a senior FAANG technical interviewer. 
  The candidate is answering the following question: "${problemPrompt}"
  
  Previous Conversation:
  ${historyString}

  Candidate's Latest Spoken Response: "${userResponse}"${codeContext}

  Evaluate the candidate's latest response. 
  1. Provide constructive, conversational feedback.
  2. If their answer is incomplete or mathematically unoptimized, ask a follow-up question to guide them.
  3. If they fully solved it (both spoken logic and any provided code), congratulate them.
  4. Assign a current progress score from 0 to 100.
  5. Set "isPassed" to true ONLY if they have thoroughly answered the core concept optimally AND their code logic matches.

  Respond strictly with a JSON object. Format: 
  {"feedback": "...", "followUpQuestion": "...", "score": 85, "isPassed": false}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getAiModel()}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { 
      contents: [{ parts: [{ text: prompt }] }], 
      generationConfig: { responseMimeType: "application/json" } 
    });
    return parseAiJsonResponse(data.candidates[0].content.parts[0].text);
  } catch (error: any) {
    console.error("AI Interview Error:", error.response?.data || error.message);
    throw new Error("Failed to process mock interview response.");
  }
}