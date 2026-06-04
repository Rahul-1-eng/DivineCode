import axios from 'axios';

export async function generateTestCasesWithAI(problemDescription: string, masterSolution: string) {
  // 👉 Read the key INSIDE the function so it never gets stuck as undefined
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY is missing from the environment.");

  const prompt = `
    You are an expert competitive programming judge.
    Problem Description: ${problemDescription}
    Master Solution (Always Correct):
    ${masterSolution}

    Generate 5 tricky, edge-case system test cases for this problem. Include edge cases like 0, negative numbers, maximum constraints, or empty arrays where applicable.
    Respond strictly with a JSON array of objects. Do not include markdown formatting.
    Format: [{"input": "...", "expectedOutput": "...", "explanation": "..."}]
  `;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    });

    const jsonString = data.candidates[0].content.parts[0].text;
    return JSON.parse(jsonString);
  } catch (error: any) {
    console.error("AI Generation Error from Google:", error.response?.data || error.message);
    throw new Error("Failed to parse AI test cases.");
  }
}

export async function findFailingTestCaseWithAI(problemDescription: string, userCode: string) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY is missing from the environment.");

  const prompt = `
    You are an expert competitive programming tutor.
    Problem Description: ${problemDescription}
    User's Failing Code:
    ${userCode}

    The user's code is getting a "Wrong Answer" or "Runtime Error". 
    1. Find the logical flaw.
    2. Provide exactly ONE short test case input that makes their code fail.
    3. Provide the expected correct output for that input.
    4. Provide a 1-sentence hint (do NOT give them the code solution).

    Respond strictly with a JSON object. Do not include markdown formatting.
    Format: {"input": "...", "expectedOutput": "...", "hint": "..."}
  `;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    });

    const jsonString = data.candidates[0].content.parts[0].text;
    return JSON.parse(jsonString);
  } catch (error: any) {
    console.error("AI Debug Error from Google:", error.response?.data || error.message);
    throw new Error("Failed to parse AI debug response.");
  }
}

// 👉 NEW: AI Explainer specifically formatted for animation / step-by-step reading
export async function generateSolutionExplanationWithAI(problemDescription: string) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY is missing from the environment.");

  const prompt = `
    You are an AI programming tutor. A student is stuck on this problem:
    ${problemDescription}

    Break down the optimal approach step-by-step. Do not just output raw code. 
    Explain the logic, data structures used, and time complexity.
    Respond strictly with a JSON object. Do not include markdown formatting.
    Format: {"summary": "...", "steps": ["step 1...", "step 2..."], "complexity": "..."}
  `;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    });

    const jsonString = data.candidates[0].content.parts[0].text;
    return JSON.parse(jsonString);
  } catch (error: any) {
    console.error("AI Explanation Error from Google:", error.response?.data || error.message);
    throw new Error("Failed to generate AI explanation.");
  }
}
// Add this export to apps/api/src/modules/ai/aiService.ts
export async function generateToughTestCases(problemDescriptionHtml: string) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY is missing from the environment.");

  const prompt = `
    You are an expert competitive programming judge. 
    Read the following problem description:
    ${problemDescriptionHtml}

    Generate exactly 3 tricky, edge-case system test cases for this problem (e.g., maximum constraints, zeroes, empty inputs).
    Respond strictly with a JSON array of objects. Do not include markdown formatting.
    Format: [{"input": "...", "expectedOutput": "..."}]
  `;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    });

    const jsonString = data.candidates[0].content.parts[0].text;
    return JSON.parse(jsonString);
  } catch (error: any) {
    console.error("AI Generation Error from Google:", error.response?.data || error.message);
    return []; // Return empty array so it doesn't crash the problem insertion
  }
}