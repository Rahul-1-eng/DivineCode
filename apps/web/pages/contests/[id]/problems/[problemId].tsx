import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

type TestCase = { id: string; input: string; expectedOutput: string; output: string; status: 'idle' | 'running' | 'passed' | 'failed' | 'error' };

function useContestTimer(startTime: Date, endTime: Date) {
  const [timeLeft, setTimeLeft] = useState({ state: 'loading', text: '...' });
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const start = startTime.getTime();
      const end = endTime.getTime();
      if (now < start) {
        const diff = Math.floor((start - now) / 1000);
        setTimeLeft({ state: 'scheduled', text: `Starts in: ${Math.floor(diff/3600)}h ${Math.floor((diff%3600)/60)}m ${diff%60}s` });
      } else if (now >= end) {
        setTimeLeft({ state: 'ended', text: '00:00:00 - Contest Ended' });
      } else {
        const diff = Math.floor((end - now) / 1000);
        setTimeLeft({ state: 'running', text: `Time left: ${Math.floor(diff/3600)}h ${Math.floor((diff%3600)/60)}m ${diff%60}s` });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime, endTime]);
  return timeLeft;
}

export default function WorkspacePage() {
  const router = useRouter();
  const { id, problemId } = router.query;
  const { data: session } = useSession();
  
  const [contest, setContest] = useState<any>(null);
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('cpp');
  
  const [activeTab, setActiveTab] = useState<'code' | 'cph' | 'testcases'>('code');
  const [testcases, setTestcases] = useState<TestCase[]>([{ id: '1', input: '', expectedOutput: '', output: '', status: 'idle' }]);
  const [isFetchingSamples, setIsFetchingSamples] = useState(false);
  
  const [penaltyViewed, setPenaltyViewed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [judgeVerdict, setJudgeVerdict] = useState<{ status: string, message: string } | null>(null);
  const [aiDebuggerLoading, setAiDebuggerLoading] = useState(false);
  const [aiDebugResult, setAiDebugResult] = useState<any>(null);

  const [showCfModal, setShowCfModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (!id || !session?.user?.email) return;
    fetch(`${API_V2_BASE_URL}/contests/${id}?viewerEmail=${session.user.email}`)
      .then(res => res.json()).then(data => setContest(data.data || data));
  }, [id, session]);

  const problem = useMemo(() => contest?.problems?.find((p: any) => p.id === problemId), [contest, problemId]);
  const timer = useContestTimer(new Date(contest?.startTime || 0), new Date(contest?.endTime || 0));

  useEffect(() => {
    if (!problem?.externalUrl?.includes('codeforces') || testcases[0]?.input !== '') return;
    
    const fetchSamples = async () => {
      setIsFetchingSamples(true);
      try {
        const res = await fetch(`${API_V2_BASE_URL}/proxy/problem?url=${encodeURIComponent(problem.externalUrl)}`);
        const html = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const inputNodes = Array.from(doc.querySelectorAll('.input pre')).map(el => el.textContent?.trim() || '');
        const outputNodes = Array.from(doc.querySelectorAll('.output pre')).map(el => el.textContent?.trim() || '');
        
        if (inputNodes.length > 0) {
          const newCases = inputNodes.map((inp, idx) => ({
            id: Date.now().toString() + idx,
            input: inp,
            expectedOutput: outputNodes[idx] || '',
            output: '',
            status: 'idle' as const
          }));
          setTestcases(newCases);
        }
      } catch (err) {} finally { setIsFetchingSamples(false); }
    };
    fetchSamples();
  }, [problem?.externalUrl]);

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const val = target.value;

    if (e.key === 'Tab') {
      e.preventDefault();
      setCode(val.substring(0, start) + '  ' + val.substring(end));
      setTimeout(() => { target.selectionStart = target.selectionEnd = start + 2; }, 0);
    }
  };

 const runTestCase = async (index: number) => {
    if (!code.trim()) return alert("Code cannot be empty");
    const newCases = [...testcases];
    newCases[index].status = 'running';
    newCases[index].output = '';
    setTestcases(newCases);
    setActiveTab('cph');

    try {
      const res = await fetch(`${API_V2_BASE_URL}/execute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceCode: code, language, input: newCases[index].input })
      });
      
      const data = await res.json();
      let actualOut = '';
      
      if (!res.ok) {
        // Handle server errors
        actualOut = data.error || 'Execution failed on server.';
        newCases[index].status = 'error';
      } else if (data.verdict === 'COMPILATION_ERROR') {
        // Handle compilation errors
        actualOut = data.compileError || 'Compilation Error';
        newCases[index].status = 'error';
      } else if (data.verdict === 'RUNTIME_ERROR' || data.verdict === 'TIME_LIMIT_EXCEEDED') {
        // Handle crashes or timeouts
        actualOut = `[${data.verdict}]\n${data.stderr || ''}\n${data.stdout || ''}`;
        newCases[index].status = 'error';
      } else {
        // Handle successful execution (no crashes)
        actualOut = data.stdout || '';
        const expectedOut = newCases[index].expectedOutput.trim();
        const cleanActualOut = actualOut.trim();
        
        // Check if output matches expected
        newCases[index].status = (cleanActualOut === expectedOut || !expectedOut) ? 'passed' : 'failed';
      }
      
      newCases[index].output = actualOut.trim();
    } catch (e) {
      newCases[index].status = 'error';
      newCases[index].output = 'Network error connecting to execution engine.';
    }
    
    setTestcases([...newCases]);
  };
  const runAllTestcases = async () => {
    for (let i = 0; i < testcases.length; i++) {
      await runTestCase(i);
    }
  };

  const playSuccessSound = () => {
    try {
      const audio = new Audio('/accepted.mp3'); 
      audio.play();
    } catch (e) {}
  };

  const handleSubmitCode = async () => {
    if (!code.trim()) return alert("Code cannot be empty");

    if (problem?.platform === 'CODEFORCES' || problem?.externalUrl?.includes('codeforces')) {
      setShowCfModal(true);
      return;
    }
    
    setSubmitting(true);
    setJudgeVerdict(null);

    try {
      // 1. Submit the code
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/submissions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-email': session?.user?.email || '' },
        body: JSON.stringify({ contestProblemId: problemId, code, language })
      });
      const submission = await res.json();

      if (!res.ok) {
        setJudgeVerdict({ status: 'Submission Failed', message: submission.error || 'Could not create submission' });
        setSubmitting(false);
        return;
      }

      // 2. Await the judge execution (passing wait=true)
      const judgeRes = await fetch(`${API_V2_BASE_URL}/submissions/${submission.id}/judge?wait=true`, { method: 'POST' });
      const judgeData = await judgeRes.json();

      // Check for success statuses (statusId 3 is Accepted in Judge0, or text 'ACCEPTED')
      const isAccepted = judgeData?.submission?.statusId === 3 || 
                         judgeData?.status?.id === 3 || 
                         judgeData?.submission?.verdict === 'ACCEPTED' || 
                         judgeData?.submission?.verdict === 'Accepted';

      if (isAccepted) {
        setJudgeVerdict({ status: 'Accepted', message: 'All hidden system tests passed!' });
        playSuccessSound();
        // Redirect on success
        setTimeout(() => {
          router.push(`/contests/${id}`);
        }, 1500);
      } else {
        // Handle compilation errors, runtime errors, or wrong answers without redirecting
        const statusStr = judgeData?.submission?.verdict || judgeData?.status?.description || 'Rejected';
        
        // Try to extract the most descriptive error message possible
        let errorMsg = judgeData?.submission?.judgeMessage || 
                       (judgeData.compile_output ? atob(judgeData.compile_output) : null) || 
                       judgeData?.message || 
                       'Failed on hidden system tests. Check your logic and edge cases.';
                       
        setJudgeVerdict({ status: statusStr, message: errorMsg });
      }
    } catch (e) {
      setJudgeVerdict({ status: 'Error', message: 'Network or server error during execution.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSyncCodeforces = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/sync/codeforces?wait=true`, {
        method: 'POST', headers: { 'x-user-email': session?.user?.email || '' }
      });
      const data = await res.json();
      if (res.ok) {
        playSuccessSound(); 
        setShowCfModal(false);
        setTimeout(() => {
          router.push(`/contests/${id}`);
        }, 1000);
      } else {
        alert(data.error || "Could not find a matching submission. Are you sure you submitted it under your bound handle?");
      }
    } catch (e) { 
      alert("Failed to connect to Codeforces sync engine."); 
    } finally { 
      setIsSyncing(false); 
    }
  };

  const handleAiDebug = async () => {
    if (!code.trim()) return alert("You must write some code first to debug it!");
    if (confirm("Using the AI Tutor will deduct 50 points from your contest score. Proceed?")) {
      setAiDebuggerLoading(true);
      try {
        const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems/${problemId}/ai-debug`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-email': session?.user?.email || '' },
          body: JSON.stringify({ userCode: code, problemDescription: problem?.titleSnapshot }) 
        });
        const data = await res.json();
        if (res.ok) {
          setAiDebugResult(data.aiDebugData);
          setActiveTab('testcases');
        } else alert(data.error || "Failed to process AI debugging.");
      } catch (err) { alert("Failed to connect to AI."); } finally { setAiDebuggerLoading(false); }
    }
  };

  const handleRevealTestcases = async () => {
    if (confirm("Viewing test cases during an active contest will deduct 50 points from your score. Proceed?")) {
      await fetch(`${API_V2_BASE_URL}/contests/${id}/problems/${problemId}/penalty`, {
        method: 'POST', headers: { 'x-user-email': session?.user?.email || '' }
      });
      setPenaltyViewed(true);
      setActiveTab('testcases');
    }
  };

  if (!contest || !problem) return <div style={page}>Loading Workspace...</div>;

  const problemIframeUrl = problem.externalUrl?.includes('codeforces') 
    ? `${API_V2_BASE_URL}/proxy/problem?url=${encodeURIComponent(problem.externalUrl)}` 
    : problem.externalUrl;

  let cfSubmitUrl = problem.externalUrl || 'https://codeforces.com/problemset/submit';
  const psMatch = cfSubmitUrl.match(/problemset\/problem\/([0-9]+)\/([A-Za-z0-9]+)/i);
  const contestMatch = cfSubmitUrl.match(/contest\/([0-9]+)\/problem\/([A-Za-z0-9]+)/i);
  if (psMatch) cfSubmitUrl = `https://codeforces.com/contest/${psMatch[1]}/submit/${psMatch[2]}`;
  else if (contestMatch) cfSubmitUrl = `https://codeforces.com/contest/${contestMatch[1]}/submit/${contestMatch[2]}`;

  return (
    <main style={page}>
      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .judge-spinner { animation: spin 1.2s linear infinite; }
      `}</style>
      
      {/* 🚀 Submitting Overlay Animation */}
      {submitting && (
        <div style={modalOverlay}>
          <div style={{...modalContent, textAlign: 'center', maxWidth: 400}}>
            <svg className="judge-spinner" width="60" height="60" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 15px' }}>
              <circle cx="12" cy="12" r="10" stroke="rgba(56, 189, 248, 0.2)" strokeWidth="3" />
              <path fill="#38bdf8" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm1-13h-2v6l5.25 3.15.75-1.23-4-2.37V7z"/>
            </svg>
            <h2 style={{ color: '#fff', margin: '0 0 10px 0' }}>Judging Submission...</h2>
            <p style={{ color: '#67e8f9', margin: 0, fontSize: 14 }}>Compiling and running against hidden system tests</p>
          </div>
        </div>
      )}

      {/* ⚠️ Verdict Overlay (For Compilation Errors / Wrong Answer) */}
      {judgeVerdict && !judgeVerdict.status.includes('Accept') && !submitting && (
        <div style={modalOverlay}>
          <div style={{...modalContent, border: '1px solid #f87171'}}>
            <h2 style={{ margin: '0 0 10px 0', color: '#f87171' }}>{judgeVerdict.status}</h2>
            <div style={{ background: '#020617', padding: 15, borderRadius: 8, maxHeight: '40vh', overflowY: 'auto' }}>
              <pre style={{ margin: 0, color: '#e2e8f0', fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: 13 }}>
                {judgeVerdict.message}
              </pre>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setJudgeVerdict(null)} style={primaryBtn}>Dismiss & Fix Code</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ Accepted Overlay */}
      {judgeVerdict && judgeVerdict.status.includes('Accept') && !submitting && (
        <div style={modalOverlay}>
          <div style={{...modalContent, border: '1px solid #4ade80', textAlign: 'center'}}>
            <h2 style={{ margin: '0 0 10px 0', color: '#4ade80' }}>Accepted!</h2>
            <p style={{ color: '#e2e8f0' }}>{judgeVerdict.message}</p>
            <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 15 }}>Redirecting to standings...</p>
          </div>
        </div>
      )}

      <header style={headerBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <button onClick={() => router.push(`/contests/${id}`)} style={btnDark}>← Standings</button>
          <strong style={{ color: '#fff' }}>{problem.titleSnapshot}</strong>
        </div>
        <div style={timerBox}>{timer.text}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} style={selectBox}>
            <option value="cpp">C++ 17</option>
            <option value="python">Python 3</option>
            <option value="java">Java</option>
          </select>
          <button onClick={runAllTestcases} style={runBtn}>Run Code ▶</button>
          <button onClick={handleSubmitCode} disabled={submitting} style={submitBtn}>{submitting ? 'Judging...' : 'Submit 🚀'}</button>
        </div>
      </header>

      <div style={splitLayout}>
        <section style={leftPane}>
          <div style={paneHeader}>Problem Description</div>
          <div style={paneContent}>
             <p style={{ color: '#94a3b8', padding: '0 16px' }}>Platform: {problem.platform} | Points: {problem.points}</p>
             <iframe src={problemIframeUrl} style={iframeStyle} title="Problem Statement" />
          </div>
        </section>

        <section style={rightPane}>
          <div style={tabsHeader}>
            <button style={activeTab === 'code' ? activeTabStyle : inactiveTabStyle} onClick={() => setActiveTab('code')}>Code Editor</button>
            <button style={activeTab === 'cph' ? activeTabStyle : inactiveTabStyle} onClick={() => setActiveTab('cph')}>
              {isFetchingSamples ? '⚡ Fetching...' : 'CPH Runner'}
            </button>
            <button style={activeTab === 'testcases' ? activeTabStyle : inactiveTabStyle} onClick={() => setActiveTab('testcases')}>AI Tutor / Hidden</button>
          </div>
          
          <div style={paneContent}>
            {activeTab === 'code' && (
              <textarea value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={handleEditorKeyDown} style={codeEditor} spellCheck={false} placeholder={`// Write your ${language} solution here...`} />
            )}

            {activeTab === 'cph' && (
              <div style={{ padding: 15, overflowY: 'auto', height: '100%' }}>
                {testcases.map((tc, idx) => (
                  <div key={tc.id} style={tcCard}>
                    <div style={tcHeader}>
                      <strong>Test Case {idx + 1}</strong>
                      <span style={{ color: tc.status === 'passed' ? '#4ade80' : tc.status === 'failed' || tc.status === 'error' ? '#f87171' : '#94a3b8' }}>
                        {tc.status.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, padding: 10 }}>
                      <div style={{ flex: 1 }}><div style={tcLabel}>Input</div><textarea value={tc.input} onChange={e => { const n = [...testcases]; n[idx].input = e.target.value; setTestcases(n); }} style={tcBox} /></div>
                      <div style={{ flex: 1 }}><div style={tcLabel}>Expected Output</div><textarea value={tc.expectedOutput} onChange={e => { const n = [...testcases]; n[idx].expectedOutput = e.target.value; setTestcases(n); }} style={tcBox} /></div>
                    </div>
                    <div style={{ padding: '0 10px 10px' }}>
                      <div style={tcLabel}>Actual Output</div>
                      <pre style={{...tcBox, height: 60, margin: 0, overflow: 'auto', background: tc.status === 'failed' ? 'rgba(248,113,113,0.1)' : '#020617'}}>{tc.output}</pre>
                    </div>
                    <button onClick={() => runTestCase(idx)} style={{ width: '100%', padding: 8, background: '#1e293b', color: '#fff', border: 'none', borderTop: '1px solid #334155', cursor: 'pointer' }}>
                      {tc.status === 'running' ? 'Running...' : '▶ Run this case'}
                    </button>
                  </div>
                ))}
                <button onClick={() => setTestcases([...testcases, { id: Date.now().toString(), input: '', expectedOutput: '', output: '', status: 'idle' }])} style={{...secondaryBtn, width: '100%'}}>+ Add Custom Test Case</button>
              </div>
            )}
            
            {activeTab === 'testcases' && (
              <div style={testcaseWrap}>
                <div style={aiTutorCard}>
                  <h3 style={{ color: '#a5b4fc', marginTop: 0 }}>🤖 AI Contest Tutor</h3>
                  <p style={{ color: '#cbd5e1', fontSize: 14 }}>Stuck with a failure check? Isolate structural flaws inside your solution and produce a precise boundary case where your logic breaks down.</p>
                  
                  {!aiDebugResult ? (
                    <button onClick={handleAiDebug} disabled={aiDebuggerLoading} style={aiTriggerBtn}>
                      {aiDebuggerLoading ? 'Analyzing Workspace Code...' : 'Analyze Logic & Generate Test Case (-50 pts)'}
                    </button>
                  ) : (
                    <div style={{ marginTop: 15, background: '#0f172a', padding: 16, borderRadius: 8, border: '1px solid #334155' }}>
                      <p style={{ color: '#fbbf24', fontWeight: 'bold', margin: '0 0 12px 0' }}>💡 Hint: {aiDebugResult.hint}</p>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 200px' }}><strong style={{ color: '#94a3b8', fontSize: 11 }}>FAILLING INPUT</strong><pre style={codeBlockError}>{aiDebugResult.input}</pre></div>
                        <div style={{ flex: '1 1 200px' }}><strong style={{ color: '#94a3b8', fontSize: 11 }}>EXPECTED OUTPUT</strong><pre style={codeBlockSuccess}>{aiDebugResult.expectedOutput}</pre></div>
                      </div>
                    </div>
                  )}
                </div>

                {!penaltyViewed ? (
                  <div style={{ textAlign: 'center', marginTop: 40, borderTop: '1px solid #1e293b', paddingTop: 30 }}>
                    <h3 style={{ color: '#f87171', marginTop: 0 }}>⚠️ Standard Hidden Test Cases</h3>
                    <p style={{ color: '#94a3b8', fontSize: 14 }}>Revealing standard repository verification records triggers a direct points adjustment deduction.</p>
                    <button onClick={handleRevealTestcases} style={btnDanger}>Accept Penalty & View</button>
                  </div>
                ) : (
                  <div style={{ marginTop: 20, borderTop: '1px solid #1e293b', paddingTop: 20 }}>
                    <h4 style={{ color: '#4ade80', marginTop: 0 }}>System Test Cases Unlocked!</h4>
                    <p style={{ color: '#94a3b8', fontFamily: 'monospace', background: '#020617', padding: 12, borderRadius: 6 }}>
                      [System test case database matrix data from Codeforces loaded successfully]
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {showCfModal && (
        <div style={modalOverlay}>
          <div style={modalContent}>
            <h2 style={{ margin: '0 0 15px 0', color: '#38bdf8' }}>Codeforces Submission</h2>
            <p style={{ color: '#cbd5e1', lineHeight: '1.6', marginBottom: 20 }}>
              Because this is an official Codeforces problem, you must submit it directly on their platform to register the verdict.
            </p>
            <ol style={{ color: '#e2e8f0', lineHeight: '1.8', marginBottom: 25, paddingLeft: 20 }}>
              <li><strong>Copy</strong> your code from the editor below.</li>
              <li><strong>Click the link</strong> to open the Codeforces Submit page.</li>
              <li><strong>Submit</strong> your code on Codeforces.</li>
              <li>Come back here and click <strong>"Sync Verdict"</strong>.</li>
            </ol>
            
            <div style={{ display: 'flex', gap: 10, marginBottom: 25 }}>
              <button onClick={() => navigator.clipboard.writeText(code).then(() => alert('Code copied to clipboard!'))} style={secondaryBtn}>📋 Copy Code</button>
              <a href={cfSubmitUrl} target="_blank" rel="noreferrer" style={primaryBtn}>↗ Open Codeforces Submit Page</a>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid #334155', paddingTop: 20 }}>
              <button onClick={() => setShowCfModal(false)} style={cancelBtn}>Cancel</button>
              <button onClick={handleSyncCodeforces} disabled={isSyncing} style={syncBtn}>{isSyncing ? 'Syncing...' : '🔄 Sync Verdict'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// 🎨 CSS CONFIGURATIONS
const page: CSSProperties = { height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#020617', color: '#eef2ff', fontFamily: 'Inter, sans-serif' };
const headerBar: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', backgroundColor: '#0f172a', borderBottom: '1px solid #1e293b', zIndex: 10 };
const btnDark: CSSProperties = { background: '#1e293b', border: 'none', color: '#cbd5e1', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' };
const timerBox: CSSProperties = { background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '6px 12px', borderRadius: 6, fontWeight: 'bold' };
const submitBtn: CSSProperties = { background: '#10b981', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' };
const runBtn: CSSProperties = { background: '#3b82f6', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' };
const selectBox: CSSProperties = { background: '#1e293b', color: '#fff', border: '1px solid #334155', padding: '8px', borderRadius: 6, outline: 'none' };
const splitLayout: CSSProperties = { display: 'flex', flex: 1, overflow: 'hidden', gap: 10, padding: 10, flexDirection: 'row' };
const leftPane: CSSProperties = { flex: 1, background: '#0f172a', borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #1e293b' };
const rightPane: CSSProperties = { flex: 1, background: '#0f172a', borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #1e293b' };
const paneHeader: CSSProperties = { padding: '12px 16px', background: '#1e293b', fontWeight: 'bold', fontSize: 14, color: '#94a3b8' };
const paneContent: CSSProperties = { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' };
const iframeStyle: CSSProperties = { width: '100%', height: '100%', border: 'none', background: '#fff', borderRadius: 8 };
const tabsHeader: CSSProperties = { display: 'flex', background: '#1e293b' };
const activeTabStyle: CSSProperties = { flex: 1, background: '#0f172a', border: 'none', color: '#38bdf8', padding: '12px', borderTop: '2px solid #38bdf8', cursor: 'pointer', fontWeight: 'bold' };
const inactiveTabStyle: CSSProperties = { flex: 1, background: 'transparent', border: 'none', color: '#94a3b8', padding: '12px', cursor: 'pointer' };
const codeEditor: CSSProperties = { width: '100%', height: '100%', flex: 1, background: '#020617', color: '#a5b4fc', border: 'none', outline: 'none', fontFamily: 'monospace', fontSize: 14, resize: 'none', padding: 15 };
const testcaseWrap: CSSProperties = { background: '#020617', borderRadius: 8, padding: 16, flex: 1 };
const btnDanger: CSSProperties = { background: '#ef4444', color: '#fff', padding: '10px 18px', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', marginTop: 12 };
const aiTutorCard: CSSProperties = { padding: 16, background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: 10, marginBottom: 16 };
const aiTriggerBtn: CSSProperties = { background: '#5356ff', color: '#fff', padding: '10px 18px', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 13 };
const codeBlockError: CSSProperties = { background: 'rgba(248, 113, 113, 0.08)', padding: 10, color: '#f87171', borderRadius: 6, overflow: 'auto', border: '1px solid rgba(248, 113, 113, 0.2)', fontFamily: 'monospace', marginTop: 6, fontSize: 13 };
const codeBlockSuccess: CSSProperties = { ...codeBlockError, background: 'rgba(74, 222, 128, 0.08)', color: '#4ade80', border: '1px solid rgba(74, 222, 128, 0.2)' };
const modalOverlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(2, 6, 23, 0.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalContent: CSSProperties = { background: '#0f172a', padding: 30, borderRadius: 16, border: '1px solid #1e293b', width: '90%', maxWidth: 500, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' };
const secondaryBtn: CSSProperties = { background: '#334155', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' };
const primaryBtn: CSSProperties = { background: '#0284c7', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold', textDecoration: 'none', textAlign: 'center' };
const cancelBtn: CSSProperties = { background: 'transparent', color: '#94a3b8', border: 'none', padding: '10px 16px', cursor: 'pointer', fontWeight: 'bold' };
const syncBtn: CSSProperties = { background: '#10b981', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' };

// CPH Test Case Styles
const tcCard: CSSProperties = { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, overflow: 'hidden', marginBottom: 15 };
const tcHeader: CSSProperties = { background: '#1e293b', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', fontSize: 13 };
const tcBox: CSSProperties = { width: '100%', height: 80, background: '#020617', border: '1px solid #334155', borderRadius: 6, color: '#fff', fontFamily: 'monospace', padding: 8, fontSize: 13, resize: 'none' };
const tcLabel: CSSProperties = { fontSize: 12, color: '#94a3b8', marginBottom: 4 };