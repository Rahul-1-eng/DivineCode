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

export async function analyzeSubmissionLogic(submissionId: string, problemDescription: string, userCode: string) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return;

  const prompt = `You are an expert code reviewer. Problem Description: ${sanitizeDescriptionForPrompt(problemDescription)}\nSubmitted Code:\n${userCode}\nAnalyze this code. Provide exactly four things:\n1. A short paragraph of feedback on the logic (is it optimal?).\n2. The Big-O Time Complexity (e.g., O(N log N)).\n3. A similarity score from 0.0 to 1.0 indicating how similar this is to a standard copied template or known online solution. (0.0 = highly original, 1.0 = exact copy of common online solution).\n4. A boolean indicating if it seems highly plagiarized or AI-generated (true if similarity score > 0.85).\nRespond strictly with JSON:\n{"feedback": "...", "complexity": "O(...)", "similarityScore": 0.8, "isPlagiarized": false}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    return parseAiJsonResponse(data.candidates[0].content.parts[0].text);
  } catch (error: any) {
    return { hint: "Could not parse AI response", input: "", expectedOutput: "" };
  }
}
// Add this at the bottom of aiService.ts

export async function askAiChatbot(query: string) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return "API Key missing. Please configure your environment variables.";
  
  const lowerQuery = query.toLowerCase();

  // 1. Instant Cache for FAQs
  if (lowerQuery.includes("how to submit") || lowerQuery.includes("submit code")) {
    return "To submit code, write your solution in the editor on the right, select your language, and click the green 'Submit 🚀' button. We'll run it against the hidden system test cases!";
  }
  if (lowerQuery.includes("cph") || lowerQuery.includes("competitive programming helper")) {
    return "CPH (Competitive Programming Helper) is a browser extension that allows you to send test cases directly to VS Code. Make sure the extension is installed and running on port 10043.";
  }
  if (lowerQuery.includes("duel") || lowerQuery.includes("matchmaking")) {
    return "In Duels, you can play 1v1 against other coders. You get 2 chances per question. A correct answer gives +100 points, and a wrong answer deducts 20 points!";
  }
  if (lowerQuery.includes("rating") || lowerQuery.includes("score")) {
    return "Your rating and group scores are updated automatically at the end of the contest. Group scores rely on the first person to solve a problem in your team!";
  }

  // 2. Fallback to Gemini 
  try {
    const prompt = `You are a helpful coding assistant for the DivineCode platform. Answer this user query clearly and concisely: ${query}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, { 
      contents: [{ parts: [{ text: prompt }] }],
    });
    return data.candidates[0].content.parts[0].text;
  } catch (e: any) {
    console.error("Chatbot API Error:", e.message);
    return "My neural pathways are a bit tangled right now, please try asking again in a few moments.";
  }
}