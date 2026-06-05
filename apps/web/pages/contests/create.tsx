import { CSSProperties, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import toast, { Toaster } from 'react-hot-toast';

const API_V2 = process.env.NEXT_PUBLIC_API_BASE_URL + '/api/v2';

export default function GlobalNavigationAndMashupCreator() {
  const router = useRouter();
  const { data: session } = useSession();
  
  // Navigation Tabs state
  const [navTab, setNavTab] = useState<'mashup' | 'duel' | 'interview'>('mashup');

  // Creator forms state
  const [activeTab, setActiveTab] = useState<'URL' | 'CUSTOM' | 'MCQ'>('URL');
  const [title, setTitle] = useState('DivineCode Controlled Practice Set');
  const [duration, setDuration] = useState(120);
  const [startTimeStr, setStartTimeStr] = useState('');
  const [usernameInput, setUsernameInput] = useState('');

  const [urlProblem, setUrlProblem] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [customCases, setCustomCases] = useState([{ input: '', output: '' }]);
  const [mcqPrompt, setMcqPrompt] = useState('');
  const [mcqOptions, setMcqOptions] = useState(['', '']);
  const [mcqCorrect, setMcqCorrect] = useState<number[]>([]);
  
  const [compiledProblems, setCompiledProblems] = useState<any[]>([]);
  const [aiBank, setAiBank] = useState<any[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    fetch(`${API_V2}/ai-dataset`).then(r => r.json()).then(d => setAiBank(d.problems || []));
  }, []);

  function queueProblem() {
    let payload: any = { type: activeTab };
    if (activeTab === 'URL') {
      if (!urlProblem) return toast.error('Enter URL');
      payload.url = urlProblem;
      payload.displayTitle = urlProblem.split('/').pop();
    } else if (activeTab === 'CUSTOM') {
      if (!customTitle) return toast.error('Enter custom title');
      payload.customData = { title: customTitle, description: customDesc, testcases: customCases };
      payload.displayTitle = customTitle;
    } else {
      if (!mcqPrompt || mcqCorrect.length === 0) return toast.error('Enter question parameters');
      payload.mcqData = { prompt: mcqPrompt, options: mcqOptions, correctIndices: mcqCorrect };
      payload.displayTitle = "Theory MCQ: " + mcqPrompt.substring(0, 20) + "...";
    }
    setCompiledProblems([...compiledProblems, payload]);
    setUrlProblem(''); setCustomTitle(''); setCustomDesc(''); setMcqPrompt(''); setMcqCorrect([]); setMcqOptions(['', '']);
    toast.success("Problem appended to contest batch queue!");
  }

  async function createContest() {
    if (compiledProblems.length === 0) return toast.error("Batch queue empty.");
    setIsCreating(true);

    try {
      const res = await fetch(`${API_V2}/contests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-email': session?.user?.email || '' },
        body: JSON.stringify({ 
          title, description: 'DivineCode Mashup Array', durationMinutes: duration, isRated: true,
          startTime: startTimeStr ? new Date(startTimeStr).toISOString() : undefined,
          ownerEmail: session?.user?.email || '', members: [{ username: usernameInput.trim() || 'RKS_Rider', teamName: 'Solo' }], problems: [] 
        })
      });
      const contest = await res.json();
      if (!res.ok || !contest.id) throw new Error();

      // Flawless synchronous dispatch orchestration sequence
      for (const prob of compiledProblems) {
        await fetch(`${API_V2}/contests/${contest.id}/problems/mashup`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-email': session?.user?.email || '' }, body: JSON.stringify(prob)
        });
      }
      toast.success("Mashup orchestrator finalized cleanly!");
      router.push(`/contests/${contest.id}`);
    } catch {
      toast.error("Network error during mashup creation.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div style={page}>
      <Toaster />
      {isCreating && <div style={overlay}><div style={overlayModal}><h2>Forging Mashup array specifications...</h2></div></div>}

      {/* 👉 TOP HOME PAGE COMPREHENSIVE HUB CHANNELS */}
      <nav style={{ display: 'flex', gap: 15, background: '#1e293b', padding: '15px 30px', borderBottom: '1px solid #334155' }}>
        <button onClick={() => setNavTab('mashup')} style={navTab === 'mashup' ? actNav : pasNav}>Mashup Control Room</button>
        <button onClick={() => { setNavTab('duel'); router.push('/duel'); }} style={navTab === 'duel' ? actNav : pasNav}>1v1 Realtime Duel Matrix</button>
        <button onClick={() => { setNavTab('interview'); router.push('/interview'); }} style={navTab === 'interview' ? actNav : pasNav}>Interview Coding Modules</button>
      </nav>

      {navTab === 'mashup' && (
        <div style={{ display: 'flex', gap: '30px', padding: 40, maxWidth: 1300, margin: '0 auto', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 600px' }}>
            <h1 style={{ color: '#38bdf8', marginTop: 0 }}>Create Live Practice Contest</h1>
            
            <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
              <div style={{ flex: 1 }}><label>Contest Title</label><input value={title} onChange={e => setTitle(e.target.value)} style={inputBox} /></div>
              <div style={{ flex: 0.5 }}><label>Duration (mins)</label><input type="number" value={duration} onChange={e => setDuration(Number(e.target.value))} style={inputBox} /></div>
            </div>

            {/* 👉 CALENDAR BOX RESTRUCTURE: Fixed invisible picker icon by forcing color-scheme properties */}
            <div style={{ marginBottom: 25 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Schedule Launch Calendar Time</label>
              <input 
                type="datetime-local" 
                value={startTimeStr} 
                onChange={e => setStartTimeStr(e.target.value)} 
                style={{ ...inputBox, colorScheme: 'dark', backgroundColor: '#0f172a', color: '#fff' }} 
              />
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 20, borderBottom: '1px solid #1e293b', paddingBottom: 10 }}>
              {['URL', 'CUSTOM', 'MCQ'].map(t => (
                <button key={t} onClick={() => setActiveTab(t as any)} style={{ padding: '8px 16px', background: activeTab === t ? '#38bdf8' : '#1e293b', color: activeTab === t ? '#000' : '#fff', border: 'none', borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }}>{t}</button>
              ))}
            </div>

            {activeTab === 'URL' && <input value={urlProblem} onChange={e => setUrlProblem(e.target.value)} style={inputBox} placeholder="Paste External Problem Link..." />}
            
            {activeTab === 'CUSTOM' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input value={customTitle} onChange={e => setCustomTitle(e.target.value)} style={inputBox} placeholder="Title" />
                <textarea value={customDesc} onChange={e => setCustomDesc(e.target.value)} style={{...inputBox, height: 80, resize: 'none'}} placeholder="Markdown Statement Content" />
              </div>
            )}

            {activeTab === 'MCQ' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input value={mcqPrompt} onChange={e => setMcqPrompt(e.target.value)} style={inputBox} placeholder="Question Option Evaluation Prompt" />
                <p style={{fontSize: 12, color: '#94a3b8', margin: 0}}>Check the box next to correct options.</p>
                {mcqOptions.map((o, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input type="checkbox" checked={mcqCorrect.includes(idx)} onChange={() => setMcqCorrect(prev => prev.includes(idx) ? prev.filter(x => x !== idx) : [...prev, idx])} style={{transform: 'scale(1.5)', cursor: 'pointer'}} />
                    <input value={o} onChange={e => { const n = [...mcqOptions]; n[idx] = e.target.value; setMcqOptions(n); }} style={inputBox} placeholder={`Option ${String.fromCharCode(65+idx)}`} />
                  </div>
                ))}
                <button onClick={() => setMcqOptions([...mcqOptions, ''])} style={{...ghostBtn, alignSelf: 'flex-start'}}>+ Option Item</button>
              </div>
            )}

            <button onClick={queueProblem} style={{ ...primaryBtn, width: '100%', marginTop: 25, padding: 15 }}>Append Question to Dispatch Array</button>
            <button onClick={createContest} style={{ background: '#10b981', color: '#fff', padding: 15, borderRadius: 8, width: '100%', marginTop: 15, fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>Deploy & Synchronize Mashup Suite</button>
          </div>

          {/* RIGHT SIDEBAR: Queued view & massive AI avatar catalogs */}
          <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: '#0f172a', padding: 20, borderRadius: 12, border: '1px solid #1e293b' }}>
              <h3 style={{ marginTop: 0, color: '#a5b4fc' }}>Queued Suite Batch ({compiledProblems.length})</h3>
              {compiledProblems.length === 0 && <p style={{color: '#64748b'}}>No problems queued.</p>}
              {compiledProblems.map((p, i) => <div key={i} style={{ padding: '10px', background: '#1e293b', borderRadius: 4, margin: '8px 0', border: '1px solid #334155' }}>{p.displayTitle}</div>)}
            </div>

            <div style={{ background: '#0f172a', padding: 20, borderRadius: 12, border: '1px solid #1e293b', flex: 1 }}>
              <h3 style={{ marginTop: 0, color: '#a5b4fc' }}>🤖 Global Curation Catalog</h3>
              <div style={{display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '600px', overflowY: 'auto', paddingRight: 10}}>
                {aiBank.map(p => (
                  <div key={p.id} style={{ padding: 12, background: '#1e293b', borderRadius: 8, border: '1px solid #334155' }}>
                    <span style={{ fontSize: 13, fontWeight: 'bold', display: 'block', marginBottom: 8, color: '#eef2ff' }}>{p.title}</span>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, background: '#3b82f633', color: '#38bdf8', padding: '2px 6px', borderRadius: 4 }}>{p.platform}</span>
                      <span style={{ fontSize: 10, background: '#1e293b', color: '#94a3b8', padding: '2px 6px', borderRadius: 4 }}>{p.difficulty}</span>
                    </div>
                    <button onClick={() => setCompiledProblems([...compiledProblems, { type: 'URL', url: p.originalUrl, displayTitle: p.title }])} style={{ background: '#38bdf8', color: '#000', fontWeight: 'bold', border: 'none', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>+ Import to Mashup</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const page: CSSProperties = { minHeight: '100vh', background: '#020617', color: '#e2e8f0', fontFamily: 'sans-serif' };
const actNav: CSSProperties = { padding: '10px 15px', background: '#38bdf8', color: '#000', borderRadius: 6, fontWeight: 'bold', border: 'none', cursor: 'pointer' };
const pasNav: CSSProperties = { padding: '10px 15px', background: 'transparent', color: '#94a3b8', borderRadius: 6, border: 'none', cursor: 'pointer' };
const inputBox = { width: '100%', padding: '12px', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: '#fff', boxSizing: 'border-box' as const, marginTop: 5 };
const primaryBtn = { background: '#38bdf8', color: '#000', border: 'none', padding: '12px', borderRadius: '8px', fontWeight: 'bold' as const, cursor: 'pointer' };
const ghostBtn = { background: 'transparent', color: '#38bdf8', border: '1px solid #38bdf8', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' as const };
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 };
const overlayModal = { background: '#0f172a', padding: 30, borderRadius: 12, border: '1px solid #38bdf8', textAlign: 'center' as const };