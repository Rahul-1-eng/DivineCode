import { CSSProperties, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import toast, { Toaster } from 'react-hot-toast';

const API_V2 = process.env.NEXT_PUBLIC_API_BASE_URL + '/api/v2';

export default function GlobalNavigationAndMashupCreator() {
  const router = useRouter();
  const { data: session } = useSession();
  
  const [navTab, setNavTab] = useState<'mashup' | 'duel' | 'interview'>('mashup');

  const [contestMode, setContestMode] = useState<'SOLO' | 'GROUP'>('GROUP');
  const [activeTab, setActiveTab] = useState<'URL' | 'CUSTOM' | 'MCQ'>('URL');
  const [title, setTitle] = useState('DivineCode Controlled Practice Set');
  const [duration, setDuration] = useState(120);
  const [startTimeStr, setStartTimeStr] = useState('');
  
  const [urlProblem, setUrlProblem] = useState('');
  const [imageBase64, setImageBase64] = useState<string>('');
  
  const [customTitle, setCustomTitle] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [customCases, setCustomCases] = useState([{ input: '', expectedOutput: '', isHidden: false }]);
  
  const [mcqPrompt, setMcqPrompt] = useState('');
  const [mcqOptions, setMcqOptions] = useState(['', '']);
  const [mcqCorrect, setMcqCorrect] = useState<number[]>([]);
  const [mcqTimeLimit, setMcqTimeLimit] = useState(120); // Default 2 mins
  
  const [compiledProblems, setCompiledProblems] = useState<any[]>([]);
  const [aiBank, setAiBank] = useState<any[]>([]);
  
  const [isCreating, setIsCreating] = useState(false);
  const [loadingContext, setLoadingContext] = useState('');

  useEffect(() => {
    fetch(`${API_V2}/ai-dataset`)
      .then(r => r.json())
      .then(d => {
         if (d.problems && d.problems.length > 0) {
           setAiBank(d.problems);
         } else {
           setAiBank([
             { id: 'cf-1', title: 'Watermelon', originalUrl: 'https://codeforces.com/problemset/problem/4/A', difficulty: 'Easy', platform: 'Codeforces' },
             { id: 'lc-1', title: 'Two Sum', originalUrl: 'https://leetcode.com/problems/two-sum/', difficulty: 'Easy', platform: 'LeetCode' }
           ]);
         }
      })
      .catch(() => {});
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setImageBase64(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  function queueProblem() {
    let payload: any = { type: activeTab };
    
    if (activeTab === 'URL') {
      let finalUrl = urlProblem.trim();
      
      // 👉 FIXED: Auto-convert "800 A" or "1500B" into Codeforces URLs on the fly
      if (!finalUrl.startsWith('http') && /^\d+\s*[a-zA-Z][0-9]?$/.test(finalUrl)) {
         const clean = finalUrl.replace(/\s+/g, '').toUpperCase();
         const num = clean.match(/^\d+/)?.[0];
         const letter = clean.match(/[A-Z0-9]+$/)?.[0];
         finalUrl = `https://codeforces.com/problemset/problem/${num}/${letter}`;
      } else if (!finalUrl.startsWith('http')) {
         return toast.error('Enter a valid URL or Codeforces Code (e.g., 800A)');
      }

      payload.url = finalUrl;
      payload.title = finalUrl.split('/').pop() || 'External Problem';
      payload.displayTitle = payload.title;
      
    } else if (activeTab === 'CUSTOM') {
      if (!customTitle) return toast.error('Enter custom title');
      const validCases = customCases.filter(c => c.input.trim() !== '' && c.expectedOutput.trim() !== '');
      
      // Flatten the structure
      payload.title = customTitle;
      payload.description = customDesc;
      payload.imageUrl = imageBase64 || null;
      payload.testcases = validCases;
      payload.displayTitle = customTitle;} else {
      if (!mcqPrompt || mcqCorrect.length === 0) return toast.error('Enter question parameters');
      payload.isMCQ = true;
      payload.mcqTimeLimitSeconds = mcqTimeLimit;
      payload.mcqData = { prompt: mcqPrompt, options: mcqOptions, correctIndices: mcqCorrect, timeLimit: mcqTimeLimit };
      payload.displayTitle = "Theory MCQ: " + mcqPrompt.substring(0, 20) + "...";
    }
    
    setCompiledProblems([...compiledProblems, payload]);
    setUrlProblem(''); setImageBase64(''); setCustomTitle(''); setCustomDesc(''); 
    setCustomCases([{ input: '', expectedOutput: '', isHidden: false }]);
    setMcqPrompt(''); setMcqCorrect([]); setMcqOptions(['', '']);
    toast.success("Problem appended to contest batch queue!");
  }

  const removeProblem = (index: number) => {
    setCompiledProblems((prev) => prev.filter((_, i) => i !== index));
    toast.success("Problem removed from queue.");
  };

  const moveProblem = (index: number, direction: 'UP' | 'DOWN') => {
    if (direction === 'UP' && index === 0) return;
    if (direction === 'DOWN' && index === compiledProblems.length - 1) return;
    
    const newIdx = direction === 'UP' ? index - 1 : index + 1;
    const newArr = [...compiledProblems];
    const temp = newArr[index];
    newArr[index] = newArr[newIdx];
    newArr[newIdx] = temp;
    setCompiledProblems(newArr);
  };

  const editProblem = (index: number) => {
    const p = compiledProblems[index];
    removeProblem(index); 
    setActiveTab(p.type);
    
    if (p.type === 'URL') setUrlProblem(p.url);
    if (p.type === 'IMAGE') setImageBase64(p.imageUrl);
    if (p.type === 'CUSTOM') {
      setCustomTitle(p.customData.title);
      setCustomDesc(p.customData.description);
      setCustomCases(p.customData.testcases.length ? p.customData.testcases : [{ input: '', expectedOutput: '', isHidden: false }]);
    }
    if (p.type === 'MCQ') {
      setMcqPrompt(p.mcqData.prompt);
      setMcqOptions(p.mcqData.options);
      setMcqCorrect(p.mcqData.correctIndices);
    }
    toast("Problem loaded into editor. Make your changes and click 'Append' again.", { icon: '✍️' });
  };

  async function createContest() {
    if (compiledProblems.length === 0) return toast.error("Batch queue empty.");
    setIsCreating(true);
    setLoadingContext('Creating contest shell...');

    try {
      const res = await fetch(`${API_V2}/contests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-email': session?.user?.email || '' },
        body: JSON.stringify({ 
          title, 
          durationMinutes: duration, 
          type: contestMode, 
          startTime: startTimeStr ? new Date(startTimeStr).toISOString() : undefined,
          ownerEmail: session?.user?.email,
          ownerName: session?.user?.name || 'Admin',
          members: [{ 
              email: session?.user?.email, 
              displayName: session?.user?.name || 'Admin', 
              teamName: 'Admin Team' 
          }]
        })
      });
      
      const contest = await res.json();
      if (!res.ok) throw new Error(contest.error || "Shell creation failed");
      
      toast.success(`Contest Created! Invite Code: ${contest.inviteCode}`, { 
        duration: 10000,
        style: { background: '#38bdf8', color: '#000', fontWeight: 'bold' } 
      });

      let failedAny = false;

      // 👉 FIXED: This loop now checks `res.ok` to alert you exactly which questions fail
      for (let i = 0; i < compiledProblems.length; i++) {
        setLoadingContext(`Adding problem ${i + 1}/${compiledProblems.length}...`);
        try {
          const mRes = await fetch(`${API_V2}/contests/${contest.id}/problems/mashup`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'x-user-email': session?.user?.email || '' }, 
            body: JSON.stringify(compiledProblems[i])
          });

          if (!mRes.ok) {
            failedAny = true;
            const errData = await mRes.json();
            toast.error(`Failed to add '${compiledProblems[i].displayTitle}': Scraper Error or Timeout`);
          }
        } catch (err) {
          failedAny = true;
          toast.error(`Network error on problem '${compiledProblems[i].displayTitle}'`);
        }
      }
      
      if (!failedAny) toast.success("Mashup fully synchronized!");
      else toast.error("Mashup created, but some external problems failed to scrape.", { duration: 6000 });
      
      router.push(`/contests/${contest.id}`);
    } catch (err: any) {
      toast.error("Could not create contest shell.");
      setIsCreating(false);
    } 
  }

  return (
    <div style={page}>
      <Toaster />
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes pulseGlow { 0% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.4); } 70% { box-shadow: 0 0 0 20px rgba(56, 189, 248, 0); } 100% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); } }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}} />

      {isCreating && (
        <div style={overlay}>
          <div style={overlayModal}>
            <div style={{ width: 50, height: 50, border: '4px solid #1e293b', borderTopColor: '#38bdf8', borderRadius: '50%', margin: '0 auto 20px', animation: 'spin 1s linear infinite, pulseGlow 2s infinite' }} />
            <h2 style={{ color: '#fff', marginBottom: 10 }}>Forging Mashup Array</h2>
            <p style={{ color: '#38bdf8', fontWeight: 'bold' }}>{loadingContext}</p>
          </div>
        </div>
      )}

      <nav style={{ display: 'flex', gap: 15, background: '#1e293b', padding: '15px 30px', borderBottom: '1px solid #334155' }}>
        <button onClick={() => setNavTab('mashup')} style={navTab === 'mashup' ? actNav : pasNav}>Mashup Control Room</button>
        <button onClick={() => { setNavTab('duel'); router.push('/duel'); }} style={navTab === 'duel' ? actNav : pasNav}>1v1 Realtime Duel Matrix</button>
        <button onClick={() => { setNavTab('interview'); router.push('/interview'); }} style={navTab === 'interview' ? actNav : pasNav}>Interview Coding Modules</button>
      </nav>

      {navTab === 'mashup' && (
        <div style={{ display: 'flex', gap: '30px', padding: 40, maxWidth: 1300, margin: '0 auto', flexWrap: 'wrap' }}>
          
          <div style={{ flex: '1 1 600px' }}>
            <h1 style={{ color: '#38bdf8', marginTop: 0 }}>Create Live Practice Contest</h1>
            
            <div style={{ display: 'flex', gap: 10, marginBottom: 25, background: '#0f172a', padding: 10, borderRadius: 8, border: '1px solid #334155' }}>
              <button onClick={() => setContestMode('SOLO')} style={{ flex: 1, padding: 10, borderRadius: 6, fontWeight: 'bold', border: 'none', cursor: 'pointer', background: contestMode === 'SOLO' ? '#38bdf8' : 'transparent', color: contestMode === 'SOLO' ? '#000' : '#94a3b8' }}>👤 Solo Standings</button>
              <button onClick={() => setContestMode('GROUP')} style={{ flex: 1, padding: 10, borderRadius: 6, fontWeight: 'bold', border: 'none', cursor: 'pointer', background: contestMode === 'GROUP' ? '#38bdf8' : 'transparent', color: contestMode === 'GROUP' ? '#000' : '#94a3b8' }}>👥 Group & Team Mode</button>
            </div>

            <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
              <div style={{ flex: 1 }}><label>Contest Title</label><input value={title} onChange={e => setTitle(e.target.value)} style={inputBox} /></div>
              <div style={{ flex: 0.5 }}><label>Duration (mins)</label><input type="number" value={duration} onChange={e => setDuration(Number(e.target.value))} style={inputBox} /></div>
            </div>

            <div style={{ marginBottom: 25 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Schedule Launch Calendar Time</label>
              <input type="datetime-local" value={startTimeStr} onChange={e => setStartTimeStr(e.target.value)} style={{ ...inputBox, colorScheme: 'dark' }} />
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 20, borderBottom: '1px solid #1e293b', paddingBottom: 10 }}>
              {['URL', 'CUSTOM', 'MCQ'].map(t => (
                <button key={t} onClick={() => setActiveTab(t as any)} style={{ padding: '8px 16px', background: activeTab === t ? '#38bdf8' : '#1e293b', color: activeTab === t ? '#000' : '#fff', border: 'none', borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }}>{t}</button>
              ))}
            </div>

            {activeTab === 'URL' && <input value={urlProblem} onChange={e => setUrlProblem(e.target.value)} style={inputBox} placeholder="Paste Link or Codeforces Code (e.g. 1500A)" />}
            
          {activeTab === 'CUSTOM' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Existing Title/Desc inputs here... */}
                
                <h4 style={{ color: '#94a3b8' }}>Test Cases</h4>
                {customCases.map((tc, i) => (
                    <div key={i} style={{ display: 'flex', gap: 5 }}>
                        <input placeholder="Input" value={tc.input} onChange={e => {
                            const newCases = [...customCases];
                            newCases[i].input = e.target.value;
                            setCustomCases(newCases);
                        }} style={{...inputBox, flex: 1}} />
                        <input placeholder="Expected Output" value={tc.expectedOutput} onChange={e => {
                            const newCases = [...customCases];
                            newCases[i].expectedOutput = e.target.value;
                            setCustomCases(newCases);
                        }} style={{...inputBox, flex: 1}} />
                    </div>
                ))}
                <button onClick={() => setCustomCases([...customCases, {input: '', expectedOutput: '', isHidden: false}])} style={ghostBtn}>+ Add Row</button>
              </div>
            )}

            {activeTab === 'MCQ' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input value={mcqPrompt} onChange={e => setMcqPrompt(e.target.value)} style={inputBox} placeholder="Question Option Evaluation Prompt" />
                <label style={{ fontSize: 12, fontWeight: 'bold' }}>Time Limit (Seconds)</label>
                <input type="number" value={mcqTimeLimit} onChange={e => setMcqTimeLimit(Number(e.target.value))} style={inputBox} placeholder="e.g. 120" />
                <p style={{fontSize: 12, color: '#94a3b8', margin: 0}}>Check the box next to correct options.</p>
                <input type="number" value={mcqTimeLimit} onChange={e => setMcqTimeLimit(Number(e.target.value))} style={inputBox} placeholder="e.g. 120" />
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

          <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: '#0f172a', padding: 20, borderRadius: 12, border: '1px solid #1e293b' }}>
              <h3 style={{ marginTop: 0, color: '#a5b4fc' }}>Queued Suite Batch ({compiledProblems.length})</h3>
              {compiledProblems.length === 0 && <p style={{color: '#64748b'}}>No problems queued.</p>}
              
              {compiledProblems.map((p, i) => (
                <div key={i} style={{ padding: '10px', background: '#1e293b', borderRadius: 4, margin: '8px 0', border: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: '14px', fontWeight: 'bold' }}>{i + 1}. {p.displayTitle}</span>
                  <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
                    <button onClick={() => moveProblem(i, 'UP')} disabled={i === 0} style={iconBtn}>↑</button>
                    <button onClick={() => moveProblem(i, 'DOWN')} disabled={i === compiledProblems.length - 1} style={iconBtn}>↓</button>
                    <button onClick={() => editProblem(i)} style={{...iconBtn, color: '#38bdf8', borderColor: '#38bdf8'}}>Edit</button>
                    <button onClick={() => removeProblem(i)} style={{...iconBtn, color: '#f87171', borderColor: '#f87171'}}>Delete</button>
                  </div>
                </div>
              ))}
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
                    {/* 👉 FIXED: Properly mapping the title into the payload so the backend doesn't overwrite it */}
                    <button onClick={() => setCompiledProblems([...compiledProblems, { type: 'URL', url: p.originalUrl, title: p.title, displayTitle: p.title }])} style={{ background: '#38bdf8', color: '#000', fontWeight: 'bold', border: 'none', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>+ Import to Mashup</button>
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
const iconBtn = { background: 'transparent', border: '1px solid #64748b', color: '#cbd5e1', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, flexDirection: 'column' as const };
const overlayModal = { background: '#0f172a', padding: 40, borderRadius: 12, border: '1px solid #38bdf8', textAlign: 'center' as const, boxShadow: '0 0 30px rgba(56, 189, 248, 0.2)' };