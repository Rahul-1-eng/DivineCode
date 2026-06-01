import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';

export async function getServerSideProps() { return { props: {} }; }

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

type Mode = 'single' | 'group';
type MemberRow = { username: string }; 
type TeamRow = { name: string; players: MemberRow[] };
type ProblemRow = { platform: string; code: string; contestCode: string; problemIndex: string; title: string; url: string; tags: string; rating?: number; difficulty?: string; interviewQuestionId?: string };

const emptyMember = (): MemberRow => ({ username: '' });

export default function CreateContestPage() {
  const { data: session, status } = useSession();
  const [mounted, setMounted] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const ownerName = session?.user?.name || session?.user?.email || '';
  const [mode, setMode] = useState<Mode>('group');
  const [title, setTitle] = useState('DivineCode Team Mashup Round');
  
  // 👉 ADDED: New state variables for advanced features
  const [duration, setDuration] = useState(120);
  const [startTimeStr, setStartTimeStr] = useState(''); 
  const [freezeMinutes, setFreezeMinutes] = useState(0);
  const [allowTeamSubmissionView, setAllowTeamSubmissionView] = useState(true);
  const [hideProblemMetaDuringContest, setHideProblemMetaDuringContest] = useState(true);
  
  const [soloPlayer, setSoloPlayer] = useState<MemberRow>(emptyMember());
  const [teams, setTeams] = useState<TeamRow[]>([
    { name: 'Group A', players: [emptyMember(), emptyMember(), emptyMember()] },
    { name: 'Group B', players: [emptyMember(), emptyMember(), emptyMember()] }
  ]);
  
  const [problems, setProblems] = useState<ProblemRow[]>([{ platform: 'Codeforces', code: '', contestCode: '', problemIndex: '', title: '', url: '', tags: 'implementation' }]);
  const [lookupState, setLookupState] = useState<Record<number, string>>({});
  const [availableMcqs, setAvailableMcqs] = useState<any[]>([]);

  useEffect(() => { 
    setMounted(true); 
    fetch(`${API_V2_BASE_URL}/interview/questions`).then(r => r.json()).then(data => {
        if (Array.isArray(data)) setAvailableMcqs(data);
    }).catch(console.error);
  }, []);

  const cleanMemberCount = useMemo(() => {
    if (mode === 'single') return soloPlayer.username.trim() ? 1 : 0;
    return teams.flatMap((team) => team.players).filter((member) => member.username.trim()).length;
  }, [mode, soloPlayer, teams]);

  function addTeam() { setTeams([...teams, { name: `Group ${String.fromCharCode(65 + teams.length)}`, players: [emptyMember(), emptyMember(), emptyMember()] }]); }
  function updateTeam(index: number, name: string) { const next = [...teams]; next[index] = { ...next[index], name }; setTeams(next); }
  function addPlayer(teamIndex: number) { const next = [...teams]; next[teamIndex].players.push(emptyMember()); setTeams(next); }
  function updatePlayer(teamIndex: number, playerIndex: number, value: string) { const next = [...teams]; next[teamIndex].players[playerIndex] = { username: value }; setTeams(next); }
  function addProblem() { setProblems([...problems, { platform: 'Codeforces', code: '', contestCode: '', problemIndex: '', title: '', url: '', tags: 'implementation' }]); }
  function updateProblem(index: number, field: keyof ProblemRow, value: string) { const next = [...problems]; next[index] = { ...next[index], [field]: value }; setProblems(next); }

  async function lookupProblem(index: number) {
    const p = problems[index];
    if (p.platform === 'Interview MCQ') return; 
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
      setLookupState({ ...lookupState, [index]: 'Network Error' });
    }
  }

  async function createContest() {
    if (!session?.user?.email) return alert('Sign in first.');
    
    const cleanMember = (username: string, team: string) => ({ username: username.trim(), teamName: team });
    const soloMembers = soloPlayer.username.trim() ? [cleanMember(soloPlayer.username, 'Solo')] : [];
    const teamMembers = teams.flatMap((team) => team.players.filter((m) => m.username.trim()).map((m) => cleanMember(m.username, team.name.trim() || 'Group')));
    const cleanedMembers = mode === 'single' ? soloMembers : teamMembers;
    
    if (cleanedMembers.length === 0) return alert('Add at least one player.');
    
    const contestProblems = problems.map((p) => ({ 
      title: p.title, platform: p.platform, code: p.code || `${p.contestCode}${p.problemIndex}`, contestCode: p.contestCode, problemIndex: p.problemIndex, url: p.url, rating: p.rating, difficulty: p.difficulty, tags: p.tags, interviewQuestionId: p.interviewQuestionId 
    })).filter((p) => p.url);
    
    setIsCreating(true);

    try {
      const res = await fetch(`${API_V2_BASE_URL}/contests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-email': session.user.email },
        body: JSON.stringify({ 
          title, 
          description: `${mode === 'single' ? 'Solo' : 'Team'} mashup`, 
          startTime: startTimeStr ? new Date(startTimeStr).toISOString() : undefined, // 👉 ADDED: Sends scheduled start time
          durationMinutes: duration,
          freezeMinutes: freezeMinutes > 0 ? freezeMinutes : undefined, // 👉 ADDED: Sends freeze time requirement
          allowTeamSubmissionView, // 👉 ADDED: Respects group permissions checkbox
          hideProblemMetaDuringContest,
          ownerEmail: session.user.email, 
          members: cleanedMembers,
          problems: contestProblems 
        })
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Could not create contest');
        setIsCreating(false);
        return;
      }
      const data = await res.json();
      window.location.href = `/contests/${data.id}`;
    } catch (error) {
      alert('Network Error');
      setIsCreating(false);
    }
  }

  if (!mounted) return null;
  if (status === 'loading') return <main style={page}><div style={{textAlign:'center', marginTop:'20vh'}}><h1 style={{color: '#67e8f9'}}>Checking account...</h1></div></main>;
  if (!session) return <main style={page}><section style={gate}><h1>Sign in required</h1><a href="/signin" style={primaryLink}>Sign in with Google</a></section></main>;

  return (
    <main style={page}>
      {isCreating && (
        <div style={overlay}>
          <div style={overlayModal}>
            <h2 style={{ color: '#fff', margin: '0 0 10px 0' }}>Forging Mashup...</h2>
            <p style={{ color: '#67e8f9', margin: 0, fontSize: 14 }}>Mapping DivineCode Usernames to Database & Codeforces</p>
          </div>
        </div>
      )}

      <section style={{ maxWidth: 1180, margin: '0 auto' }}>
        <a href="/" style={topLink}>← DivineCode Home</a>
        
        <div style={hero}>
          <div style={{ flex: '1 1 400px' }}>
            <p style={eyebrow}>Team mashup builder</p>
            <h1 style={{ fontSize: 'clamp(32px, 5vw, 52px)', margin: '10px 0' }}>Create controlled contests.</h1>
            <p style={{ color: '#a8b3c7' }}>Use DivineCode Usernames to add players. The system automatically fetches their linked Codeforces handles.</p>
          </div>
        </div>
        
        <div style={shell}>
          <div style={modeGrid}>
            <button onClick={() => setMode('single')} style={mode === 'single' ? activeMode : modeBtn}><strong>Solo Contest</strong></button>
            <button onClick={() => setMode('group')} style={mode === 'group' ? activeMode : modeBtn}><strong>Team Mashup</strong></button>
          </div>
          
          <label style={{ fontWeight: 'bold' }}>Contest Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
          
          <div style={memberRow}>
            <div style={{ flex: 1 }}>
              <label style={{ fontWeight: 'bold' }}>Duration in minutes</label>
              <input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={inputStyle} />
            </div>
            {/* 👉 ADDED: Freeze Minutes Input */}
            <div style={{ flex: 1 }}>
              <label style={{ fontWeight: 'bold' }}>Freeze Standings (Last X mins)</label>
              <input type="number" min="0" value={freezeMinutes} onChange={(e) => setFreezeMinutes(Number(e.target.value))} placeholder="e.g. 30" style={inputStyle} />
            </div>
            {/* 👉 ADDED: Start Time Scheduler */}
            <div style={{ flex: 1 }}>
              <label style={{ fontWeight: 'bold' }}>Schedule Start Time (Leave blank for now)</label>
              <input type="datetime-local" value={startTimeStr} onChange={(e) => setStartTimeStr(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* 👉 ADDED: The group access tick signs */}
          <div style={{ marginBottom: 24, display: 'flex', gap: 24, flexWrap: 'wrap', padding: '16px', background: 'rgba(2,6,23,.45)', borderRadius: '12px', border: '1px solid rgba(148,163,184,.18)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontWeight: 'bold', color: '#eef2ff' }}>
              <input type="checkbox" checked={allowTeamSubmissionView} onChange={e => setAllowTeamSubmissionView(e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
              Allow members to see group submissions
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontWeight: 'bold', color: '#eef2ff' }}>
              <input type="checkbox" checked={hideProblemMetaDuringContest} onChange={e => setHideProblemMetaDuringContest(e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
              Hide Problem Tags/Difficulty during contest
            </label>
          </div>
          
          <h2 style={{ marginTop: 24, marginBottom: 12 }}>Players <span style={{ color: '#67e8f9' }}>({cleanMemberCount})</span></h2>
          
          {mode === 'single' && (
            <section style={teamCard}>
              <h2 style={{ margin: '0 0 16px 0', fontSize: 18 }}>Solo player</h2>
              <div style={memberRow}>
                <input value={soloPlayer.username} onChange={(e) => setSoloPlayer({ username: e.target.value })} placeholder="DivineCode Username" style={smallInput} />
              </div>
            </section>
          )}
          
          {mode === 'group' && (
            <>
              <h2 style={{ margin: '0 0 16px 0', fontSize: 18 }}>Teams / Groups</h2>
              {teams.map((team, ti) => (
                <section key={ti} style={teamCard}>
                  <input value={team.name} onChange={(e) => updateTeam(ti, e.target.value)} placeholder="Group name" style={{ ...inputStyle, fontWeight: 'bold' }} />
                  <div style={memberRow}>
                    {team.players.map((member, pi) => (
                      <input key={pi} value={member.username} onChange={(e) => updatePlayer(ti, pi, e.target.value)} placeholder="DivineCode Username" style={smallInput} />
                    ))}
                  </div>
                  <button onClick={() => addPlayer(ti)} style={ghostBtn}>+ Add player to {team.name}</button>
                </section>
              ))}
              <button onClick={addTeam} style={ghostBtn}>+ Add group/team</button>
            </>
          )}
          
          <h2 style={{ marginTop: 40, marginBottom: 16 }}>Problems</h2>
          <div style={{ display: 'grid', gap: 14 }}>
            {problems.map((p, i) => (
              <div key={i} style={problemCard}>
                <strong style={{ color: '#67e8f9', width: 40 }}>#{String.fromCharCode(65 + i)}</strong>
                <select value={p.platform} onChange={(e) => updateProblem(i, 'platform', e.target.value)} style={{ ...smallInput, flex: '1 1 120px' }}>
                  <option>Codeforces</option><option>LeetCode</option><option>AtCoder</option><option>Interview MCQ</option> 
                </select>

                {p.platform === 'Interview MCQ' ? (
                  <select 
                    value={p.interviewQuestionId || ''} 
                    onChange={(e) => {
                      const q = availableMcqs.find(m => m.id === e.target.value);
                      if (q) {
                        updateProblem(i, 'interviewQuestionId', q.id);
                        updateProblem(i, 'code', q.id); 
                        updateProblem(i, 'title', q.title || q.prompt.substring(0, 50));
                        updateProblem(i, 'url', `/interview`);
                        updateProblem(i, 'tags', 'mcq, theory');
                        setLookupState({ ...lookupState, [i]: 'MCQ loaded.' });
                      }
                    }}
                    style={{ ...smallInput, flex: '1 1 120px' }}
                  >
                    <option value="" disabled>Select an MCQ...</option>
                    {availableMcqs.map(m => <option key={m.id} value={m.id}>{m.title || m.prompt.substring(0, 40)}...</option>)}
                  </select>
                ) : (
                  <input value={p.code} onChange={(e) => updateProblem(i, 'code', e.target.value)} placeholder="Code" style={{ ...smallInput, flex: '1 1 120px' }} />
                )}

                <button onClick={() => lookupProblem(i)} disabled={p.platform === 'Interview MCQ'} style={{ ...ghostBtn, flex: '1 1 100px', opacity: p.platform === 'Interview MCQ' ? 0.5 : 1 }}>Lookup</button>
                <input value={p.title} onChange={(e) => updateProblem(i, 'title', e.target.value)} placeholder="Title" style={{ ...smallInput, flex: '2 1 200px' }} />
                <input value={p.url} onChange={(e) => updateProblem(i, 'url', e.target.value)} placeholder="URL" style={{ ...smallInput, width: '100%', flex: '1 1 100%' }} />
              </div>
            ))}
          </div>
          <button onClick={addProblem} style={{ ...ghostBtn, marginTop: 14 }}>+ Add problem</button>
          
          <div style={{ marginTop: 40, borderTop: '1px solid rgba(148,163,184,.2)', paddingTop: 24, textAlign: 'right' }}>
            <button onClick={createContest} disabled={isCreating} style={primaryBtn}>
              Create {mode === 'single' ? 'Solo Contest' : 'Team Mashup'}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

// STYLES
const page: CSSProperties = { minHeight: '100vh', padding: '4vw', fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.35), transparent 36rem), radial-gradient(circle at bottom right, rgba(34,211,238,.18), transparent 30rem), #070a16', boxSizing: 'border-box' };
const gate: CSSProperties = { maxWidth: 620, margin: '15vh auto', padding: 34, borderRadius: 28, border: '1px solid rgba(148,163,184,.22)', background: 'rgba(15,23,42,.82)', textAlign: 'center' };
const topLink: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 900 };
const primaryLink: CSSProperties = { display: 'inline-block', padding: '12px 17px', borderRadius: 999, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', textDecoration: 'none', fontWeight: 900 };
const hero: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap', margin: '24px 0 32px 0' };
const eyebrow: CSSProperties = { color: '#67e8f9', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase', margin: 0 };
const shell: CSSProperties = { padding: 'clamp(20px, 4vw, 32px)', borderRadius: 30, border: '1px solid rgba(148,163,184,.22)', background: 'rgba(15,23,42,.82)', boxSizing: 'border-box' };
const modeGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14, marginBottom: 26 };
const modeBtn: CSSProperties = { padding: 20, borderRadius: 22, border: '1px solid rgba(148,163,184,.24)', background: 'rgba(2,6,23,.45)', color: '#e2e8f0', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer' };
const activeMode: CSSProperties = { ...modeBtn, border: '1px solid rgba(34,211,238,.75)', background: 'rgba(34,211,238,.12)' };
const inputStyle: CSSProperties = { width: '100%', padding: 14, margin: '8px 0 16px', border: '1px solid rgba(148,163,184,.25)', borderRadius: 14, background: 'rgba(2,6,23,.55)', color: '#eef2ff', outline: 'none', boxSizing: 'border-box' };
const smallInput: CSSProperties = { width: '100%', padding: 12, border: '1px solid rgba(148,163,184,.25)', borderRadius: 12, background: 'rgba(15,23,42,.8)', color: '#eef2ff', outline: 'none', boxSizing: 'border-box' };
const memberRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 };
const teamCard: CSSProperties = { padding: 'clamp(16px, 3vw, 24px)', borderRadius: 20, background: 'rgba(2,6,23,.45)', border: '1px solid rgba(148,163,184,.18)', marginBottom: 16, boxSizing: 'border-box' };
const problemCard: CSSProperties = { padding: 16, borderRadius: 20, background: 'rgba(2,6,23,.5)', border: '1px solid rgba(148,163,184,.16)', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', boxSizing: 'border-box' };
const ghostBtn: CSSProperties = { padding: '11px 18px', borderRadius: 999, border: '1px solid rgba(148,163,184,.28)', background: 'rgba(15,23,42,.72)', color: '#dbeafe', cursor: 'pointer', fontWeight: 'bold' };
const primaryBtn: CSSProperties = { padding: '16px 28px', borderRadius: 999, border: 0, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontWeight: 900, cursor: 'pointer', fontSize: 16 };
const overlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(2,6,23,0.8)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 50 };
const overlayModal: CSSProperties = { padding: 30, backgroundColor: '#0f172a', border: '1px solid rgba(103,232,249,0.3)', borderRadius: 20, textAlign: 'center', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' };