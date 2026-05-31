import './config/env';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { connectDB } from './db';
import { fetchCodeforcesAccepted } from './externalSync';
import { deleteContestDocument, loadContestDocuments, loadSubmissionDocuments, saveContestDocument, saveSubmissionDocument, upsertGoogleUser } from './storage';
import { mountV2Routes } from './routes/v2';
import { startQueueWorkers } from './workers/runWorkers';
import { enqueueCodeforcesContestSync } from './queues/queues';

const app = express();
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
app.use(cors({ origin: CLIENT_ORIGIN === '*' ? '*' : CLIENT_ORIGIN.split(',').map((origin) => origin.trim()) }));
app.use(express.json({ limit: '1mb' }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN === '*' ? '*' : CLIENT_ORIGIN.split(',').map((origin) => origin.trim()), methods: ['GET', 'POST'] } });

type McqQuestion = { id: number; question: string; options: string[]; correctIndex: number; concept: string };
type Player = { id: string; name: string; score: number };
type DuelRoom = { id: string; players: Player[]; questionIndex: number; questions: McqQuestion[]; finished: boolean };
type JudgeLanguage = 'cpp' | 'c' | 'java' | 'python' | 'javascript';
type Judge0Result = { stdout?: string | null; stderr?: string | null; compile_output?: string | null; time?: string | number | null; memory?: number | null; status?: { id?: number; description?: string } | null };
type ContestProblem = { id: string; title: string; platform: string; url: string; difficulty?: string; rating?: number; tags: string[]; stdin?: string; expectedOutput?: string; sourceCode?: string; contestCode?: string; problemIndex?: string };
type ContestMember = { id: string; name: string; email?: string; handle?: string; codeforcesHandle?: string; team?: string };
type ContestSolve = { memberId: string; problemId: string; solvedAtMinute: number; attempts: number };
type StandingRow = { memberId: string; name: string; solved: number; penalty: number; score: number; solvedProblems: string[] };
type Contest = { id: string; title: string; description: string; startTime: string; durationMinutes: number; isRated: boolean; ownerName?: string; ownerEmail?: string; ownerHandle?: string; createdAt: string; members: ContestMember[]; problems: ContestProblem[]; solves: ContestSolve[]; standings: StandingRow[]; questions: McqQuestion[] };

const languageMap: Record<JudgeLanguage, number> = { cpp: 54, c: 50, java: 62, python: 71, javascript: 63 };
const waitingPlayers: Player[] = [];
const rooms = new Map<string, DuelRoom>();
const contests = new Map<string, Contest>();
const submissions: any[] = [];
const problems = [
  { id: 1, title: 'Two Sum', difficulty: 800, tags: ['array', 'hash-map'], description: 'Find two indices whose values add up to target.', stdin: '4 9\n2 7 11 15\n', expectedOutput: '0 1' },
  { id: 2, title: 'Binary Search', difficulty: 900, tags: ['binary-search'], description: 'Find the target index in a sorted array.', stdin: '5 7\n1 3 5 7 9\n', expectedOutput: '3' },
  { id: 3, title: 'Reverse Linked List', difficulty: 1200, tags: ['linked-list'], description: 'Reverse a singly linked list.', stdin: '', expectedOutput: '' }
];

