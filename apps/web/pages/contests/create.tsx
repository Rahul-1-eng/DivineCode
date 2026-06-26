import { CSSProperties, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import toast, { Toaster } from 'react-hot-toast';
import { fetchApi } from '../../lib/api';

export default function GlobalNavigationAndMashupCreator() {
  const router = useRouter();
  const { data: session } = useSession();
  
  const [navTab, setNavTab] = useState<'mashup' | 'duel' | 'interview'>('mashup');
  const [step, setStep] = useState(1);

  const [contestMode, setContestMode] = useState<'SOLO' | 'GROUP'>('GROUP');
  const [activeTab, setActiveTab] = useState<'URL' | 'CUSTOM' | 'MCQ'>('URL');
  const [title, setTitle] = useState('DivineCode Controlled Practice Set');
  const [duration, setDuration] = useState(120);
  const [startTimeStr, setStartTimeStr] = useState('');
  
  const [urlProblem, setUrlProblem] = useState('');
  const [generateAiTests, setGenerateAiTests] = useState(true); 
  
  const [imageBase64, setImageBase64] = useState<string>('');
  
  const [customTitle, setCustomTitle] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [customCases, setCustomCases] = useState([{ input: '', expectedOutput: '', isPublic: true }]);
  const [customTimeLimit, setCustomTimeLimit] = useState<number>(0); 
  
  const [mcqPrompt, setMcqPrompt] = useState('');
  const [mcqOptions, setMcqOptions] = useState(['', '']);
  const [mcqCorrect, setMcqCorrect] = useState<number[]>([]);
  const [mcqTimeLimit, setMcqTimeLimit] = useState(120); 
  
  const [compiledProblems, setCompiledProblems] = useState<any[]>([]);
  const [aiBank, setAiBank] = useState<any[]>([]);
  
  const [isCreating, setIsCreating] = useState(false);
  const [loadingContext, setLoadingContext] = useState('');

  useEffect(() => {
    if (!session) return;

    fetchApi('/api/v2/ai-dataset')
      .then((d: any) => {
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
  }, [session]);

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
      payload.generateAiTests = generateAiTests; 
      
    } else if (activeTab === 'CUSTOM') {
      if (!customTitle) return toast.error('Enter custom title');
      if (!customDesc) return toast.error('Enter problem description');
      const validCases = customCases.filter(c => c.input.trim() !== '' && c.expectedOutput.trim() !== '');
      if (validCases.length === 0) return toast.error('Provide at least one valid test case');
      
      payload.title = customTitle;
      payload.customData = {
          title: customTitle,
          description: customDesc,
          imageUrl: imageBase64 || null,
          testcases: validCases,
          time: customTimeLimit, 
          generateAiTests: generateAiTests 
      };
      payload.displayTitle = customTitle;
    } else if (activeTab === 'MCQ') {
      const trimmedPrompt = mcqPrompt.trim();
      const trimmedOptions = mcqOptions.map(opt => opt.trim());
      const validOptions = trimmedOptions.filter(opt => opt.length > 0);
      if (!trimmedPrompt) return toast.error('Enter MCQ question text');
      if (validOptions.length < 2) return toast.error('Provide at least two answer options');
      if (mcqCorrect.length === 0) return toast.error('Select at least one correct option');
      payload.isMCQ = true;
      payload.title = `Theory MCQ: ${trimmedPrompt.substring(0, 40)}`;
      payload.mcqTimeLimitSeconds = mcqTimeLimit;
      payload.mcqData = { prompt: trimmedPrompt, options: trimmedOptions, correctIndices: mcqCorrect, timeLimit: mcqTimeLimit };
      payload.displayTitle = payload.title;
    } else {
      return toast.error('Unknown problem type');
    }
    
    setCompiledProblems([...compiledProblems, payload]);
    setUrlProblem(''); setImageBase64(''); setCustomTitle(''); setCustomDesc(''); setCustomTimeLimit(0);
    setCustomCases([{ input: '', expectedOutput: '', isPublic: true }]);
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
    const newArr = [...compiledProblems];
    const temp = newArr[index];
    newArr[index] = newArr[direction === 'UP' ? index - 1 : index + 1];
    newArr[direction === 'UP' ? index - 1 : index + 1] = temp;
    setCompiledProblems(newArr);
  };

  const editProblem = (index: number) => {
    const p = compiledProblems[index];
    removeProblem(index); 
    setActiveTab(p.type);
    
    if (p.type === 'URL') {
        setUrlProblem(p.url);
        setGenerateAiTests(p.generateAiTests);
    }
    if (p.type === 'CUSTOM') {
      setCustomTitle(p.customData.title);
      setCustomDesc(p.customData.description);
      setCustomTimeLimit(p.customData.time || 0);
      setGenerateAiTests(p.customData.generateAiTests);
      setCustomCases(p.customData.testcases.length ? p.customData.testcases : [{ input: '', expectedOutput: '', isPublic: true }]);
    }
    if (p.type === 'MCQ') {
      setMcqPrompt(p.mcqData.prompt);
      setMcqOptions(p.mcqData.options);
      setMcqCorrect(p.mcqData.correctIndices);
      setMcqTimeLimit(p.mcqData.timeLimit);
    }
    toast("Problem loaded into editor. Make changes and append.", { icon: '✍️' });
  };

  async function createContest() {
    if (!session?.user?.email) return toast.error("Session still loading or you are not logged in.");
    if (compiledProblems.length === 0) return toast.error("Batch queue empty.");
    
    setIsCreating(true);
    setLoadingContext('Creating contest shell...');

    try {
      const contest = await fetchApi('/api/v2/contests', {
        method: 'POST',
        body: JSON.stringify({ 
          title, 
          durationMinutes: duration, 
          type: contestMode === 'SOLO' ? 'INDIVIDUAL' : 'GROUP', 
          startTime: startTimeStr ? new Date(startTimeStr).toISOString() : undefined,
          ownerEmail: session.user.email,
          ownerName: session.user.name || 'Admin',
          members: [{ 
              email: session.user.email, 
              displayName: session.user.name || 'Admin', 
              teamName: contestMode === 'GROUP' ? 'Admin Team' : 'Individuals' 
          }]
        })
      });
      
      toast.success(`Contest Created! Invite Code: ${contest.inviteCode}`, { duration: 10000 });

      let failedAny = false;

      for (let i = 0; i < compiledProblems.length; i++) {
        setLoadingContext(`Adding problem ${i + 1}/${compiledProblems.length}...`);
        try {
          await fetchApi(`/api/v2/contests/${contest.id}/problems/mashup`, {
            method: 'POST', 
            body: JSON.stringify(compiledProblems[i])
          });
        } catch (err) {
          failedAny = true;
          toast.error(`Failed to add '${compiledProblems[i].displayTitle}'`);
        }
      }
      
      if (!failedAny) toast.success("Mashup fully synchronized!");
      else toast.error("Mashup created, but some problems failed.", { duration: 6000 });
      
      router.push(`/contests/${contest.id}`);
    } catch (err: any) {
      toast.error(err.message || "Could not create contest shell.");
      setIsCreating(false);
    } 
  }

  return (
    <div style={page}>
      <Toaster />
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes pulseGlow { 0% { box-shadow: 0 0 0 0 var(--accent-glow); } 70% { box-shadow: 0 0 0 20px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}} />

      {isCreating && (
        <div style={overlay}>
          <div style={overlayModal}>
            <div style={{ width: 50, height: 50, border: '4px solid var(--border-color)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', margin: '0 auto 20px', animation: 'spin 1s linear infinite, pulseGlow 2s infinite' }} />
            <h2 style={{ color: 'var(--text-main)', marginBottom: 10 }}>Forging Mashup Array</h2>
            <p style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>{loadingContext}</p>
          </div>
        </div>
      )}

      <nav style={{ display: 'flex', gap: 15, background: 'var(--bg-panel-solid)', padding: '15px 30px', borderBottom: '1px solid var(--border-color)', overflowX: 'auto', whiteSpace: 'nowrap' }}>
        <button onClick={() => setNavTab('mashup')} style={navTab === 'mashup' ? actNav : pasNav}>Mashup Control Room</button>
        <button onClick={() => { setNavTab('duel'); router.push('/duel'); }} style={navTab === 'duel' ? actNav : pasNav}>1v1 Realtime Duel Matrix</button>
        <button onClick={() => { setNavTab('interview'); router.push('/interview'); }} style={navTab === 'interview' ? actNav : pasNav}>Interview Coding Modules</button>
      </nav>

      {navTab === 'mashup' && (
        <div style={{ maxWidth: 1000, margin: '40px auto', background: 'var(--bg-panel)', borderRadius: 16, border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
          
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-panel-solid)', flexWrap: 'wrap' }}>
            {[1, 2, 3].map(num => (
              <div key={num} onClick={() => setStep(num)} style={{ flex: '1 1 auto', padding: 20, textAlign: 'center', cursor: 'pointer', borderBottom: step === num ? '3px solid var(--accent-primary)' : '3px solid transparent', color: step === num ? 'var(--accent-primary)' : 'var(--text-muted)', fontWeight: 'bold', transition: '0.3s' }}>
                Step {num}: {num === 1 ? 'Contest Details' : num === 2 ? 'Select Problems' : 'Review & Launch'}
              </div>
            ))}
          </div>

          <div style={{ padding: 'clamp(20px, 4vw, 40px)' }}>
            <AnimatePresence mode="wait">
              {step === 1 && (
                <motion.div key="step1" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                  <h2 style={{ color: 'var(--text-main)', marginTop: 0 }}>Basic Configurations</h2>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 25, background: 'var(--bg-panel-solid)', padding: 10, borderRadius: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => setContestMode('SOLO')} style={{ flex: 1, padding: 10, borderRadius: 6, fontWeight: 'bold', border: 'none', cursor: 'pointer', background: contestMode === 'SOLO' ? 'var(--accent-primary)' : 'transparent', color: contestMode === 'SOLO' ? '#000' : 'var(--text-muted)' }}>👤 Solo Standings</button>
                    <button onClick={() => setContestMode('GROUP')} style={{ flex: 1, padding: 10, borderRadius: 6, fontWeight: 'bold', border: 'none', cursor: 'pointer', background: contestMode === 'GROUP' ? 'var(--accent-primary)' : 'transparent', color: contestMode === 'GROUP' ? '#000' : 'var(--text-muted)' }}>👥 Team Mode</button>
                  </div>
                  <label style={{ color: 'var(--text-muted)', fontWeight: 'bold' }}>Contest Title</label>
                  <input value={title} onChange={e => setTitle(e.target.value)} style={{...inputBox, marginBottom: 20}} />
                  
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 200px' }}><label style={{ color: 'var(--text-muted)', fontWeight: 'bold' }}>Duration (mins)</label><input type="number" value={duration} onChange={e => setDuration(Number(e.target.value))} style={inputBox} /></div>
                    <div style={{ flex: '1 1 200px' }}><label style={{ color: 'var(--text-muted)', fontWeight: 'bold' }}>Start Time</label><input type="datetime-local" value={startTimeStr} onChange={e => setStartTimeStr(e.target.value)} style={inputBox} /></div>
                  </div>
                  <button onClick={() => setStep(2)} style={{ ...primaryBtn, width: '100%', marginTop: 30 }}>Next: Add Problems →</button>
                </motion.div>
              )}

              {step === 2 && (
                <motion.div key="step2" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} style={{ display: 'flex', gap: 30, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 500px' }}>
                     <div style={{ display: 'flex', gap: 10, marginBottom: 20, borderBottom: '1px solid var(--border-color)', paddingBottom: 10, overflowX: 'auto' }}>
                       {['URL', 'CUSTOM', 'MCQ'].map(t => (
                         <button key={t} onClick={() => setActiveTab(t as any)} style={{ padding: '8px 16px', background: activeTab === t ? 'var(--accent-primary)' : 'var(--bg-card)', color: activeTab === t ? '#000' : 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }}>{t}</button>
                       ))}
                     </div>
                     
                     {activeTab === 'URL' && (
                       <div>
                          <input value={urlProblem} onChange={e => setUrlProblem(e.target.value)} style={inputBox} placeholder="Paste Link or Codeforces Code (e.g. 1500A)" />
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--text-muted)', marginTop: 10 }}>
                               <input type="checkbox" checked={generateAiTests} onChange={e => setGenerateAiTests(e.target.checked)} />
                               🤖 Check scraped tests AND automatically generate tougher hidden system tests via AI
                          </label>
                       </div>
                     )}
                     
                     {activeTab === 'CUSTOM' && (
                       <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                         <div>
                           <label style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 'bold' }}>Custom Problem Title</label>
                           <input placeholder="e.g. Find the Missing Integer" value={customTitle} onChange={e => setCustomTitle(e.target.value)} style={inputBox} />
                         </div>
                         <div>
                           <label style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 'bold' }}>Problem Description (Supports Markdown/HTML)</label>
                           <textarea placeholder="Describe the problem, input formats, and constraints..." value={customDesc} onChange={e => setCustomDesc(e.target.value)} style={{...inputBox, minHeight: '150px', resize: 'vertical'}} />
                         </div>
                         <div>
                           <label style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 'bold' }}>Optional Image Attachment</label>
                           <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'block', marginTop: 5, color: 'var(--text-main)' }} />
                         </div>
                         <div>
                           <label style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 'bold' }}>Time Limit (Seconds, 0 for infinite)</label>
                           <input type="number" placeholder="e.g. 120" value={customTimeLimit} onChange={e => setCustomTimeLimit(Number(e.target.value))} style={inputBox} />
                         </div>
                         
                         <h4 style={{ color: 'var(--text-muted)', margin: '10px 0 0 0' }}>Custom Test Cases</h4>
                         {customCases.map((tc, i) => (
                             <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                 <input placeholder="Input" value={tc.input} onChange={e => {
                                     const newCases = [...customCases];
                                     newCases[i].input = e.target.value;
                                     setCustomCases(newCases);
                                 }} style={{...inputBox, flex: '1 1 100px', marginTop: 0}} />
                                 <input placeholder="Expected Output" value={tc.expectedOutput} onChange={e => {
                                     const newCases = [...customCases];
                                     newCases[i].expectedOutput = e.target.value;
                                     setCustomCases(newCases);
                                 }} style={{...inputBox, flex: '1 1 100px', marginTop: 0}} />
                                 
                                 <label style={{display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)', fontSize: 12, width: '120px', cursor: 'pointer'}}>
                                     <input type="checkbox" checked={tc.isPublic} onChange={e => {
                                         const newCases = [...customCases];
                                         newCases[i].isPublic = e.target.checked;
                                         setCustomCases(newCases);
                                     }} /> Public (CPH)
                                 </label>
                                 
                                 <button onClick={() => {
                                     const newCases = customCases.filter((_, idx) => idx !== i);
                                     setCustomCases(newCases.length ? newCases : [{input: '', expectedOutput: '', isPublic: true}]);
                                 }} style={{...iconBtn, color: '#f87171', borderColor: '#f87171'}}>✕</button>
                             </div>
                         ))}
                         <button onClick={() => setCustomCases([...customCases, {input: '', expectedOutput: '', isPublic: true}])} style={{...ghostBtn, alignSelf: 'flex-start'}}>+ Add Test Case</button>
                       </div>
                     )}

                     {activeTab === 'MCQ' && (
                       <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                         <input value={mcqPrompt} onChange={e => setMcqPrompt(e.target.value)} style={inputBox} placeholder="Question Option Evaluation Prompt" />
                         <label style={{ fontSize: 12, fontWeight: 'bold', color: 'var(--text-muted)' }}>Time Limit (Seconds)</label>
                         <input type="number" value={mcqTimeLimit} onChange={e => setMcqTimeLimit(Number(e.target.value))} style={inputBox} placeholder="e.g. 120" />
                         <p style={{fontSize: 12, color: 'var(--text-muted)', margin: 0}}>Check the box next to correct options.</p>
                         {mcqOptions.map((o, idx) => (
                           <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                             <input type="checkbox" checked={mcqCorrect.includes(idx)} onChange={() => setMcqCorrect(prev => prev.includes(idx) ? prev.filter(x => x !== idx) : [...prev, idx])} style={{transform: 'scale(1.5)', cursor: 'pointer'}} />
                             <input value={o} onChange={e => { const n = [...mcqOptions]; n[idx] = e.target.value; setMcqOptions(n); }} style={{...inputBox, marginTop: 0}} placeholder={`Option ${String.fromCharCode(65+idx)}`} />
                           </div>
                         ))}
                         <button onClick={() => setMcqOptions([...mcqOptions, ''])} style={{...ghostBtn, alignSelf: 'flex-start'}}>+ Add Option</button>
                       </div>
                     )}

                     <button onClick={queueProblem} style={{ ...primaryBtn, width: '100%', marginTop: 25 }}>Append Problem</button>
                     <button onClick={() => setStep(1)} style={{ ...ghostBtn, width: '100%', marginTop: 15, color: 'var(--text-muted)', borderColor: 'var(--border-color)' }}>← Back to Details</button>
                  </div>

                  <div style={{ flex: '1 1 350px', background: 'var(--bg-panel-solid)', padding: 20, borderRadius: 12, border: '1px solid var(--border-color)' }}>
                    <h3 style={{ color: 'var(--accent-primary)', marginTop: 0 }}>Queued Batch ({compiledProblems.length})</h3>
                    {compiledProblems.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No problems added yet.</p>}
                    {compiledProblems.map((p, i) => (
                      <div key={i} style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 6, margin: '8px 0', border: '1px solid var(--border-color)' }}>
                        <span style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{i + 1}. {p.displayTitle}</span>
                        <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', marginTop: 10 }}>
                          <button onClick={() => moveProblem(i, 'UP')} disabled={i === 0} style={iconBtn}>↑</button>
                          <button onClick={() => moveProblem(i, 'DOWN')} disabled={i === compiledProblems.length - 1} style={iconBtn}>↓</button>
                          <button onClick={() => editProblem(i)} style={{...iconBtn, color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)'}}>Edit</button>
                          <button onClick={() => removeProblem(i)} style={{...iconBtn, color: '#f87171', borderColor: '#f87171'}}>✕</button>
                        </div>
                      </div>
                    ))}
                    <button onClick={() => setStep(3)} style={{ ...ghostBtn, width: '100%', marginTop: 20, background: 'var(--accent-glow)', border: '1px solid var(--accent-primary)' }}>Review Mashup →</button>
                  </div>
                </motion.div>
              )}

              {/* STEP 3: Review */}
              {step === 3 && (
                <motion.div key="step3" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} style={{ textAlign: 'center' }}>
                  <h2 style={{ color: 'var(--text-main)', marginTop: 0 }}>Final Review</h2>
                  <div style={{ background: 'var(--bg-panel-solid)', padding: 24, borderRadius: 12, display: 'inline-block', textAlign: 'left', width: '100%', maxWidth: 500, marginBottom: 30, border: '1px solid var(--border-color)', boxSizing: 'border-box' }}>
                    <p style={{ margin: '8px 0', color: 'var(--text-main)' }}><strong style={{ color: 'var(--text-muted)' }}>Title:</strong> {title}</p>
                    <p style={{ margin: '8px 0', color: 'var(--text-main)' }}><strong style={{ color: 'var(--text-muted)' }}>Mode:</strong> {contestMode}</p>
                    <p style={{ margin: '8px 0', color: 'var(--text-main)' }}><strong style={{ color: 'var(--text-muted)' }}>Duration:</strong> {duration} mins</p>
                    <p style={{ margin: '8px 0', color: 'var(--text-main)' }}><strong style={{ color: 'var(--text-muted)' }}>Total Problems:</strong> {compiledProblems.length}</p>
                  </div>
                  <br/>
                  <div style={{ display: 'flex', gap: 15, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button onClick={() => setStep(2)} style={{ ...ghostBtn }}>← Go Back</button>
                    <button onClick={createContest} style={{ background: '#10b981', color: '#fff', padding: '12px 30px', borderRadius: 8, fontWeight: 'bold', border: 'none', cursor: 'pointer', fontSize: 16 }}>Deploy Mashup Room 🚀</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}

const page: CSSProperties = { minHeight: '100vh', background: 'var(--bg-main)', color: 'var(--text-main)', fontFamily: 'sans-serif', boxSizing: 'border-box' };
const actNav: CSSProperties = { padding: '10px 15px', background: 'var(--accent-primary)', color: '#000', borderRadius: 6, fontWeight: 'bold', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' };
const pasNav: CSSProperties = { padding: '10px 15px', background: 'transparent', color: 'var(--text-muted)', borderRadius: 6, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' };
const inputBox = { width: '100%', padding: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-main)', boxSizing: 'border-box' as const, marginTop: 5, outline: 'none' };
const primaryBtn = { background: 'var(--accent-primary)', color: '#000', border: 'none', padding: '12px', borderRadius: '8px', fontWeight: 'bold' as const, cursor: 'pointer' };
const ghostBtn = { background: 'transparent', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' as const };
const iconBtn = { background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.85)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, flexDirection: 'column' as const };
const overlayModal = { background: 'var(--bg-panel-solid)', padding: 40, borderRadius: 12, border: '1px solid var(--accent-primary)', textAlign: 'center' as const, boxShadow: '0 0 30px var(--accent-glow)' };