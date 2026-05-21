import { CSSProperties, useEffect, useMemo, useState } from 'react';
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
  const [mounted, setMounted] = useState(false); // 👉 Mount state to prevent hydration errors
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
    const res = await fetch(`${API_BASE_URL}/api/problems/lookup?platform=${encodeURIComponent(p.platform)}&code=${encodeURIComponent(p.code)}`);
    const data = await res.json();
    if (!res.ok) { setLookupState({ ...lookupState, [index]: data.error || 'Lookup failed' }); return; }
    const next = [...problems];
    next[index] = { ...next[index], contestCode: data.contestCode || '', problemIndex: data.problemIndex || '', title: data.title, url: data.url, rating: data.rating, difficulty: data.difficulty, tags: (data.tags || []).join(',') || next[index].tags };
    setProblems(next);
    setLookupState({ ...lookupState, [index]: `Loaded ${data.title}` });
  }

  async function createContest() {
    if (!ownerName) return alert('Sign in first.');
    if (!session?.user?.email) return alert('Your signed-in account needs an email before creating a V2 contest.');
    
    const ownerHandle = cleanHandle(ownerCfHandle);
    const hasCfProblems = problems.some((p) => p.platform.toLowerCase().includes('codeforces'));
    
    const cleanMember = (member: MemberRow, team: string) => ({
      name: member.name.trim() || cleanHandle(member.codeforcesHandle) || member.email.trim(),
      email: member.email.trim(), // Optional now!
      codeforcesHandle: cleanHandle(member.codeforcesHandle) || member.name.trim(),
      teamName: team
    });
    
    const soloMembers = soloPlayer.name.trim() || soloPlayer.email.trim() || soloPlayer.codeforcesHandle.trim() ? [cleanMember(soloPlayer, 'Solo')] : [];
    const teamMembers = teams.flatMap((team) => team.players.filter((member) => member.name.trim() || member.email.trim() || member.codeforcesHandle.trim()).map((member) => cleanMember(member, team.name.trim() || 'Group')));
    const cleanedMembers = mode === 'single' ? soloMembers : teamMembers;
    
    if (cleanedMembers.length === 0) return alert('Add at least one player. The owner manages the contest and is not added as a player automatically.');
    
    // 👉 REMOVED THE STRICT EMAIL VALIDATION BLOCK HERE

    const invalid = hasCfProblems ? cleanedMembers.find((member) => !member.codeforcesHandle || member.codeforcesHandle.includes(' ')) : null;
    if (invalid) return alert(`Invalid Codeforces handle for ${invalid.name}. Use the exact CF handle, without spaces.`);
    
    const contestProblems = problems.map((p) => ({ title: p.title, platform: p.platform, code: p.code || `${p.contestCode}${p.problemIndex}`, contestCode: p.contestCode, problemIndex: p.problemIndex, url: p.url, rating: p.rating, difficulty: p.difficulty, tags: p.tags })).filter((p) => p.url);
    
    const res = await fetch(`${API_V2_BASE_URL}/contests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description: `${mode === 'single' ? 'Solo' : 'Team'} mashup created by ${ownerName}`, durationMinutes: duration, ownerName, ownerEmail: session.user.email, ownerHandle, members: cleanedMembers, problems: contestProblems })
    });
    
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Could not create contest');
    window.location.href = `/contests/${data.id}`;
  }

  if (!mounted) return null; // Prevents "Server: 800 Client: 1500" Hydration errors
  if (status === 'loading') return <main style={page}><h1>Checking account...</h1></main>;
  if (!session) return <main style={page}><section style={gate}><h1>Sign in required</h1><p style={{ color: '#a8b3c7' }}>Create mashups from your account.</p><a href="/signin" style={primaryLink}>Sign in with Google</a></section></main>;

  return (
    <main style={page}>
      <section style={{ maxWidth: 1180, margin: '0 auto' }}>
        <a href="/" style={topLink}>DivineCode Home</a>
        <div style={hero}>
          <div>
            <p style={eyebrow}>Team mashup builder</p>
            <h1 style={{ fontSize: 52, margin: 0 }}>Create controlled contests.</h1>
            <p style={{ color: '#a8b3c7' }}>The owner manages the room. Players are added separately so standings never count the creator by accident.</p>
          </div>
          <div style={ownerCard}>
            <span>Creator/admin</span>
            <strong>{ownerName}</strong>
            <small style={{ color: '#94a3b8' }}>Not a player unless added below.</small>
          </div>
        </div>
        
        <div style={shell}>
          <div style={modeGrid}>
            <button onClick={() => setMode('single')} style={mode === 'single' ? activeMode : modeBtn}><strong>Solo Contest</strong><span>One selected player participates.</span></button>
            <button onClick={() => setMode('group')} style={mode === 'group' ? activeMode : modeBtn}><strong>Team Mashup</strong><span>Group vs group with player handles.</span></button>
          </div>
          
          <label>Contest Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
          
          <label>Duration in minutes</label>
          <input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={{ ...inputStyle, maxWidth: 180 }} />
          
          <h2>Players <span style={{ color: '#67e8f9' }}>({cleanMemberCount})</span></h2>
          <div style={lockedOwner}>
            <strong>Owner display:</strong> {ownerName}
            <input value={ownerCfHandle} onChange={(e) => setOwnerCfHandle(e.target.value)} placeholder="Owner Codeforces handle, optional" style={{ ...smallInput, marginTop: 10 }} />
          </div>
          
          {mode === 'single' && (
            <section style={teamCard}>
              <h2>Solo player</h2>
              <div style={memberRow}>
                <input value={soloPlayer.name} onChange={(e) => setSoloPlayer({ ...soloPlayer, name: e.target.value })} placeholder="Player name" style={smallInput} />
                <input value={soloPlayer.email} onChange={(e) => setSoloPlayer({ ...soloPlayer, email: e.target.value })} placeholder="Player account email, optional" style={smallInput} />
                <input value={soloPlayer.codeforcesHandle} onChange={(e) => setSoloPlayer({ ...soloPlayer, codeforcesHandle: e.target.value })} placeholder="Exact Codeforces handle" style={smallInput} />
              </div>
            </section>
          )}
          
          {mode === 'group' && (
            <>
              <h2>Teams / Groups</h2>
              {teams.map((team, ti) => (
                <section key={ti} style={teamCard}>
                  <input value={team.name} onChange={(e) => updateTeam(ti, e.target.value)} placeholder="Group name" style={inputStyle} />
                  {team.players.map((member, pi) => (
                    <div key={pi} style={memberRow}>
                      <input value={member.name} onChange={(e) => updatePlayer(ti, pi, 'name', e.target.value)} placeholder="Player name" style={smallInput} />
                      <input value={member.email} onChange={(e) => updatePlayer(ti, pi, 'email', e.target.value)} placeholder="Player account email, optional" style={smallInput} />
                      <input value={member.codeforcesHandle} onChange={(e) => updatePlayer(ti, pi, 'codeforcesHandle', e.target.value)} placeholder="Exact Codeforces handle" style={smallInput} />
                    </div>
                  ))}
                  <button onClick={() => addPlayer(ti)} style={ghostBtn}>+ Add player to {team.name}</button>
                </section>
              ))}
              <button onClick={addTeam} style={ghostBtn}>+ Add group/team</button>
            </>
          )}
          
          <h2 style={{ marginTop: 28 }}>Problems</h2>
          <div style={{ display: 'grid', gap: 14 }}>
            {problems.map((p, i) => (
              <div key={i} style={problemCard}>
                <strong style={{ color: '#67e8f9' }}>#{String.fromCharCode(65 + i)}</strong>
                <select value={p.platform} onChange={(e) => updateProblem(i, 'platform', e.target.value)} style={smallInput}>
                  <option>Codeforces</option><option>LeetCode</option><option>AtCoder</option><option>CodeChef</option>
                </select>
                <input value={p.code} onChange={(e) => updateProblem(i, 'code', e.target.value)} placeholder="1805A / two-sum" style={smallInput} />
                <button onClick={() => lookupProblem(i)} style={ghostBtn}>Lookup</button>
                <input value={p.title} onChange={(e) => updateProblem(i, 'title', e.target.value)} placeholder="Title" style={smallInput} />
                <input value={p.rating || ''} readOnly placeholder="Rating" style={smallInput} />
                <input value={p.url} onChange={(e) => updateProblem(i, 'url', e.target.value)} placeholder="URL" style={{ ...smallInput, gridColumn: '2 / -1' }} />
                <small style={{ color: '#94a3b8', gridColumn: '2 / -1' }}>{lookupState[i] || 'Lookup fills title, URL, rating, contest/index. Codeforces additions are rejected if any player already solved them.'}</small>
              </div>
            ))}
          </div>
          
          <button onClick={addProblem} style={{ ...ghostBtn, marginTop: 14 }}>+ Add problem</button>
          
          <div style={{ marginTop: 28 }}>
            <button onClick={createContest} style={primaryBtn}>Create {mode === 'single' ? 'Solo Contest' : 'Team Mashup'}</button>
          </div>
        </div>
      </section>
    </main>
  );
}

const page: CSSProperties = { minHeight: '100vh', padding: 28, fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.35), transparent 36rem), radial-gradient(circle at bottom right, rgba(34,211,238,.18), transparent 30rem), #070a16' };
const gate: CSSProperties = { maxWidth: 620, margin: '15vh auto', padding: 34, borderRadius: 28, border: '1px solid rgba(148,163,184,.22)', background: 'rgba(15,23,42,.82)', boxShadow: '0 24px 70px rgba(0,0,0,.3)' };
const topLink: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 900 };
const primaryLink: CSSProperties = { display: 'inline-block', padding: '12px 17px', borderRadius: 999, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', textDecoration: 'none', fontWeight: 900 };
const hero: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 18, flexWrap: 'wrap', margin: '24px 0' };
const eyebrow: CSSProperties = { color: '#67e8f9', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase' };
const ownerCard: CSSProperties = { padding: 18, borderRadius: 22, background: 'rgba(15,23,42,.82)', border: '1px solid rgba(148,163,184,.22)', display: 'grid', gap: 6 };
const shell: CSSProperties = { padding: 28, borderRadius: 30, border: '1px solid rgba(148,163,184,.22)', background: 'rgba(15,23,42,.82)', boxShadow: '0 28px 90px rgba(0,0,0,.34)' };
const modeGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14, marginBottom: 22 };
const modeBtn: CSSProperties = { padding: 18, borderRadius: 22, border: '1px solid rgba(148,163,184,.24)', background: 'rgba(2,6,23,.45)', color: '#e2e8f0', textAlign: 'left', display: 'grid', gap: 8, cursor: 'pointer' };
const activeMode: CSSProperties = { ...modeBtn, border: '1px solid rgba(34,211,238,.75)', background: 'rgba(34,211,238,.12)' };
const lockedOwner: CSSProperties = { padding: 14, borderRadius: 16, background: 'rgba(34,211,238,.1)', border: '1px solid rgba(34,211,238,.25)', marginBottom: 14 };
const inputStyle: CSSProperties = { width: '100%', padding: 13, margin: '8px 0 16px', border: '1px solid rgba(148,163,184,.25)', borderRadius: 14, background: 'rgba(2,6,23,.55)', color: '#eef2ff', outline: 'none' };
const smallInput: CSSProperties = { width: '100%', padding: 11, border: '1px solid rgba(148,163,184,.25)', borderRadius: 12, background: 'rgba(15,23,42,.8)', color: '#eef2ff', outline: 'none' };
const memberRow: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10, marginBottom: 10 };
const teamCard: CSSProperties = { padding: 16, borderRadius: 20, background: 'rgba(2,6,23,.45)', border: '1px solid rgba(148,163,184,.18)', marginBottom: 14 };
const problemCard: CSSProperties = { padding: 16, borderRadius: 20, background: 'rgba(2,6,23,.5)', border: '1px solid rgba(148,163,184,.16)', display: 'grid', gridTemplateColumns: '60px 140px minmax(150px,1fr) 110px minmax(150px,1fr) 110px', gap: 10, alignItems: 'center' };
const ghostBtn: CSSProperties = { padding: '11px 15px', borderRadius: 999, border: '1px solid rgba(148,163,184,.28)', background: 'rgba(15,23,42,.72)', color: '#dbeafe', cursor: 'pointer' };
const primaryBtn: CSSProperties = { padding: '14px 20px', borderRadius: 999, border: 0, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontWeight: 900, cursor: 'pointer' };