// 👉 PHASE 3: INTELLIGENT DUEL QUESTION BANK (DSA, SQL, OOPS, MIPS)
const intelligentQuestionsBank: Omit<McqQuestion, 'id'>[] = [
  { question: 'In a 5-stage MIPS architecture pipeline, which hazard is primarily resolved by data forwarding (bypassing)?', options: ['Structural Hazard', 'Control Hazard', 'Data Hazard', 'Branch Hazard'], correctIndex: 2, concept: 'MIPS Architecture' },
  { question: 'What is the worst-case time complexity of QuickSort if the pivot chosen is always the smallest element?', options: ['O(N log N)', 'O(N)', 'O(N^2)', 'O(log N)'], correctIndex: 2, concept: 'DSA - Sorting' },
  { question: 'Which SQL clause is evaluated FIRST by the database execution engine?', options: ['SELECT', 'FROM', 'WHERE', 'GROUP BY'], correctIndex: 1, concept: 'SQL Query Optimization' },
  { question: 'Which OOP principle relies on method overriding to allow a single interface to represent different underlying forms?', options: ['Encapsulation', 'Abstraction', 'Inheritance', 'Polymorphism'], correctIndex: 3, concept: 'OOPS Principles' },
  { question: 'In a binary search tree (BST), which depth-first traversal consistently produces a sorted list of elements?', options: ['Preorder', 'Inorder', 'Postorder', 'Level-order'], correctIndex: 1, concept: 'DSA - Trees' },
  { question: 'What is the primary purpose of a clustered index in a relational SQL database?', options: ['To create a virtual table for security', 'To dictate the physical storage order of the data on disk', 'To enforce foreign key relationships', 'To encrypt sensitive integer columns'], correctIndex: 1, concept: 'SQL Indexing' },
  { question: 'In the standard MIPS pipeline, during which stage is the ALU (Arithmetic Logic Unit) primarily active for an R-type instruction?', options: ['Instruction Fetch (IF)', 'Instruction Decode (ID)', 'Execution (EX)', 'Memory Access (MEM)'], correctIndex: 2, concept: 'MIPS Pipeline Stages' },
  { question: 'Which algorithm is optimal for finding the shortest path from a single source to all other vertices in a weighted graph with NO negative cycles?', options: ['Kruskal\'s Algorithm', 'Bellman-Ford Algorithm', 'Dijkstra\'s Algorithm', 'Floyd-Warshall Algorithm'], correctIndex: 2, concept: 'DSA - Graphs' }
];

function generateIntelligentMcqs(): McqQuestion[] {
  // Shuffle the bank and pick 5 random questions for this specific duel match
  const shuffled = [...intelligentQuestionsBank].sort(() => 0.5 - Math.random()).slice(0, 5);
  return shuffled.map((q, idx) => ({ ...q, id: idx + 1 }));
}

