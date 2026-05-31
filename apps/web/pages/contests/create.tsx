import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';

export async function getServerSideProps() { return { props: {} }; }

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

type Mode = 'single' | 'group';
type MemberRow = { name: string; email: string; codeforcesHandle: string };
type TeamRow = { name: string; players: MemberRow[] };
type ProblemRow = { platform: string; code: string; contestCode: string; problemIndex: string; title: string; url: string; tags: string; rating?: number; difficulty?: string };

const emptyMember = (): MemberRow => ({ name: '', email: '', codeforcesHandle: '' });
function cleanHandle(value: string) { return value.trim().replace(/^@/, ''); }

export default function CreateContestPage() {
  const { data: session, status } = useSession();
  const [mounted, setMounted] = useState(false);
  
  // 👉 NEW: Loading state for the full-screen animation
  const [isCreating, setIsCreating] = useState(false);

  const ownerName = session?.user?.name || session?.user?.email || '';
  const [ownerCfHandle, setOwnerCfHandle] = useState('');
  const [mode, setMode] = useState<Mode>('group');
  const [title, setTitle] = useState('DivineCode Team Mashup Round');
  const [duration, setDuration] = useState(120);
  const [soloPlayer, setSoloPlayer] = useState<MemberRow>(emptyMember());
  const [teams, setTeams] = useState<TeamRow[]>([
    { name: 'Group A', players: [emptyMember(), emptyMember(), emptyMember()] },
    { name: 'Group B', players: [emptyMember(), emptyMember(), emptyMember()] }
  ]);
  const [problems, setProblems] = useState<ProblemRow[]>([{ platform: 'Codeforces', code: '', contestCode: '', problemIndex: '', title: '', url: '', tags: 'implementation' }]);
  const [lookupState, setLookupState] = useState<Record<number, string>>({});

  useEffect(() => { setMounted(true); }, []);

  const cleanMemberCount = useMemo(() => {
    if (mode === 'single') return soloPlayer.name.trim() || soloPlayer.email.trim() || soloPlayer.codeforcesHandle.trim() ? 1 : 0;
    return teams.flatMap((team) => team.players).filter((member) => member.name.trim() || member.email.trim() || member.codeforcesHandle.trim()).length;
  }, [mode, soloPlayer, teams]);

  function addTeam() { setTeams([...teams, { name: `Group ${String.fromCharCode(65 + teams.length)}`, players: [emptyMember(), emptyMember(), emptyMember()] }]); }
  function updateTeam(index: number, name: string) { const next = [...teams]; next[index] = { ...next[index], name }; setTeams(next); }
  function addPlayer(teamIndex: number) { const next = [...teams]; next[teamIndex].players.push(emptyMember()); setTeams(next); }
  function updatePlayer(teamIndex: number, playerIndex: number, field: keyof MemberRow, value: string) { const next = [...teams]; next[teamIndex].players[playerIndex] = { ...next[teamIndex].players[playerIndex], [field]: value }; setTeams(next); }
  function addProblem() { setProblems([...problems, { platform: 'Codeforces', code: '', contestCode: '', problemIndex: '', title: '', url: '', tags: 'implementation' }]); }
  function updateProblem(index: number, field: keyof ProblemRow, value: string) { const next = [...problems]; next[index] = { ...next[index], [field]: value }; setProblems(next); }

  async function lookupProblem(index: number) {
    const p = problems[index];
    if (!p.code.trim()) return alert('Enter problem code like 1805A or two-sum');
    setLookupState({ ...lookupState, [index]: 'Loading...' });

    try {
      const res = await fetch(`${API_BASE_URL}/api/problems/lookup?platform=${encodeURIComponent(p.platform)}&code=${encodeURIComponent(p.code)}`);
      if (!res.ok) { 
        const data = await res.json().catch(() => ({}));
        setLookupState({ ...lookupState, [index]: data.error || 'Lookup failed (Server error)' }); 
        return; 
      }
      
      const data = await res.json();
      const next = [...problems];
      next[index] = { ...next[index], contestCode: data.contestCode || '', problemIndex: data.problemIndex || '', title: data.title, url: data.url, rating: data.rating, difficulty: data.difficulty, tags: (data.tags || []).join(',') || next[index].tags };
      setProblems(next);
      setLookupState({ ...lookupState, [index]: `Loaded ${data.title}` });
    } catch (error) {
      console.error(error);
      setLookupState({ ...lookupState, [index]: 'Network Error: Backend API unreachable' });
    }
  }

  async function createContest() {
    if (!ownerName) return alert('Sign in first.');
    if (!session?.user?.email) return alert('Your signed-in account needs an email before creating a V2 contest.');
    
    const ownerHandle = cleanHandle(ownerCfHandle);
    const hasCfProblems = problems.some((p) => p.platform.toLowerCase().includes('codeforces'));
    
    const cleanMember = (member: MemberRow, team: string) => ({
      name: member.name.trim() || cleanHandle(member.codeforcesHandle) || member.email.trim(),
      email: member.email.trim(),
      codeforcesHandle: cleanHandle(member.codeforcesHandle) || member.name.trim(),
      teamName: team
    });
    
    const soloMembers = soloPlayer.name.trim() || soloPlayer.email.trim() || soloPlayer.codeforcesHandle.trim() ? [cleanMember(soloPlayer, 'Solo')] : [];
    const teamMembers = teams.flatMap((team) => team.players.filter((member) => member.name.trim() || member.email.trim() || member.codeforcesHandle.trim()).map((member) => cleanMember(member, team.name.trim() || 'Group')));
    const cleanedMembers = mode === 'single' ? soloMembers : teamMembers;
    
    if (cleanedMembers.length === 0) return alert('Add at least one player. The owner manages the contest and is not added as a player automatically.');
    
    const invalid = hasCfProblems ? cleanedMembers.find((member) => !member.codeforcesHandle || member.codeforcesHandle.includes(' ')) : null;
    if (invalid) return alert(`Invalid Codeforces handle for ${invalid.name}. Use the exact CF handle, without spaces.`);
    
    const contestProblems = problems.map((p) => ({ title: p.title, platform: p.platform, code: p.code || `${p.contestCode}${p.problemIndex}`, contestCode: p.contestCode, problemIndex: p.problemIndex, url: p.url, rating: p.rating, difficulty: p.difficulty, tags: p.tags })).filter((p) => p.url);
    
    // 👉 TRIGGER LOADING OVERLAY
    setIsCreating(true);

    try {
      const res = await fetch(`${API_V2_BASE_URL}/contests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description: `${mode === 'single' ? 'Solo' : 'Team'} mashup created by ${ownerName}`, durationMinutes: duration, ownerName, ownerEmail: session.user.email, ownerHandle, members: cleanedMembers, problems: contestProblems })
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Could not create contest');
        setIsCreating(false); // Hide overlay on error
        return;
      }
      
      const data = await res.json();
      window.location.href = `/contests/${data.id}`;
    } catch (error) {
      console.error(error);
      alert('Network Error: Could not connect to the backend API.');
      setIsCreating(false); // Hide overlay on error
    }
  }

  if (!mounted) return null;
  if (status === 'loading') return <main className="min-h-screen flex items-center justify-center bg-slate-950 text-white"><h1 className="text-2xl animate-pulse">Checking account...</h1></main>;
  if (!session) return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 text-indigo-50 p-4">
      <section className="max-w-md w-full p-8 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl text-center">
        <h1 className="text-3xl font-bold mb-2">Sign in required</h1>
        <p className="text-slate-400 mb-6">Create mashups from your account.</p>
        <a href="/signin" className="inline-block px-6 py-3 rounded-full bg-gradient-to-r from-indigo-300 to-cyan-400 text-slate-950 font-bold hover:scale-105 transition-transform">Sign in with Google</a>
      </section>
    </main>
  );

  return (
    <main className="min-h-screen p-4 md:p-8 font-sans text-indigo-50 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,.15),transparent_36rem),radial-gradient(circle_at_bottom_right,rgba(34,211,238,.1),transparent_30rem)] bg-slate-950">
      
      {/* 👉 THE LOADING OVERLAY */}
      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="flex flex-col items-center p-8 bg-slate-900 border border-cyan-900/50 rounded-3xl shadow-2xl animate-pulse">
            <div className="w-16 h-16 mb-6 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
            <h2 className="text-2xl font-bold text-white mb-2">Forging Mashup...</h2>
            <p className="text-cyan-200">Syncing Codeforces data & validating handles</p>
          </div>
        </div>
      )}

      <section className="max-w-6xl mx-auto">
        <a href="/" className="text-cyan-400 font-black hover:text-cyan-300 transition-colors">← DivineCode Home</a>
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 my-8">
          <div>
            <p className="text-cyan-400 font-black tracking-widest uppercase text-sm mb-2">Team mashup builder</p>
            <h1 className="text-4xl md:text-5xl font-black m-0 leading-tight">Create controlled contests.</h1>
            <p className="text-slate-400 mt-2 max-w-xl">The owner manages the room. Players are added separately so standings never count the creator by accident.</p>
          </div>
          <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-700/50 flex flex-col gap-1 w-full md:w-auto">
            <span className="text-sm text-slate-400">Creator/admin</span>
            <strong className="text-xl">{ownerName}</strong>
            <small className="text-slate-500">Not a player unless added below.</small>
          </div>
        </div>
        
        <div className="p-4 md:p-8 rounded-3xl border border-slate-700/50 bg-slate-900/80 shadow-2xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <button onClick={() => setMode('single')} className={`p-5 rounded-2xl border text-left transition-all ${mode === 'single' ? 'border-cyan-400 bg-cyan-950/30' : 'border-slate-700 bg-slate-950/40 hover:bg-slate-800'}`}>
              <strong className="block text-lg mb-1">Solo Contest</strong>
              <span className="text-sm text-slate-400">One selected player participates.</span>
            </button>
            <button onClick={() => setMode('group')} className={`p-5 rounded-2xl border text-left transition-all ${mode === 'group' ? 'border-cyan-400 bg-cyan-950/30' : 'border-slate-700 bg-slate-950/40 hover:bg-slate-800'}`}>
              <strong className="block text-lg mb-1">Team Mashup</strong>
              <span className="text-sm text-slate-400">Group vs group with player handles.</span>
            </button>
          </div>
          
          <label className="block text-sm font-bold mb-2">Contest Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full p-3 mb-6 rounded-xl border border-slate-700 bg-slate-950/50 text-indigo-50 outline-none focus:border-cyan-400 transition-colors" />
          
          <label className="block text-sm font-bold mb-2">Duration in minutes</label>
          <input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-full md:w-48 p-3 mb-8 rounded-xl border border-slate-700 bg-slate-950/50 text-indigo-50 outline-none focus:border-cyan-400 transition-colors" />
          
          <h2 className="text-2xl font-bold mb-4">Players <span className="text-cyan-400">({cleanMemberCount})</span></h2>
          <div className="p-4 rounded-xl bg-cyan-950/30 border border-cyan-900/50 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <strong className="text-cyan-400">Owner display:</strong> {ownerName}
            </div>
            <input value={ownerCfHandle} onChange={(e) => setOwnerCfHandle(e.target.value)} placeholder="Owner Codeforces handle (optional)" className="w-full md:w-64 p-2 rounded-lg border border-slate-700 bg-slate-900 text-sm outline-none focus:border-cyan-400" />
          </div>
          
          {mode === 'single' && (
            <section className="p-4 md:p-6 rounded-2xl bg-slate-950/40 border border-slate-800 mb-6">
              <h2 className="text-lg font-bold mb-4">Solo player</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input value={soloPlayer.name} onChange={(e) => setSoloPlayer({ ...soloPlayer, name: e.target.value })} placeholder="Player name" className="w-full p-3 rounded-xl border border-slate-700 bg-slate-900 text-sm outline-none focus:border-cyan-400" />
                <input value={soloPlayer.email} onChange={(e) => setSoloPlayer({ ...soloPlayer, email: e.target.value })} placeholder="Account email (optional)" className="w-full p-3 rounded-xl border border-slate-700 bg-slate-900 text-sm outline-none focus:border-cyan-400" />
                <input value={soloPlayer.codeforcesHandle} onChange={(e) => setSoloPlayer({ ...soloPlayer, codeforcesHandle: e.target.value })} placeholder="Exact Codeforces handle" className="w-full p-3 rounded-xl border border-slate-700 bg-slate-900 text-sm outline-none focus:border-cyan-400" />
              </div>
            </section>
          )}
          
          {mode === 'group' && (
            <>
              <h2 className="text-lg font-bold mb-4">Teams / Groups</h2>
              {teams.map((team, ti) => (
                <section key={ti} className="p-4 md:p-6 rounded-2xl bg-slate-950/40 border border-slate-800 mb-4">
                  <input value={team.name} onChange={(e) => updateTeam(ti, e.target.value)} placeholder="Group name" className="w-full p-3 mb-4 rounded-xl border border-slate-700 bg-slate-900 font-bold outline-none focus:border-cyan-400" />
                  {team.players.map((member, pi) => (
                    <div key={pi} className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                      <input value={member.name} onChange={(e) => updatePlayer(ti, pi, 'name', e.target.value)} placeholder="Player name" className="w-full p-3 rounded-xl border border-slate-700 bg-slate-900 text-sm outline-none focus:border-cyan-400" />
                      <input value={member.email} onChange={(e) => updatePlayer(ti, pi, 'email', e.target.value)} placeholder="Account email (optional)" className="w-full p-3 rounded-xl border border-slate-700 bg-slate-900 text-sm outline-none focus:border-cyan-400" />
                      <input value={member.codeforcesHandle} onChange={(e) => updatePlayer(ti, pi, 'codeforcesHandle', e.target.value)} placeholder="Exact Codeforces handle" className="w-full p-3 rounded-xl border border-slate-700 bg-slate-900 text-sm outline-none focus:border-cyan-400" />
                    </div>
                  ))}
                  <button onClick={() => addPlayer(ti)} className="px-4 py-2 mt-2 rounded-full border border-slate-700 bg-slate-800 hover:bg-slate-700 text-sm text-cyan-100 transition-colors">+ Add player to {team.name}</button>
                </section>
              ))}
              <button onClick={addTeam} className="px-4 py-2 mt-2 rounded-full border border-slate-700 bg-slate-800 hover:bg-slate-700 text-sm text-cyan-100 transition-colors">+ Add group/team</button>
            </>
          )}
          
          <h2 className="text-2xl font-bold mt-10 mb-4">Problems</h2>
          <div className="grid gap-4">
            {problems.map((p, i) => (
              <div key={i} className="p-4 md:p-5 rounded-2xl bg-slate-950/50 border border-slate-700 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                <div className="md:col-span-1 flex justify-between md:block">
                  <strong className="text-cyan-400">#{String.fromCharCode(65 + i)}</strong>
                  <span className="md:hidden text-slate-500 text-sm">Problem</span>
                </div>
                <select value={p.platform} onChange={(e) => updateProblem(i, 'platform', e.target.value)} className="md:col-span-2 w-full p-2.5 rounded-lg border border-slate-700 bg-slate-900 text-sm outline-none focus:border-cyan-400">
                  <option>Codeforces</option><option>LeetCode</option><option>AtCoder</option><option>CodeChef</option>
                </select>
                <input value={p.code} onChange={(e) => updateProblem(i, 'code', e.target.value)} placeholder="Code (e.g. 1805A)" className="md:col-span-2 w-full p-2.5 rounded-lg border border-slate-700 bg-slate-900 text-sm outline-none focus:border-cyan-400" />
                <button onClick={() => lookupProblem(i)} className="md:col-span-2 w-full p-2.5 rounded-lg border border-cyan-800 bg-cyan-900/50 hover:bg-cyan-800 text-sm text-cyan-100 transition-colors">Lookup</button>
                <input value={p.title} onChange={(e) => updateProblem(i, 'title', e.target.value)} placeholder="Title" className="md:col-span-3 w-full p-2.5 rounded-lg border border-slate-700 bg-slate-900 text-sm outline-none focus:border-cyan-400" />
                <input value={p.rating || ''} readOnly placeholder="Rating" className="md:col-span-2 w-full p-2.5 rounded-lg border border-slate-700 bg-slate-900 text-sm outline-none" />
                <input value={p.url} onChange={(e) => updateProblem(i, 'url', e.target.value)} placeholder="URL" className="md:col-span-12 w-full p-2.5 rounded-lg border border-slate-700 bg-slate-900 text-sm outline-none focus:border-cyan-400" />
                <small className="md:col-span-12 text-slate-500 mt-1">{lookupState[i] || 'Lookup fills title, URL, rating, contest/index. Codeforces additions are rejected if any player already solved them.'}</small>
              </div>
            ))}
          </div>
          
          <button onClick={addProblem} className="px-4 py-2 mt-4 rounded-full border border-slate-700 bg-slate-800 hover:bg-slate-700 text-sm text-cyan-100 transition-colors">+ Add problem</button>
          
          <div className="mt-10 border-t border-slate-800 pt-8 flex justify-end">
            <button onClick={createContest} disabled={isCreating} className="w-full md:w-auto px-8 py-4 rounded-full bg-gradient-to-r from-indigo-300 to-cyan-400 text-slate-950 font-black text-lg hover:scale-105 transition-transform disabled:opacity-50 disabled:scale-100 shadow-lg shadow-cyan-900/20">
              Create {mode === 'single' ? 'Solo Contest' : 'Team Mashup'}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}