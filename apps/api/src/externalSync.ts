export type CodeforcesSubmission = {
  id: number;
  creationTimeSeconds: number;
  problem?: { contestId?: number; index?: string; name?: string };
  programmingLanguage?: string;
  verdict?: string;
};

async function fetchCodeforcesStatusPage(handle: string, from: number, count: number) {
  const url = `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=${from}&count=${count}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Codeforces API returned ${response.status}`);
  const payload = await response.json() as { status: string; comment?: string; result?: CodeforcesSubmission[] };
  if (payload.status !== 'OK') throw new Error(payload.comment || 'Codeforces API failed');
  return payload.result || [];
}

function matchesAcceptedProblem(submission: CodeforcesSubmission, contestId: string, index: string) {
  return String(submission.problem?.contestId || '') === String(contestId) &&
    String(submission.problem?.index || '').toUpperCase() === String(index || '').toUpperCase() &&
    submission.verdict === 'OK';
}

export async function fetchCodeforcesAccepted(handle: string, contestId: string, index: string) {
  const pageSize = 1000;
  const maxPages = 10;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchCodeforcesStatusPage(handle, page * pageSize + 1, pageSize);
    const accepted = result.find((submission) => matchesAcceptedProblem(submission, contestId, index));
    if (accepted) return accepted;
    if (result.length < pageSize) return null;
  }
  return null;
}
