// apps/api/src/modules/ai/aiService.ts
const AI_API_KEY = process.env.AI_API_KEY;

export async function generateTestCasesWithAI(problemDescription: string, masterSolution: string) {
  if (!AI_API_KEY) throw new Error("AI_API_KEY is not configured.");

  const prompt = `
    You are an expert competitive programming judge.
    Problem Description: ${problemDescription}
    Master Solution (Always Correct):
    ${masterSolution}

    Generate 5 tricky, edge-case system test cases for this problem. Include edge cases like 0, negative numbers, maximum constraints, or empty arrays where applicable.
    Respond strictly with a JSON array of objects. Do not include markdown formatting.
    Format: [{"input": "...", "expectedOutput": "...", "explanation": "..."}]
  `;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${AI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });

  const data = await response.json();
  try {
    const jsonString = data.candidates[0].content.parts[0].text;
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Error("Failed to parse AI test cases.");
  }
}

export async function findFailingTestCaseWithAI(problemDescription: string, userCode: string) {
  if (!AI_API_KEY) throw new Error("AI_API_KEY is not configured.");

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

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${AI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });

  const data = await response.json();
  try {
    const jsonString = data.candidates[0].content.parts[0].text;
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Error("Failed to parse AI debug response.");
  }
}