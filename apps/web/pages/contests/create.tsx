import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

type Mode = 'single' | 'group';
type MemberRow = { username: string }; 
type TeamRow = { name: string; players: MemberRow[] };

const emptyMember = (): MemberRow => ({ username: '' });

export default function CreateContestPage() {
  const { data: session, status } = useSession();
  const [mounted, setMounted] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const [mode, setMode] = useState<Mode>('group');
  const [title, setTitle] = useState('DivineCode Team Mashup Round');
  const [duration, setDuration] = useState(120);
  const [startTimeStr, setStartTimeStr] = useState(''); 
  const [freezeMinutes, setFreezeMinutes] = useState(0);
  const [allowTeamSubmissionView, setAllowTeamSubmissionView] = useState(true);
  const [hideProblemMetaDuringContest, setHideProblemMetaDuringContest] = useState(true);
  const [isRated, setIsRated] = useState(true);
  
  const [soloPlayer, setSoloPlayer] = useState<MemberRow>(emptyMember());
  const [teams, setTeams] = useState<TeamRow[]>([
    { name: 'Group A', players: [emptyMember(), emptyMember(), emptyMember()] },
    { name: 'Group B', players: [emptyMember(), emptyMember(), emptyMember()] }
  ]);

  // Mashup Builder States
  const [activeTab, setActiveTab] = useState<'URL' | 'CUSTOM' | 'MCQ'>('URL');
  const [urlProblem, setUrlProblem] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [customCases, setCustomCases] = useState([{ input: '', output: '' }]);
  const [mcqPrompt, setMcqPrompt] = useState('');
  const [mcqOptions, setMcqOptions] = useState(['', '']);
  const [mcqCorrect, setMcqCorrect] = useState<number[]>([]);
  
  // Accumulated Problems payload
  const [compiledProblems, setCompiledProblems] = useState<any[]>([]);
  const [aiBank, setAiBank] = useState<any[]>([]);

  useEffect(() => { 
    setMounted(true); 
    fetch(`${API_V2_BASE_URL}/ai-dataset`).then(r => r.json()).then(d => setAiBank(d.problems || []));
  }, []);

  const cleanMemberCount = useMemo(() => {
    if (mode === 'single') return soloPlayer.username.trim() ? 1 : 0;
    return teams.flatMap((team) => team.players).filter((member) => member.username.trim()).length;
  }, [mode, soloPlayer, teams]);

  function addTeam() { setTeams([...teams, { name: `Group ${String.fromCharCode(65 + teams.length)}`, players: [emptyMember(), emptyMember(), emptyMember()] }]); }
  function updateTeam(index: number, name: string) { const next = [...teams]; next[index] = { ...next[index], name }; setTeams(next); }
  function addPlayer(teamIndex: number) { const next = [...teams]; next[teamIndex].players.push(emptyMember()); setTeams(next); }
  function updatePlayer(teamIndex: number, playerIndex: number, value: string) { const next = [...teams]; next[teamIndex].players[playerIndex] = { username: value }; setTeams(next); }

  function queueProblem() {
    let payload: any = { type: activeTab };
    if (activeTab === 'URL') {
      if (!urlProblem) return alert('Enter a URL');
      payload.url = urlProblem;
      payload.displayTitle = urlProblem.split('/').pop();
    } else if (activeTab === 'CUSTOM') {
      if (!customTitle) return alert('Enter a title');
      payload.customData = { title: customTitle, description: customDesc, testcases: customCases };
      payload.displayTitle = customTitle;
    } else {
      if (!mcqPrompt || mcqCorrect.length === 0) return alert('Enter prompt and select correct answers');
      payload.mcqData = { prompt: mcqPrompt, options: mcqOptions, correctIndices: mcqCorrect };
      payload.displayTitle = "MCQ: " + mcqPrompt.substring(0, 20) + "...";
    }
    
    setCompiledProblems([...compiledProblems, payload]);
    // Reset forms
    setUrlProblem(''); setCustomTitle(''); setCustomDesc(''); setMcqPrompt('');
  }

  async function createContest() {
    if (!session?.user?.email) return alert('Sign in first.');
    const cleanMember = (username: string, team: string) => ({ username: username.trim(), teamName: team });
    const cleanedMembers = mode === 'single' ? (soloPlayer.username.trim() ? [cleanMember(soloPlayer.username, 'Solo')] : []) 
      : teams.flatMap((team) => team.players.filter((m) => m.username.trim()).map((m) => cleanMember(m.username, team.name.trim() || 'Group')));
    
    if (cleanedMembers.length === 0) return alert('Add at least one player.');
    if (compiledProblems.length === 0) return alert('Add at least one problem to the mashup.');
    
    setIsCreating(true);

    try {
      // 1. Create Empty Contest First
      const res = await fetch(`${API_V2_BASE_URL}/contests`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-email': session.user.email },
        body: JSON.stringify({ 
          title, description: `${mode === 'single' ? 'Solo' : 'Team'} mashup`, 
          startTime: startTimeStr ? new Date(startTimeStr).toISOString() : undefined,
          durationMinutes: duration, freezeMinutes: freezeMinutes > 0 ? freezeMinutes : undefined,
          allowTeamSubmissionView, hideProblemMetaDuringContest, isRated,
          ownerEmail: session.user.email, members: cleanedMembers, problems: [] 
        })
      });
      const data = await res.json();
      if (!data.id) throw new Error("Contest creation failed.");

      // 2. Hydrate with compiled problems sequentially
      for (const prob of compiledProblems) {
        await fetch(`${API_V2_BASE_URL}/contests/${data.id}/problems/mashup`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-email': session.user.email },
          body: JSON.stringify(prob)
        });
      }

      window.location.href = `/contests/${data.id}`;
    } catch (error) {
      alert('Error finalizing mashup');
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
            <p style={{ color: '#67e8f9', margin: 0, fontSize: 14 }}>Scraping URLs and synchronizing questions.</p>
          </div>
        </div>
      )}

      <section style={{ maxWidth: 1180, margin: '0 auto' }}>
        <a href="/" style={topLink}>← DivineCode Home</a>
        
        <div style={hero}>
          <div style={{ flex: '1 1 400px' }}>
            <p style={eyebrow}>Team mashup builder</p>
            <h1 style={{ fontSize: 'clamp(32px, 5vw, 52px)', margin: '10px 0' }}>Create controlled contests.</h1>
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
            <div style={{ flex: 1 }}><label style={{ fontWeight: 'bold' }}>Duration (mins)</label><input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={inputStyle} /></div>
            <div style={{ flex: 1 }}><label style={{ fontWeight: 'bold' }}>Freeze Standings</label><input type="number" min="0" value={freezeMinutes} onChange={(e) => setFreezeMinutes(Number(e.target.value))} placeholder="e.g. 30" style={inputStyle} /></div>
            <div style={{ flex: 1 }}><label style={{ fontWeight: 'bold' }}>Schedule Start</label><input type="datetime-local" value={startTimeStr} onChange={(e) => setStartTimeStr(e.target.value)} style={inputStyle} /></div>
          </div>

          <h2 style={{ marginTop: 24, marginBottom: 12 }}>Players <span style={{ color: '#67e8f9' }}>({cleanMemberCount})</span></h2>
          
          {mode === 'single' ? (
            <section style={teamCard}>
              <input value={soloPlayer.username} onChange={(e) => setSoloPlayer({ username: e.target.value })} placeholder="DivineCode Username" style={smallInput} />
            </section>
          ) : (
            <>
              {teams.map((team, ti) => (
                <section key={ti} style={teamCard}>
                  <input value={team.name} onChange={(e) => updateTeam(ti, e.target.value)} placeholder="Group name" style={{ ...inputStyle, fontWeight: 'bold' }} />
                  <div style={memberRow}>
                    {team.players.map((member, pi) => (
                      <input key={pi} value={member.username} onChange={(e) => updatePlayer(ti, pi, e.target.value)} placeholder="Username" style={smallInput} />
                    ))}
                  </div>
                  <button onClick={() => addPlayer(ti)} style={ghostBtn}>+ Add player</button>
                </section>
              ))}
              <button onClick={addTeam} style={ghostBtn}>+ Add group/team</button>
            </>
          )}
          
          <h2 style={{ marginTop: 40, marginBottom: 16 }}>Advanced Mashup Builder</h2>
          
          <div style={{ display: 'flex', gap: 20 }}>
            {/* Left Pane: Builder */}
            <div style={{ flex: 2, background: '#020617', padding: 20, borderRadius: 12, border: '1px solid rgba(148,163,184,.16)' }}>
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                {['URL', 'CUSTOM', 'MCQ'].map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab as any)} style={{ padding: '8px 16px', background: activeTab === tab ? '#38bdf8' : '#1e293b', color: activeTab === tab ? '#000' : '#94a3b8', border: 'none', borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }}>
                    {tab === 'URL' ? '🔗 URL Scrape' : tab === 'CUSTOM' ? '💻 Custom Code' : '📝 Theory MCQ'}
                  </button>
                ))}
              </div>

              {activeTab === 'URL' && <input value={urlProblem} onChange={e => setUrlProblem(e.target.value)} style={inputStyle} placeholder="Paste Codeforces / LeetCode URL" />}
              
              {activeTab === 'CUSTOM' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input value={customTitle} onChange={e => setCustomTitle(e.target.value)} style={inputStyle} placeholder="Problem Title" />
                  <textarea value={customDesc} onChange={e => setCustomDesc(e.target.value)} style={{...inputStyle, height: 100}} placeholder="Markdown Problem Description" />
                  {customCases.map((tc, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10 }}>
                      <textarea value={tc.input} onChange={e => { const n = [...customCases]; n[i].input = e.target.value; setCustomCases(n); }} style={inputStyle} placeholder={`Input ${i+1}`} />
                      <textarea value={tc.output} onChange={e => { const n = [...customCases]; n[i].output = e.target.value; setCustomCases(n); }} style={inputStyle} placeholder={`Output ${i+1}`} />
                    </div>
                  ))}
                  <button onClick={() => setCustomCases([...customCases, { input: '', output: '' }])} style={ghostBtn}>+ Test Case</button>
                </div>
              )}

              {activeTab === 'MCQ' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <textarea value={mcqPrompt} onChange={e => setMcqPrompt(e.target.value)} style={{...inputStyle, height: 80}} placeholder="Question Prompt" />
                  <p style={{ fontSize: 12, color: '#94a3b8' }}>Check boxes for correct answers (Multi-correct supported).</p>
                  {mcqOptions.map((opt, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#0f172a', padding: 8, borderRadius: 8 }}>
                      <input type="checkbox" checked={mcqCorrect.includes(i)} onChange={() => setMcqCorrect(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])} style={{ transform: 'scale(1.5)', cursor: 'pointer' }} />
                      <input value={opt} onChange={e => { const n = [...mcqOptions]; n[i] = e.target.value; setMcqOptions(n); }} style={{...inputStyle, margin: 0}} placeholder={`Option ${String.fromCharCode(65+i)}`} />
                    </div>
                  ))}
                  <button onClick={() => setMcqOptions([...mcqOptions, ''])} style={ghostBtn}>+ Option</button>
                </div>
              )}
              <button onClick={queueProblem} style={{...primaryBtn, width: '100%', marginTop: 20}}>Queue Problem</button>
            </div>

            {/* Right Pane: Queued List & AI */}
            <div style={{ flex: 1.5, display: 'flex', flexDirection: 'column', gap: 15 }}>
              <div style={{ background: '#0f172a', padding: 20, borderRadius: 12, border: '1px solid rgba(148,163,184,.16)', minHeight: 150 }}>
                <h3 style={{ marginTop: 0, color: '#a5b4fc' }}>Queued to Mashup ({compiledProblems.length})</h3>
                {compiledProblems.map((p, idx) => (
                  <div key={idx} style={{ background: '#1e293b', padding: '10px 15px', borderRadius: 6, marginBottom: 8, fontSize: 14 }}>
                    <strong style={{ color: '#67e8f9', marginRight: 10 }}>{String.fromCharCode(65 + idx)}</strong>
                    {p.displayTitle} <span style={{ color: '#64748b', fontSize: 12 }}>({p.type})</span>
                  </div>
                ))}
              </div>

              <div style={{ background: '#0f172a', padding: 20, borderRadius: 12, border: '1px solid rgba(99,102,241,.3)', flex: 1 }}>
                 <h3 style={{ marginTop: 0, color: '#a5b4fc' }}>🤖 AI Problem Bank</h3>
                 {aiBank.length === 0 ? <p style={{ color: '#475569', fontSize: 14 }}>No curated problems found.</p> : 
                   aiBank.map((prob) => (
                     <div key={prob.id} style={{ background: '#1e293b', padding: 10, borderRadius: 6, marginBottom: 10, border: '1px solid #334155' }}>
                       <strong style={{ fontSize: 14, display: 'block', color: '#e2e8f0', marginBottom: 5 }}>{prob.title}</strong>
                       <button onClick={() => setCompiledProblems([...compiledProblems, { type: 'URL', url: prob.originalUrl, displayTitle: prob.title }])} style={{...ghostBtn, padding: '5px 10px', fontSize: 12}}>+ Add</button>
                     </div>
                   ))
                 }
              </div>
            </div>
          </div>
          
          <div style={{ marginTop: 40, borderTop: '1px solid rgba(148,163,184,.2)', paddingTop: 24, textAlign: 'right' }}>
            <button onClick={createContest} disabled={isCreating} style={primaryBtn}>Create {mode === 'single' ? 'Solo Contest' : 'Team Mashup'}</button>
          </div>
        </div>
      </section>
    </main>
  );
}

// STYLES
const page: CSSProperties = { minHeight: '100vh', padding: '4vw', fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.35), transparent 36rem), #070a16', boxSizing: 'border-box' };
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
const ghostBtn: CSSProperties = { padding: '11px 18px', borderRadius: 999, border: '1px solid rgba(148,163,184,.28)', background: 'rgba(15,23,42,.72)', color: '#dbeafe', cursor: 'pointer', fontWeight: 'bold' };
const primaryBtn: CSSProperties = { padding: '16px 28px', borderRadius: 999, border: 0, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontWeight: 900, cursor: 'pointer', fontSize: 16 };
const overlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(2,6,23,0.8)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 50 };
const overlayModal: CSSProperties = { padding: 30, backgroundColor: '#0f172a', border: '1px solid rgba(103,232,249,0.3)', borderRadius: 20, textAlign: 'center', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' };