function id(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function normalizeOutput(value: string | null | undefined) { return (value || '').trim().replace(/\s+/g, ' '); }
function getContestMinute(contest: Contest) { return Math.max(1, Math.floor((Date.now() - new Date(contest.startTime).getTime()) / 60000)); }
function slugHandle(name: string) { return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `member_${Math.random().toString(36).slice(2, 6)}`; }
function uniqueByName(names: string[]) { return [...new Set(names.map((name) => String(name || '').trim()).filter(Boolean))]; }
function normalizeIdentity(value: unknown) { return String(value || '').trim().toLowerCase(); }
function parseMember(input: any): ContestMember { const raw = typeof input === 'string' ? { name: input } : input || {}; const email = String(raw.email || '').trim(); const name = String(raw.name || raw.handle || raw.codeforcesHandle || email || '').trim(); const cf = String(raw.codeforcesHandle || raw.handle || name).trim(); const team = String(raw.team || 'Individuals').trim() || 'Individuals'; return { id: String(raw.id || id('member')), name, email, handle: slugHandle(name), codeforcesHandle: cf, team }; }
function getViewerEmail(req: any) { return String(req.headers?.['x-user-email'] || req.query?.viewerEmail || req.body?.viewerEmail || req.body?.userId || req.body?.ownerEmail || '').trim(); }
function getViewerName(req: any) { return String(req.headers?.['x-user-name'] || req.query?.viewerName || req.body?.viewerName || req.body?.userName || req.body?.ownerName || '').trim(); }
function identitiesMatch(left?: string, right?: string) { const a = normalizeIdentity(left); const b = normalizeIdentity(right); return Boolean(a && b && a === b); }
function isContestOwner(contest: Contest, viewerEmail?: string, viewerName?: string) { return identitiesMatch(contest.ownerEmail, viewerEmail) || identitiesMatch(contest.ownerName, viewerName); }
function findViewerMember(contest: Contest, viewerEmail?: string, viewerName?: string) { return contest.members.find((member) => identitiesMatch(member.email, viewerEmail) || identitiesMatch(member.name, viewerName) || identitiesMatch(member.name, viewerEmail) || identitiesMatch(member.email, viewerName) || identitiesMatch(member.codeforcesHandle, viewerName)); }
function contestHasEnded(contest: Contest) { return Date.now() >= new Date(contest.startTime).getTime() + contest.durationMinutes * 60000; }
function sanitizeProblemForViewer(problem: ContestProblem, canSeeMeta: boolean) { if (canSeeMeta) return problem; const { rating, difficulty, tags, stdin, expectedOutput, sourceCode, contestCode, problemIndex, ...safeProblem } = problem; return { ...safeProblem, tags: [] }; }
function sanitizeContestForViewer(contest: Contest, req: any) { const viewerEmail = getViewerEmail(req); const viewerName = getViewerName(req); const canManage = isContestOwner(contest, viewerEmail, viewerName); const viewerMember = findViewerMember(contest, viewerEmail, viewerName); const canSeeProblemMeta = canManage || contestHasEnded(contest); return { ...contest, ownerEmail: canManage ? contest.ownerEmail : undefined, canManage, viewerMember: viewerMember || null, visibility: { canSeeProblemMeta, canViewAllSubmissions: canManage, submissionScope: canManage ? 'all' : viewerMember?.team && viewerMember.team !== 'Individuals' ? 'team' : viewerMember ? 'own' : 'none' }, problems: contest.problems.map((problem) => sanitizeProblemForViewer(problem, canSeeProblemMeta)), questions: canManage ? contest.questions : [] }; }
function ensureOwnerRequest(contest: Contest, req: any, res: any) { if (isContestOwner(contest, getViewerEmail(req), getViewerName(req))) return true; res.status(403).json({ error: 'Only the contest creator can edit or delete this mashup.' }); return false; }
function sanitizePeerSubmission(submission: any) { const { code, stdout, stderr, compileOutput, compile_output, externalSubmissionId, ...safeSubmission } = submission; return safeSubmission; }
function filterSubmissionsForViewer(contest: Contest, contestSubmissions: any[], req: any) { const viewerEmail = getViewerEmail(req); const viewerName = getViewerName(req); if (isContestOwner(contest, viewerEmail, viewerName)) return contestSubmissions; const viewerMember = findViewerMember(contest, viewerEmail, viewerName); if (!viewerMember) return []; const membersById = Object.fromEntries(contest.members.map((member) => [member.id, member])); return contestSubmissions.flatMap((submission) => { if (submission.memberId === viewerMember.id) return [submission]; const submissionMember = membersById[submission.memberId]; if (viewerMember.team && viewerMember.team !== 'Individuals' && submissionMember?.team === viewerMember.team) return [sanitizePeerSubmission(submission)]; return []; }); }
function parseCodeforcesCode(raw: string) { const clean = raw.trim().toUpperCase().replace(/\s+/g, ''); const match = clean.match(/^(\d+)([A-Z][0-9]?)$/); return match ? { contestCode: match[1], problemIndex: match[2] } : { contestCode: raw, problemIndex: '' }; }
function buildProblemUrl(platform: string, contestCode: string, problemIndex: string, url: string) { if (url?.trim()) return url.trim(); const p = platform.toLowerCase(); if (p.includes('codeforces') && contestCode && problemIndex) return `https://codeforces.com/problemset/problem/${contestCode}/${problemIndex}`; if (p.includes('leetcode') && contestCode) return `https://leetcode.com/problems/${contestCode}`; if (p.includes('atcoder') && contestCode && problemIndex) return `https://atcoder.jp/contests/${contestCode}/tasks/${contestCode}_${problemIndex.toLowerCase()}`; if (p.includes('codechef') && contestCode) return `https://www.codechef.com/problems/${contestCode}`; return ''; }
function estimateRating(index: string, supplied?: number) { if (supplied) return supplied; const first = (index || 'A').toUpperCase()[0]; return { A: 800, B: 1000, C: 1300, D: 1600, E: 1900, F: 2200 }[first as 'A'] || 1200; }
function lookupPlatformProblem(platform: string, code: string) { const p = platform.toLowerCase(); if (p.includes('codeforces')) { const parsed = parseCodeforcesCode(code); const rating = estimateRating(parsed.problemIndex); return { platform: 'Codeforces', contestCode: parsed.contestCode, problemIndex: parsed.problemIndex, sourceCode: `${parsed.contestCode}${parsed.problemIndex}`, title: `Codeforces ${parsed.contestCode}${parsed.problemIndex}`, url: buildProblemUrl('Codeforces', parsed.contestCode, parsed.problemIndex, ''), rating, difficulty: String(rating), tags: ['implementation'] }; } if (p.includes('leetcode')) return { platform: 'LeetCode', contestCode: code.trim(), problemIndex: '', sourceCode: code.trim(), title: code.trim().split('-').map((x) => x[0]?.toUpperCase() + x.slice(1)).join(' '), url: buildProblemUrl('LeetCode', code.trim(), '', ''), rating: 1200, difficulty: 'Medium', tags: ['leetcode'] }; if (p.includes('atcoder')) return { platform: 'AtCoder', contestCode: code.trim().split('_')[0], problemIndex: code.trim().split('_')[1] || 'A', sourceCode: code.trim(), title: `AtCoder ${code}`, url: buildProblemUrl('AtCoder', code.trim().split('_')[0], code.trim().split('_')[1] || 'A', ''), rating: 1000, difficulty: 'Practice', tags: ['atcoder'] }; if (p.includes('codechef')) return { platform: 'CodeChef', contestCode: code.trim(), problemIndex: '', sourceCode: code.trim(), title: `CodeChef ${code}`, url: buildProblemUrl('CodeChef', code.trim(), '', ''), rating: 1000, difficulty: 'Practice', tags: ['codechef'] }; return { platform, contestCode: code, problemIndex: '', sourceCode: code, title: `${platform} ${code}`, url: '', rating: 1000, difficulty: 'Practice', tags: [platform.toLowerCase()] }; }
function makeContestProblem(input: any): ContestProblem { const platform = String(input.platform || 'External'); const contestCode = String(input.contestCode || input.code || ''); const problemIndex = String(input.problemIndex || ''); return { id: String(input.id || id('problem')), title: String(input.title || `${platform} ${contestCode}${problemIndex}`).trim(), platform, url: buildProblemUrl(platform, contestCode, problemIndex, String(input.url || '')), difficulty: input.difficulty ? String(input.difficulty) : problemIndex || undefined, rating: Number(input.rating || estimateRating(problemIndex)), tags: String(input.tags || platform).split(',').map((t: string) => t.trim()).filter(Boolean), stdin: String(input.stdin || ''), expectedOutput: String(input.expectedOutput || ''), sourceCode: `${contestCode}${problemIndex}`, contestCode, problemIndex }; }
function rebuildStandings(contest: Contest) { contest.standings = contest.members.map((member) => { const memberSolves = contest.solves.filter((solve) => solve.memberId === member.id && contest.problems.some((p) => p.id === solve.problemId)); const solvedProblems = memberSolves.map((solve) => solve.problemId); const penalty = memberSolves.reduce((sum, solve) => sum + solve.solvedAtMinute + Math.max(0, solve.attempts - 1) * 20, 0); return { memberId: member.id, name: member.name, solved: memberSolves.length, penalty, score: memberSolves.length * 1000 - penalty, solvedProblems }; }).sort((a, b) => b.solved - a.solved || a.penalty - b.penalty || a.name.localeCompare(b.name)); }
function persistContest(contest: Contest) { void saveContestDocument(contest).catch((error) => console.error('Could not persist contest:', error instanceof Error ? error.message : error)); }
function recordSolve(contest: Contest, memberId: string, problemId: string) { const existing = contest.solves.find((s) => s.memberId === memberId && s.problemId === problemId); if (existing) return existing; const solve = { memberId, problemId, solvedAtMinute: getContestMinute(contest), attempts: 1 }; contest.solves.push(solve); rebuildStandings(contest); persistContest(contest); return solve; }
function serializeContestList(contest: Contest) { return { id: contest.id, title: contest.title, description: contest.description, startTime: contest.startTime, durationMinutes: contest.durationMinutes, isRated: contest.isRated, ownerName: contest.ownerName, membersCount: contest.members.length, problemsCount: contest.problems.length, questionCount: contest.questions?.length || 0, createdAt: contest.createdAt }; }
async function ensureUnsolvedByContestMembers(contest: Contest, platform: string, contestCode: string, problemIndex: string) { if (!platform.toLowerCase().includes('codeforces')) return; for (const member of contest.members) { const handle = member.codeforcesHandle || member.handle || member.name; if (!handle) continue; const accepted = await fetchCodeforcesAccepted(handle, contestCode, problemIndex); if (accepted) throw new Error(`Cannot add ${contestCode}${problemIndex}. ${handle} has already solved it on Codeforces.` ); } }
async function restoreFromMongo() { try { const restoredContests = await loadContestDocuments(); const restoredSubmissions = await loadSubmissionDocuments(); contests.clear(); submissions.splice(0, submissions.length, ...restoredSubmissions); for (const contest of restoredContests as Contest[]) { contest.members = (contest.members || []).map(parseMember); rebuildStandings(contest); contests.set(contest.id, contest); } console.log(`Mongo restore complete: ${contests.size} contest(s), ${submissions.length} submission(s).`); } catch (error) { console.error('Mongo restore failed:', error instanceof Error ? error.message : error); } }

app.get('/', (_req, res) => { res.json({ status: 'ok', app: 'DivineCode API', contests: contests.size, submissions: submissions.length }); });
mountV2Routes(app, io);
app.post('/api/auth/google', async (req, res) => { try { const user = await upsertGoogleUser(req.body); res.json({ ok: true, user }); } catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Could not save Google user' }); } });
app.get('/api/problems', (_req, res) => { res.json(problems.map(({ stdin, expectedOutput, ...safeProblem }) => safeProblem)); });
app.get('/api/problems/lookup', (req, res) => { const platform = String(req.query.platform || 'Codeforces'); const code = String(req.query.code || ''); if (!code.trim()) { res.status(400).json({ error: 'Problem code is required' }); return; } res.json(lookupPlatformProblem(platform, code)); });
app.get('/api/problems/:id', (req, res) => { const problem = problems.find((item) => item.id === Number(req.params.id)); if (!problem) { res.status(404).json({ error: 'Problem not found' }); return; } const { stdin, expectedOutput, ...safeProblem } = problem; res.json(safeProblem); });
app.get('/api/members/suggestions', (_req, res) => { const existing = [...contests.values()].flatMap((contest) => contest.members.map((member) => member.name)); res.json(uniqueByName([...existing, 'Rahul', 'Code Warrior', 'Team Alpha', 'Team Beta', 'Tourist', 'Petr', 'Benq', 'Errichto'])); });
app.get('/api/contests', (_req, res) => { res.json([...contests.values()].map(serializeContestList)); });
app.post('/api/contests', async (req, res) => { const { title, description, startTime, durationMinutes, isRated, members, problems: contestProblems, ownerName, ownerEmail, ownerHandle } = req.body; if (!String(title || '').trim()) { res.status(400).json({ error: 'Contest title is required' }); return; } const safeMembers: ContestMember[] = (Array.isArray(members) ? members : []).map(parseMember).filter((m) => m.name); const tempContest: Contest = { id: id('contest'), title: String(title).trim(), description: String(description || 'Private group contest room'), startTime: startTime || new Date().toISOString(), durationMinutes: Math.max(1, Number(durationMinutes || 120)), isRated: Boolean(isRated), ownerName: String(ownerName || '').trim(), ownerEmail: String(ownerEmail || '').trim(), ownerHandle: String(ownerHandle || '').trim(), members: safeMembers, problems: [], solves: [], standings: [], questions: [], createdAt: new Date().toISOString() }; const safeProblems: ContestProblem[] = []; try { for (const p of Array.isArray(contestProblems) ? contestProblems : []) { const problem = makeContestProblem(p); if (problem.platform.toLowerCase().includes('codeforces')) await ensureUnsolvedByContestMembers(tempContest, problem.platform, problem.contestCode || '', problem.problemIndex || ''); safeProblems.push(problem); } } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Problem already solved by participant' }); return; } if (safeMembers.length === 0) { res.status(400).json({ error: 'Add at least one player.' }); return; } if (safeProblems.filter((p) => p.title && p.url).length === 0) { res.status(400).json({ error: 'Add at least one valid problem.' }); return; } tempContest.problems = safeProblems.filter((p) => p.title && p.url); rebuildStandings(tempContest); contests.set(tempContest.id, tempContest); persistContest(tempContest); res.status(201).json(sanitizeContestForViewer(tempContest, req)); });
app.get('/api/contests/:id', (req, res) => { const contest = contests.get(req.params.id); if (!contest) { res.status(404).json({ error: 'Contest not found' }); return; } rebuildStandings(contest); res.json(sanitizeContestForViewer(contest, req)); });
app.get('/api/contests/:id/submissions', (req, res) => { const contest = contests.get(req.params.id); if (!contest) { res.status(404).json({ error: 'Contest not found' }); return; } const contestSubmissions = submissions.filter((s) => s.contestId === req.params.id).slice(-100).reverse(); res.json(filterSubmissionsForViewer(contest, contestSubmissions, req)); });
app.put('/api/contests/:id', (req, res) => { const contest = contests.get(req.params.id); if (!contest) { res.status(404).json({ error: 'Contest not found' }); return; } if (!ensureOwnerRequest(contest, req, res)) return; const title = String(req.body.title || '').trim(); if (title) contest.title = title; if (typeof req.body.description === 'string') contest.description = req.body.description; if (req.body.startTime) contest.startTime = String(req.body.startTime); if (req.body.durationMinutes) contest.durationMinutes = Math.max(1, Number(req.body.durationMinutes)); if (typeof req.body.isRated === 'boolean') contest.isRated = req.body.isRated; persistContest(contest); res.json(sanitizeContestForViewer(contest, req)); });
app.delete('/api/contests/:id', async (req, res) => { const contest = contests.get(req.params.id); if (!contest) { res.status(404).json({ error: 'Contest not found' }); return; } if (!ensureOwnerRequest(contest, req, res)) return; contests.delete(req.params.id); for (let i = submissions.length - 1; i >= 0; i -= 1) { if (submissions[i]?.contestId === req.params.id) submissions.splice(i, 1); } await deleteContestDocument(req.params.id).catch((error) => console.error('Could not delete contest document:', error instanceof Error ? error.message : error)); res.json({ ok: true, deletedContestId: req.params.id }); });

app.post('/api/contests/:id/sync/codeforces', async (req, res) => {
  const contestId = req.params.id;
  const contest = contests.get(contestId);
  if (!contest) {
    res.status(404).json({ error: 'Contest not found' });
    return;
  }
  try {
    await enqueueCodeforcesContestSync(contestId);
    res.json({ ok: true, message: 'Codeforces live synchronization job successfully scheduled.' });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to dispatch worker queue transaction.' });
  }
});

app.post('/api/contests/:id/extend', (req, res) => { const contest = contests.get(req.params.id); if (!contest) { res.status(404).json({ error: 'Contest not found' }); return; } if (!ensureOwnerRequest(contest, req, res)) return; contest.durationMinutes += Math.max(1, Number(req.body.minutes || 15)); persistContest(contest); res.json(sanitizeContestForViewer(contest, req)); });
app.post('/api/contests/:id/members', (req, res) => { const contest = contests.get(req.params.id); if (!contest) { res.status(404).json({ error: 'Contest not found' }); return; } if (!ensureOwnerRequest(contest, req, res)) return; (Array.isArray(req.body.members) ? req.body.members : [req.body]).map(parseMember).forEach((member) => { if (member.name && !contest.members.some((m) => m.name.toLowerCase() === member.name.toLowerCase())) contest.members.push(member); }); rebuildStandings(contest); persistContest(contest); res.json(sanitizeContestForViewer(contest, req)); });
app.post('/api/contests/:id/problems', async (req, res) => { const contest = contests.get(req.params.id); if (!contest) { res.status(404).json({ error: 'Contest not found' }); return; } if (!ensureOwnerRequest(contest, req, res)) return; const problem = makeContestProblem(req.body); try { if (problem.platform.toLowerCase().includes('codeforces')) await ensureUnsolvedByContestMembers(contest, problem.platform, problem.contestCode || '', problem.problemIndex || ''); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Problem already solved by participant' }); return; } if (!problem.url) { res.status(400).json({ error: 'Problem URL is required' }); return; } contest.problems.push(problem); rebuildStandings(contest); persistContest(contest); res.json(sanitizeContestForViewer(contest, req)); });
app.delete('/api/contests/:id/problems/:problemId', (req, res) => { const contest = contests.get(req.params.id); if (!contest) { res.status(404).json({ error: 'Contest not found' }); return; } if (!ensureOwnerRequest(contest, req, res)) return; contest.problems = contest.problems.filter((p) => p.id !== req.params.problemId); contest.solves = contest.solves.filter((s) => s.problemId !== req.params.problemId); rebuildStandings(contest); persistContest(contest); res.json(sanitizeContestForViewer(contest, req)); });
app.put('/api/contests/:id/problems/:problemId', async (req, res) => { const contest = contests.get(req.params.id); if (!contest) { res.status(404).json({ error: 'Contest not found' }); return; } if (!ensureOwnerRequest(contest, req, res)) return; const index = contest.problems.findIndex((p) => p.id === req.params.problemId); if (index < 0) { res.status(404).json({ error: 'Problem not found' }); return; } const problem = makeContestProblem({ ...req.body, id: req.params.problemId }); try { if (problem.platform.toLowerCase().includes('codeforces')) await ensureUnsolvedByContestMembers(contest, problem.platform, problem.contestCode || '', problem.problemIndex || ''); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Problem already solved by participant' }); return; } contest.problems[index] = problem; contest.solves = contest.solves.filter((s) => s.problemId !== req.params.problemId); rebuildStandings(contest); persistContest(contest); res.json(sanitizeContestForViewer(contest, req)); });

async function runWithJudge0(params: { sourceCode: string; language: JudgeLanguage; stdin: string; expectedOutput: string; externalOnly?: boolean }) { if (params.externalOnly) return { verdict: 'Pending Codeforces Verification', message: 'This is a Codeforces problem. Submit on Codeforces, then use Sync Codeforces. DivineCode will not mark this accepted from local code.', stdout: '', stderr: '', compile_output: '' }; const judgeUrl = process.env.JUDGE0_URL; if (!params.expectedOutput) return { verdict: 'Pending External Verification', message: 'No official local tests are configured. Standing will not update until an external platform sync or real judge accepts it.', stdout: '', stderr: '', compile_output: '' }; if (!judgeUrl) return { verdict: 'Judge Not Configured', message: 'Judge0 is not configured. Standing was not updated.', stdout: '', stderr: '', compile_output: '' }; const createResponse = await fetch(`${judgeUrl}/submissions?base64_encoded=false&wait=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_code: params.sourceCode, language_id: languageMap[params.language], stdin: params.stdin, expected_output: params.expectedOutput }) }); if (!createResponse.ok) return { verdict: 'Judge Error', message: `Judge0 request failed with status ${createResponse.status}`, stdout: '', stderr: '', compile_output: '' }; const result = (await createResponse.json()) as Judge0Result; const statusDescription = result.status?.description || 'Unknown'; let verdict = statusDescription; if (statusDescription === 'Accepted') verdict = normalizeOutput(result.stdout) === normalizeOutput(params.expectedOutput) ? 'Accepted' : 'Wrong Answer'; return { verdict, message: statusDescription, stdout: result.stdout || '', stderr: result.stderr || '', compile_output: result.compile_output || '', time: result.time || null, memory: result.memory || null }; }
app.post('/api/practice/submit', async (req, res) => { try { const { code, problemId, language = 'cpp' } = req.body; const problem = problems.find((item) => item.id === Number(problemId)); if (!problem) { res.status(404).json({ verdict: 'Rejected', message: 'Problem not found' }); return; } if (!code) { res.status(400).json({ verdict: 'Rejected', message: 'Code is required' }); return; } const result = await runWithJudge0({ sourceCode: code, language, stdin: problem.stdin, expectedOutput: problem.expectedOutput }); const saved = { id: id('practice'), problemId, language, code, verdict: result.verdict, message: result.message, source: 'Practice Judge', createdAt: new Date().toISOString() }; submissions.push(saved); void saveSubmissionDocument(saved).catch(() => undefined); res.json(result); } catch (error) { res.status(500).json({ verdict: 'Server Error', message: error instanceof Error ? error.message : 'Unknown error' }); } });
app.post('/api/submit', async (req, res) => { try { const { code, language, problemId, contestId, memberId, userId, userName } = req.body; if (!code || !language || !problemId) { res.status(400).json({ verdict: 'Rejected', message: 'code, language and problemId are required' }); return; } if (!languageMap[language as JudgeLanguage]) { res.status(400).json({ verdict: 'Rejected', message: 'Unsupported language' }); return; } let stdin = ''; let expectedOutput = ''; let contest: Contest | undefined; let contestMemberId = memberId; let externalOnly = false; if (contestId) { contest = contests.get(String(contestId)); if (!contest) { res.status(404).json({ verdict: 'Rejected', message: 'Contest not found' }); return; } const viewerMember = findViewerMember(contest, String(userId || ''), String(userName || '')); if (!viewerMember) { res.status(403).json({ verdict: 'Rejected', message: 'Only registered contest players can submit.' }); return; } if (memberId && String(memberId) !== viewerMember.id) { res.status(403).json({ verdict: 'Rejected', message: 'You can submit only as your own contest player.' }); return; } contestMemberId = viewerMember.id; const contestProblem = contest.problems.find((item) => item.id === String(problemId)); if (!contestProblem) { res.status(404).json({ verdict: 'Rejected', message: 'Contest problem not found' }); return; } stdin = contestProblem.stdin || ''; expectedOutput = contestProblem.expectedOutput || ''; externalOnly = contestProblem.platform.toLowerCase().includes('codeforces'); } else { const problem = problems.find((item) => item.id === Number(problemId)); if (!problem) { res.status(404).json({ verdict: 'Rejected', message: 'Problem not found' }); return; } stdin = problem.stdin; expectedOutput = problem.expectedOutput; } const result = await runWithJudge0({ sourceCode: code, language: language as JudgeLanguage, stdin, expectedOutput, externalOnly }); if (result.verdict === 'Accepted' && contest && contestMemberId) recordSolve(contest, String(contestMemberId), String(problemId)); const saved = { id: id('sub'), userId, memberId: contestMemberId, contestId, problemId, language, code, verdict: result.verdict, message: result.message, source: externalOnly ? 'Pending Codeforces' : 'DivineCode Judge', stdout: result.stdout, stderr: result.stderr, compileOutput: result.compile_output, time: result.time ? String(result.time) : undefined, memory: typeof result.memory === 'number' ? result.memory : undefined, createdAt: new Date().toISOString() }; submissions.push(saved); void saveSubmissionDocument(saved).catch((error) => console.error('Could not save submission:', error instanceof Error ? error.message : error)); res.json({ ...result, language, problemId, contestId: contest?.id, standings: contest?.standings || null }); } catch (error) { res.status(500).json({ verdict: 'Server Error', message: error instanceof Error ? error.message : 'Unknown error' }); } });

function publicQuestion(room: DuelRoom) { const q = room.questions[room.questionIndex]; return { id: q.id, question: q.question, options: q.options, concept: q.concept, number: room.questionIndex + 1, total: room.questions.length }; }
function emitRoom(room: DuelRoom) { io.to(room.id).emit('duel:state', { roomId: room.id, players: room.players, question: room.finished ? null : publicQuestion(room), finished: room.finished, winner: room.finished ? [...room.players].sort((a, b) => b.score - a.score)[0] : null }); }

// 🛠️ CONNECT ROOM ON SOCK CONNECTION:
io.on('connection', (socket) => {
  socket.on('contest:join', ({ contestId }) => {
    socket.join(`contest:${contestId}`);
    console.log(`[Socket] Registered client ${socket.id} to contest room: contest:${contestId}`);
  });

  socket.on('duel:join', (payload: { name?: string }) => {
    const player: Player = { id: socket.id, name: payload?.name || `Player-${socket.id.slice(0, 4)}`, score: 0 };
    if (waitingPlayers.length === 0) {
      waitingPlayers.push(player);
      socket.emit('duel:waiting', { message: 'Waiting for another player...' });
      return;
    }
    const opponent = waitingPlayers.shift()!;
    const roomId = `room-${Date.now()}`;
    
    // 👉 PHASE 3: Initialize the Duel Room with our Intelligent Question Generator
    const room: DuelRoom = { id: roomId, players: [opponent, player], questionIndex: 0, questions: generateIntelligentMcqs(), finished: false };
    rooms.set(roomId, room);
    
    socket.join(roomId);
    io.sockets.sockets.get(opponent.id)?.join(roomId);
    io.to(roomId).emit('duel:start', { roomId, players: room.players });
    emitRoom(room);
  });
  
  socket.on('duel:answer', (payload: { roomId: string; questionId: number; answerIndex: number }) => {
    const room = rooms.get(payload.roomId);
    if (!room || room.finished) return;
    const current = room.questions[room.questionIndex];
    const player = room.players.find((item) => item.id === socket.id);
    if (!player || current.id !== payload.questionId) return;
    const correct = current.correctIndex === payload.answerIndex;
    player.score += correct ? 10 : -3;
    io.to(room.id).emit('duel:feedback', { playerId: socket.id, playerName: player.name, correct, correctIndex: current.correctIndex, concept: current.concept });
    room.questionIndex += 1;
    if (room.questionIndex >= room.questions.length) room.finished = true;
    setTimeout(() => emitRoom(room), 700);
  });
  
  socket.on('disconnect', () => {
    const waitingIndex = waitingPlayers.findIndex((p) => p.id === socket.id);
    if (waitingIndex >= 0) waitingPlayers.splice(waitingIndex, 1);
  });
});

startQueueWorkers(io);

void connectDB().then(() => restoreFromMongo()).catch((error) => console.error('Initial MongoDB connection failed:', error instanceof Error ? error.message : error));
const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => console.log(`DivineCode API and duel socket server running on port ${PORT}`));