import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

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
  
  // 👉 NEW: Custom Input & Execution States
  const [activeTab, setActiveTab] = useState<'code' | 'customInput' | 'testcases'>('code');
  const [customInput, setCustomInput] = useState('');
  const [runResult, setRunResult] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);
  
  const [penaltyViewed, setPenaltyViewed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [aiDebuggerLoading, setAiDebuggerLoading] = useState(false);
  const [aiDebugResult, setAiDebugResult] = useState<any>(null);

  useEffect(() => {
    if (!id || !session?.user?.email) return;
    fetch(`${API_V2_BASE_URL}/contests/${id}?viewerEmail=${session.user.email}`)
      .then(res => res.json()).then(data => setContest(data.data || data));
  }, [id, session]);

  const problem = useMemo(() => contest?.problems?.find((p: any) => p.id === problemId), [contest, problemId]);
  const timer = useContestTimer(new Date(contest?.startTime || 0), new Date(contest?.endTime || 0));

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
    const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
    if (pairs[e.key]) {
      e.preventDefault();
      setCode(val.substring(0, start) + e.key + pairs[e.key] + val.substring(end));
      setTimeout(() => { target.selectionStart = target.selectionEnd = start + 1; }, 0);
    }
  };

  // 👉 NEW: Run Code Function (Executes without submitting to leaderboard)
  const handleRunCode = async () => {
    if (!code.trim()) return alert("Code cannot be empty");
    setIsRunning(true);
    setActiveTab('customInput'); // Switch to results view automatically
    try {
      const res = await fetch(`${API_V2_BASE_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceCode: code, language, input: customInput })
      });
      const data = await res.json();
      setRunResult(data);
    } catch (e) {
      alert("Execution failed to connect to Judge.");
    } finally {
      setIsRunning(false);
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

  const handleSubmitCode = async () => {
    if (!code.trim()) return alert("Code cannot be empty");
    setSubmitting(true);
    try {
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-email': session?.user?.email || '' },
        body: JSON.stringify({ contestProblemId: problemId, code, language })
      });
      const submission = await res.json();
      await fetch(`${API_V2_BASE_URL}/submissions/${submission.id}/judge`, { method: 'POST' });
      alert("Code submitted successfully! Check standings for verdict.");
      router.push(`/contests/${id}`);
    } catch (e) {
      alert("Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAiDebug = async () => {
    if (!code.trim()) return alert("You must write some code first to debug it!");
    if (confirm("Using the AI Tutor will deduct 50 points from your contest score. Proceed?")) {
      setAiDebuggerLoading(true);
      try {
        const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems/${problemId}/ai-debug`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-email': session?.user?.email || '' },
          body: JSON.stringify({ userCode: code, problemDescription: problem?.titleSnapshot }) 
        });
        const data = await res.json();
        if (res.ok) {
          setAiDebugResult(data.aiDebugData);
          setActiveTab('testcases');
        } else {
          alert(data.error || "Failed to process AI debugging.");
        }
      } catch (err) { alert("Failed to connect to AI."); } finally { setAiDebuggerLoading(false); }
    }
  };

  if (!contest || !problem) return <div style={page}>Loading Workspace...</div>;

  // 👉 PROXY URL to bypass X-Frame-Options
  const problemIframeUrl = problem.externalUrl?.includes('codeforces') 
    ? `${API_V2_BASE_URL}/proxy/problem?url=${encodeURIComponent(problem.externalUrl)}` 
    : problem.externalUrl;

  return (
    <main style={page}>
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
          {/* 👉 NEW: Run Code Button */}
          <button onClick={handleRunCode} disabled={isRunning} style={runBtn}>
            {isRunning ? 'Running...' : 'Run Code ▶'}
          </button>
          <button onClick={handleSubmitCode} disabled={submitting} style={submitBtn}>
            {submitting ? 'Submitting...' : 'Submit 🚀'}
          </button>
        </div>
      </header>

      <div style={splitLayout}>
        <section style={leftPane}>
          <div style={paneHeader}>Problem Description</div>
          <div style={paneContent}>
             <p style={{ color: '#94a3b8' }}>Platform: {problem.platform} | Points: {problem.points}</p>
             <iframe src={problemIframeUrl} style={iframeStyle} title="Problem Statement" />
          </div>
        </section>

        <section style={rightPane}>
          <div style={tabsHeader}>
            <button style={activeTab === 'code' ? activeTabStyle : inactiveTabStyle} onClick={() => setActiveTab('code')}>Code Editor</button>
            <button style={activeTab === 'customInput' ? activeTabStyle : inactiveTabStyle} onClick={() => setActiveTab('customInput')}>Custom Input (Run)</button>
            <button style={activeTab === 'testcases' ? activeTabStyle : inactiveTabStyle} onClick={() => setActiveTab('testcases')}>Test Cases / Debug</button>
          </div>
          
          <div style={paneContent}>
            {activeTab === 'code' && (
              <textarea value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={handleEditorKeyDown} style={codeEditor} spellCheck={false} placeholder={`// Write your ${language} solution here...`} />
            )}

            {/* 👉 NEW: Custom Input Tab */}
            {activeTab === 'customInput' && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
                <strong style={{ color: '#94a3b8' }}>Custom Input:</strong>
                <textarea 
                  value={customInput} 
                  onChange={e => setCustomInput(e.target.value)} 
                  placeholder="Paste custom input or CPH test cases here..."
                  style={{ ...codeEditor, flex: 0.5, border: '1px solid #334155', borderRadius: 8 }} 
                />
                
                <strong style={{ color: '#94a3b8' }}>Execution Result:</strong>
                <div style={{ flex: 0.5, background: '#020617', border: '1px solid #334155', borderRadius: 8, padding: 10, overflow: 'auto', fontFamily: 'monospace' }}>
                  {isRunning ? <span style={{ color: '#fbbf24' }}>Running code on Judge0...</span> : 
                   runResult ? (
                    <>
                      <div style={{ color: runResult.status?.id === 3 ? '#4ade80' : '#f87171', fontWeight: 'bold', marginBottom: 10 }}>
                        Verdict: {runResult.status?.description || 'Error'}
                      </div>
                      {runResult.compile_output && <><div style={{ color: '#f87171' }}>Compile Output:</div><pre>{atob(runResult.compile_output)}</pre></>}
                      {runResult.stdout && <><div style={{ color: '#94a3b8' }}>Standard Output:</div><pre style={{ color: '#fff' }}>{atob(runResult.stdout)}</pre></>}
                      {runResult.stderr && <><div style={{ color: '#f87171' }}>Standard Error:</div><pre>{atob(runResult.stderr)}</pre></>}
                      <div style={{ color: '#64748b', fontSize: 12, marginTop: 10 }}>Time: {runResult.time}s | Memory: {runResult.memory}KB</div>
                    </>
                   ) : <span style={{ color: '#64748b' }}>Click "Run Code" to see results here.</span>
                  }
                </div>
              </div>
            )}
            
            {activeTab === 'testcases' && (
              <div style={testcaseWrap}>
                <div style={aiTutorCard}>
                  <h3 style={{ color: '#a5b4fc', marginTop: 0 }}>🤖 AI Contest Tutor</h3>
                  <p style={{ color: '#cbd5e1', fontSize: 14 }}>Stuck with a failure check? The AI assistant can isolate structural flaws inside your solution and produce a precise boundary case where your logic breaks down.</p>
                  
                  {!aiDebugResult ? (
                    <button onClick={handleAiDebug} disabled={aiDebuggerLoading} style={aiTriggerBtn}>
                      {aiDebuggerLoading ? 'Analyzing Workspace Code...' : 'Analyze Logic & Generate Test Case (-50 pts)'}
                    </button>
                  ) : (
                    <div style={{ marginTop: 15, background: '#0f172a', padding: 16, borderRadius: 8, border: '1px solid #334155' }}>
                      <p style={{ color: '#fbbf24', fontWeight: 'bold', margin: '0 0 12px 0' }}>💡 Hint: {aiDebugResult.hint}</p>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 200px' }}><strong style={{ color: '#94a3b8', fontSize: 11 }}>FAILING INPUT</strong><pre style={codeBlockError}>{aiDebugResult.input}</pre></div>
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
const paneContent: CSSProperties = { flex: 1, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column' };
const iframeStyle: CSSProperties = { width: '100%', height: '100%', border: 'none', background: '#fff', borderRadius: 8 };
const tabsHeader: CSSProperties = { display: 'flex', background: '#1e293b' };
const activeTabStyle: CSSProperties = { flex: 1, background: '#0f172a', border: 'none', color: '#38bdf8', padding: '12px', borderTop: '2px solid #38bdf8', cursor: 'pointer', fontWeight: 'bold' };
const inactiveTabStyle: CSSProperties = { flex: 1, background: 'transparent', border: 'none', color: '#94a3b8', padding: '12px', cursor: 'pointer' };
const codeEditor: CSSProperties = { width: '100%', height: '100%', flex: 1, background: '#020617', color: '#a5b4fc', border: 'none', outline: 'none', fontFamily: 'monospace', fontSize: 14, resize: 'none', lineHeight: '1.6', padding: 8 };
const testcaseWrap: CSSProperties = { background: '#020617', borderRadius: 8, padding: 16, flex: 1 };
const btnDanger: CSSProperties = { background: '#ef4444', color: '#fff', padding: '10px 18px', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', marginTop: 12 };
const aiTutorCard: CSSProperties = { padding: 16, background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: 10, marginBottom: 16 };
const aiTriggerBtn: CSSProperties = { background: '#5356ff', color: '#fff', padding: '10px 18px', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 13 };
const codeBlockError: CSSProperties = { background: 'rgba(248, 113, 113, 0.08)', padding: 10, color: '#f87171', borderRadius: 6, overflow: 'auto', border: '1px solid rgba(248, 113, 113, 0.2)', fontFamily: 'monospace', marginTop: 6, fontSize: 13 };
const codeBlockSuccess: CSSProperties = { ...codeBlockError, background: 'rgba(74, 222, 128, 0.08)', color: '#4ade80', border: '1px solid rgba(74, 222, 128, 0.2)' };