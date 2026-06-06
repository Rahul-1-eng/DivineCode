import { CSSProperties, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import toast, { Toaster } from 'react-hot-toast';

export async function getServerSideProps() { return { props: {} }; }

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

const starter = `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    // write your solution here\n    return 0;\n}\n`;

function viewerQuery(session: any) {
  const query = new URLSearchParams();
  if (session?.user?.email) query.set('viewerEmail', session.user.email);
  if (session?.user?.name) query.set('viewerName', session.user.name);
  return query.toString() ? `?${query.toString()}` : '';
}

function viewerHeaders(session: any) {
  return {
    'Content-Type': 'application/json',
    'x-user-email': session?.user?.email || '',
    'x-user-name': session?.user?.name || ''
  };
}

export default function SubmitPage() {
  const router = useRouter();
  const { contestId, problemId } = router.query;
  const { data: session, status } = useSession();
  
  const [contest, setContest] = useState<any>(null);
  const [problem, setProblem] = useState<any>(null);
  
  const [language, setLanguage] = useState('cpp');
  const [code, setCode] = useState(starter);
  
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [mcqData, setMcqData] = useState<any>(null);

  const [soundEnabled, setSoundEnabled] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [verdict, setVerdict] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);

  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState('');
  const [testError, setTestError] = useState('');
  const [executing, setExecuting] = useState(false);
  const [activeTab, setActiveTab] = useState<'input' | 'output' | 'submit'>('input');
  
  const [unlockedCase, setUnlockedCase] = useState<any>(null);

  useEffect(() => {
    if (!contestId || status === 'loading') return;
    fetch(`${API_V2_BASE_URL}/contests/${contestId}${viewerQuery(session)}`)
      .then((r) => r.json())
      .then((data) => { 
        setContest(data); 
        setProblem(data.problems?.find((p: any) => p.id === problemId)); 
      })
      .catch(() => null);
  }, [contestId, problemId, session?.user?.email, session?.user?.name, status]);

  const isCodeforces = problem?.platform?.toLowerCase?.().includes('codeforces');
  const isMCQ = problem?.platform === 'Interview MCQ';
  const requiresRedirect = problem?.requiresRedirect === true; 
  const canSeeProblemMeta = Boolean(contest?.visibility?.canSeeProblemMeta);
  const problemIndex = Math.max(0, (contest?.problems || []).findIndex((p: any) => p.id === problem?.id));
  const problemLabel = problem ? String.fromCharCode(65 + problemIndex) : '';

  useEffect(() => {
    if (isMCQ && problem?.interviewQuestionId) {
      fetch(`${API_V2_BASE_URL}/interview/questions`)
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data)) {
            setMcqData(data.find(q => q.id === problem.interviewQuestionId));
          }
        });
    }
  }, [isMCQ, problem]);

  const playSuccessSound = () => {
    if (soundEnabled && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => null);
    }
  };

  async function runCustomTest() {
    setExecuting(true);
    setActiveTab('output');
    setTestOutput('Running code in backend sandbox...');
    setTestError('');
    
    try {
      const res = await fetch(`${API_V2_BASE_URL}/execute`, {
        method: 'POST',
        headers: viewerHeaders(session),
        body: JSON.stringify({ sourceCode: code, language, input: testInput || '' })
      });
      const data = await res.json();
      
      if (!res.ok) {
        setTestError(data.error || 'Execution failed on server.');
      } else if (data.verdict === 'COMPILATION_ERROR') {
        setTestError(data.compileError || 'Compilation Error');
      } else if (data.verdict === 'RUNTIME_ERROR' || data.verdict === 'TIME_LIMIT_EXCEEDED') {
        setTestError(`[${data.verdict}]\n${data.stderr || ''}\n${data.stdout || ''}`);
      } else {
        setTestOutput(data.stdout || 'Executed successfully with no output.');
        playSuccessSound();
      }
    } catch (e) {
      setTestError('Network error connecting to backend execution engine.');
    } finally {
      setExecuting(false);
    }
  }

  async function unlockHiddenTestCase() {
    if (!confirm("This will deduct 50 points from your group score and individual standing. Proceed?")) return;
    
    try {
      const res = await fetch(`${API_V2_BASE_URL}/contests/${contestId}/problems/${problemId}/unlock-testcase`, {
        method: 'POST',
        headers: viewerHeaders(session)
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error || "Failed to unlock test case");
      
      setUnlockedCase(data.testcase);
      toast.success("Hidden test case unlocked! 50 points deducted.");
    } catch (e) {
      toast.error("Network error");
    }
  }

  async function submitCode() {
    if (!session?.user?.email) return alert('Sign in first');
    if (!contest || !problem) return alert('Contest problem not loaded');
    const member = contest.viewerMember;
    if (!member && !contest?.canManage) return alert('Only registered contest players can submit.');
    
    if (isMCQ && selectedOption === null) return alert('Please select an answer option first.');

    setSubmitting(true);
    setVerdict(null);
    
    const finalLanguage = isMCQ ? 'mcq' : language;
    const finalCode = isMCQ ? String(selectedOption) : code;

    try {
      const res = await fetch(`${API_V2_BASE_URL}/contests/${contestId}/submissions`, {
        method: 'POST',
        headers: viewerHeaders(session),
        body: JSON.stringify({ code: finalCode, language: finalLanguage, contestProblemId: problemId })
      });
      const submissionData = await res.json();
      
      if (submissionData.status === 'REDIRECT_REQUIRED' || submissionData.redirectUrl) {
         setSubmitting(false);
         setVerdict({ verdict: 'Redirected', message: 'Problem requires submission on the original platform.'});
         window.open(submissionData.redirectUrl || problem.externalUrl, '_blank');
         return;
      }
      
      if (!res.ok) {
        setSubmitting(false);
        setVerdict({ verdict: 'Rejected', message: submissionData.error || 'Could not create submission' });
        return;
      }
      
      const judgeRes = await fetch(`${API_V2_BASE_URL}/submissions/${submissionData.id}/judge?wait=true`, {
        method: 'POST',
        headers: viewerHeaders(session)
      });
      const data = await judgeRes.json();
      setSubmitting(false);
      
      if (!judgeRes.ok) {
        setVerdict({ verdict: 'Judge Error', message: data.error || 'Could not judge submission' });
        return;
      }

      const sub = data.submission;
      const finalVerdict = sub?.verdict || 'Finished';
      const detailedMsg = sub?.judgeMessage || 'Judged';
      
      setVerdict({ verdict: finalVerdict, message: detailedMsg, testResults: data.testResults });

      if (finalVerdict === 'ACCEPTED' || finalVerdict === 'Accepted') {
        playSuccessSound();
      }
    } catch (err) {
      setSubmitting(false);
      setVerdict({ verdict: 'Error', message: 'Failed to connect to judge.' });
    }
  }

  if (status === 'loading') return <main style={page}>Checking account...</main>;
  if (!session) return <main style={page}><section style={panel}><h1>Sign in required</h1><a href="/signin" style={primaryLink}>Sign in</a></section></main>;

  return (
    <main style={page}>
      <Toaster position="top-center" toastOptions={{ style: { background: '#1e293b', color: '#fff', border: '1px solid #475569' } }} />
      <audio ref={audioRef} src="/accepted.mp3" preload="auto" />

      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .judge-spinner { animation: spin 1.2s linear infinite; }
        .problem-statement-html pre { background: #020617; padding: 12px; border-radius: 8px; border: 1px solid #334155; overflow-x: auto; }
        .problem-statement-html code { font-family: monospace; color: #38bdf8; }
        .problem-statement-html h3 { color: #a5b4fc; border-bottom: 1px solid #1e293b; padding-bottom: 8px; }
      `}</style>

      {submitting && (
        <div style={overlay}>
          <div style={overlayModal}>
            <svg className="judge-spinner" width="50" height="50" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 15px', display: 'block' }}>
              <circle cx="12" cy="12" r="10" stroke="rgba(103,232,249, 0.2)" strokeWidth="3" />
              <path fill="#67e8f9" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm1-13h-2v6l5.25 3.15.75-1.23-4-2.37V7z"/>
            </svg>
            <h2 style={{ color: '#fff', margin: '0 0 10px 0' }}>{isMCQ ? 'Grading Answer...' : 'Judging against 100+ tests...'}</h2>
            <p style={{ color: '#67e8f9', margin: 0, fontSize: 14 }}>Evaluating sequential test suite</p>
          </div>
        </div>
      )}

      <nav style={nav}>
        <a href={contestId ? `/contests/${contestId}` : '/contests'} style={brand}>← Back to Contest Hub</a>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={() => setSoundEnabled(!soundEnabled)} style={soundBtn}>
            {soundEnabled ? '🔊 Sound On' : '🔇 Muted'}
          </button>
          <div style={userPill}>{session.user?.name || session.user?.email}</div>
        </div>
      </nav>

      {/* SPLIT SCREEN LAYOUT */}
      <section style={splitLayout}>
        
        {/* LEFT PANEL: PROBLEM DESCRIPTION (HTML OR BROWSER WINDOW) */}
        <aside style={leftPanelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
             <div>
                <p style={eyebrow}>{requiresRedirect ? 'External Problem' : isCodeforces ? 'External Verified' : isMCQ ? 'Theory' : 'DivineCode Local'}</p>
                <h1 style={{ margin: '10px 0', fontSize: 26, color: '#eef2ff' }}>
                  {canSeeProblemMeta ? problem?.title || 'Loading problem...' : `Problem ${problemLabel}`}
                </h1>
                <p style={{ color: '#94a3b8', margin: '0 0 20px 0', fontSize: 14 }}>Platform: {problem?.platform}</p>
             </div>
             
             {!isMCQ && (
               <div style={{ padding: '10px 15px', background: 'rgba(245, 158, 11, 0.1)', border: '1px dashed #f59e0b', borderRadius: 8, textAlign: 'center' }}>
                 <p style={{ fontSize: 12, color: '#fcd34d', margin: '0 0 8px 0', fontWeight: 'bold' }}>🔒 Stuck on a bug?</p>
                 <button onClick={unlockHiddenTestCase} style={{ background: '#f59e0b', color: '#000', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 12, transition: '0.2s' }}>
                   Unlock Testcase (-50 Pts)
                 </button>
               </div>
             )}
          </div>

          {/* UNLOCKED TESTCASE DISPLAY */}
          {unlockedCase && (
            <div style={{ padding: 15, background: '#1e293b', border: '1px solid #38bdf8', borderRadius: 8, marginBottom: 15 }}>
              <h4 style={{ color: '#38bdf8', margin: '0 0 10px 0' }}>🔓 Unlocked Hidden Testcase</h4>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: '0 0 5px 0', fontSize: 12, color: '#94a3b8' }}>Input</p>
                  <pre style={{ margin: 0, background: '#020617', padding: 8, borderRadius: 4, fontSize: 13, overflowX: 'auto' }}>{unlockedCase.input}</pre>
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: '0 0 5px 0', fontSize: 12, color: '#94a3b8' }}>Expected Output</p>
                  <pre style={{ margin: 0, background: '#020617', padding: 8, borderRadius: 4, fontSize: 13, overflowX: 'auto' }}>{unlockedCase.expectedOutput}</pre>
                </div>
              </div>
            </div>
          )}

          {isMCQ ? (
            <div style={{ padding: 20, background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
              <h2 style={{ fontSize: 20, lineHeight: 1.6, margin: '0 0 20px' }}>
                {mcqData?.prompt || 'Loading question data...'}
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {mcqData?.options?.map((opt: string, idx: number) => (
                  <button key={idx} onClick={() => setSelectedOption(idx)} style={selectedOption === idx ? selectedOptionStyle : optionStyle}>
                    <span style={{ fontWeight: 'bold', color: '#67e8f9', marginRight: 12 }}>{String.fromCharCode(65 + idx)}.</span>{opt}
                  </button>
                ))}
              </div>
            </div>
          ) : problem?.externalUrl && requiresRedirect ? (
            <div style={{ border: '1px solid #334155', borderRadius: 12, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }}>
               <div style={{ background: '#1e293b', padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ width: 12, height: 12, background: '#ef4444', borderRadius: '50%' }} />
                  <div style={{ width: 12, height: 12, background: '#eab308', borderRadius: '50%' }} />
                  <div style={{ width: 12, height: 12, background: '#22c55e', borderRadius: '50%' }} />
                  <input value={problem.externalUrl} readOnly style={{ background: '#020617', border: 'none', color: '#94a3b8', padding: '6px 12px', borderRadius: 6, width: '100%', marginLeft: 10, fontSize: 13, outline: 'none' }} />
               </div>
               <iframe src={problem.externalUrl} style={{ width: '100%', height: '100%', minHeight: '600px', border: 'none', backgroundColor: '#fff' }} />
            </div>
          ) : (
            <div className="problem-statement-html" style={{ background: '#0f172a', padding: '24px 30px', borderRadius: 12, border: '1px solid #1e293b', flex: 1, overflowY: 'auto', lineHeight: 1.7 }}>
              <div dangerouslySetInnerHTML={{ __html: problem?.problem?.description || problem?.descriptionHtml || '<p style="color:#94a3b8">Problem description not available locally.</p>' }} />
            </div>
          )}
        </aside>

        {/* RIGHT PANEL: EDITOR & TERMINAL */}
        <section style={rightPanelStyle}>
          {!isMCQ && (
            <div style={editorTop}>
              <div style={{ display: 'flex', gap: 15, alignItems: 'center' }}>
                <strong style={{ color: '#eef2ff' }}>Editor</strong>
                <select value={language} onChange={(e) => setLanguage(e.target.value)} style={langSelect}>
                  <option value="cpp">C++ (G++)</option>
                  <option value="java">Java 17</option>
                  <option value="python">Python 3.10</option>
                  <option value="javascript">Node.js</option>
                </select>
              </div>
              <button onClick={runCustomTest} disabled={executing} style={runBtn}>
                {executing ? 'Compiling...' : '▶ Run Code'}
              </button>
            </div>
          )}
          
          {!isMCQ && (
            <textarea value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} style={editor} />
          )}

          {/* TERMINAL / SUBMIT DOCK */}
          <div style={terminal}>
            <div style={terminalTabs}>
              <button onClick={() => setActiveTab('input')} style={activeTab === 'input' ? activeTabStyle : tabStyle}>Testcase Input</button>
              <button onClick={() => setActiveTab('output')} style={activeTab === 'output' ? activeTabStyle : tabStyle}>Output Console</button>
              {requiresRedirect && (
                 <button onClick={() => setActiveTab('submit')} style={activeTab === 'submit' ? activeTabStyle : tabStyle}>Web Submission ↗</button>
              )}
            </div>
            
            <div style={terminalBody}>
              {activeTab === 'input' && !isMCQ && (
                <textarea value={testInput} onChange={e => setTestInput(e.target.value)} placeholder="Paste custom testcases here to dry run..." style={terminalInput} />
              )}
              {activeTab === 'output' && !isMCQ && (
                <pre style={testError ? terminalError : terminalOutput}>
                  {testError || testOutput || 'Awaiting execution. Click "Run Code" above.'}
                </pre>
              )}
              {activeTab === 'submit' && requiresRedirect && (
                <div style={{ textAlign: 'center', paddingTop: 30 }}>
                   <h3 style={{ color: '#94a3b8' }}>This problem requires external submission.</h3>
                   <button onClick={() => window.open(problem?.externalUrl, '_blank')} style={{...submitBtn, width: 'auto', padding: '10px 24px'}}>
                     Open Original Submit Page
                   </button>
                </div>
              )}
            </div>

            {/* ACTION DOCK */}
            <div style={{ padding: 15, background: '#020617', borderTop: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 15 }}>
              {!contest?.viewerMember && !contest?.canManage && <p style={{ color: '#fca5a5', margin: 0, textAlign: 'center', fontSize: 14 }}>Viewing mode only.</p>}
              
              <div style={{ display: 'flex', gap: 15 }}>
                {!requiresRedirect && (
                  <button onClick={submitCode} disabled={submitting || !contest?.viewerMember} style={{...submitBtn, marginTop: 0, flex: 1}}>
                    {isMCQ ? 'Submit Answer' : 'Submit to DivineCode Judge 🚀'}
                  </button>
                )}
              </div>

              {verdict && (
                <div style={{ ...verdictBox, margin: 0, borderColor: verdict.verdict.toLowerCase().includes('accept') ? 'rgba(74,222,128,.4)' : 'rgba(239,68,68,.4)', backgroundColor: verdict.verdict.toLowerCase().includes('accept') ? 'rgba(74,222,128,.1)' : 'rgba(239,68,68,.1)' }}>
                  <h3 style={{ margin: '0 0 6px 0', color: verdict.verdict.toLowerCase().includes('accept') ? '#4ade80' : '#f87171' }}>{verdict.verdict}</h3>
                  <pre style={{ margin: '0 0 10px 0', color: '#e2e8f0', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13, maxHeight: 80, overflowY: 'auto' }}>
                    {verdict.message}
                  </pre>

                  {/* 👉 FIX: `title` attribute moved outside the `style` object */}
                  {verdict.testResults && verdict.testResults.length > 0 && (
                     <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 10 }}>
                        {verdict.testResults.map((tr: any, idx: number) => (
                           <div 
                              key={idx} 
                              title={`Test ${idx + 1}: ${tr.verdict}`} 
                              style={{ width: 14, height: 14, borderRadius: '50%', background: tr.verdict === 'ACCEPTED' ? '#22c55e' : '#ef4444' }} 
                           />
                        ))}
                        <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 10 }}>{verdict.testResults.filter((t:any) => t.verdict === 'ACCEPTED').length} / {verdict.testResults.length} Tests Passed</span>
                     </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

// 📱 CSS STYLES
const page: CSSProperties = { minHeight: '100vh', padding: '20px 30px', fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: '#070a16', boxSizing: 'border-box' };
const nav: CSSProperties = { margin: '0 auto 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const brand: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 900, fontSize: 18, background: 'rgba(103,232,249,0.1)', padding: '8px 16px', borderRadius: 8 };
const userPill: CSSProperties = { padding: '8px 16px', borderRadius: 8, background: '#0f172a', border: '1px solid #1e293b', fontSize: 14, fontWeight: 'bold' };
const soundBtn: CSSProperties = { padding: '8px 16px', borderRadius: 8, background: '#0f172a', border: '1px solid #1e293b', color: '#fff', fontSize: 14, cursor: 'pointer', fontWeight: 'bold' };

const splitLayout: CSSProperties = { display: 'flex', gap: 24, height: 'calc(100vh - 100px)' };
const leftPanelStyle: CSSProperties = { flex: '1 1 50%', display: 'flex', flexDirection: 'column', gap: 15, overflowY: 'auto', paddingRight: 10 };
const rightPanelStyle: CSSProperties = { flex: '1 1 50%', display: 'flex', flexDirection: 'column', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b', overflow: 'hidden' };

const eyebrow: CSSProperties = { color: '#67e8f9', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', margin: '0 0 4px 0', fontSize: 12 };
const editorTop: CSSProperties = { padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#020617', borderBottom: '1px solid #1e293b' };
const langSelect: CSSProperties = { padding: '6px 12px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#eef2ff', outline: 'none', cursor: 'pointer', fontSize: 13 };
const editor: CSSProperties = { width: '100%', flex: 1, padding: 20, border: 0, outline: 0, resize: 'none', background: '#0f172a', color: '#e2e8f0', fontSize: 15, lineHeight: 1.6, fontFamily: 'JetBrains Mono, Consolas, monospace', boxSizing: 'border-box' };

const terminal: CSSProperties = { display: 'flex', flexDirection: 'column', height: '40%', borderTop: '1px solid #1e293b', background: '#0f172a' };
const terminalTabs: CSSProperties = { display: 'flex', background: '#020617', borderBottom: '1px solid #1e293b' };
const tabStyle: CSSProperties = { padding: '10px 20px', background: 'transparent', border: 0, color: '#94a3b8', cursor: 'pointer', fontWeight: 'bold', fontSize: 13 };
const activeTabStyle: CSSProperties = { ...tabStyle, color: '#38bdf8', borderBottom: '2px solid #38bdf8' };
const terminalBody: CSSProperties = { flex: 1, padding: 16, overflow: 'auto' };
const terminalInput: CSSProperties = { width: '100%', height: '100%', background: 'transparent', border: 0, outline: 0, color: '#e2e8f0', fontFamily: 'monospace', resize: 'none', fontSize: 14 };
const terminalOutput: CSSProperties = { margin: 0, color: '#e2e8f0', fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: 14 };
const terminalError: CSSProperties = { ...terminalOutput, color: '#ef4444' };

const submitBtn: CSSProperties = { width: '100%', padding: 14, borderRadius: 8, border: 0, background: '#38bdf8', color: '#020617', fontWeight: 900, cursor: 'pointer', fontSize: 15, transition: '0.2s' };
const runBtn: CSSProperties = { background: '#22c55e', color: '#000', border: 0, borderRadius: 6, padding: '8px 16px', fontWeight: 'bold', cursor: 'pointer', fontSize: 13 };
const verdictBox: CSSProperties = { padding: 16, borderRadius: 8, border: '1px solid' };

const overlay: CSSProperties = { position: 'fixed', inset: 0, backgroundColor: 'rgba(2,6,23,0.85)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999 };
const overlayModal: CSSProperties = { padding: 40, backgroundColor: '#0f172a', border: '1px solid #38bdf8', borderRadius: 16, textAlign: 'center', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' };
const optionStyle: CSSProperties = { padding: 16, borderRadius: 8, background: '#020617', color: '#eef2ff', border: '1px solid #1e293b', cursor: 'pointer', textAlign: 'left', fontSize: 15, transition: 'all 0.2s' };
const selectedOptionStyle: CSSProperties = { ...optionStyle, border: '1px solid #38bdf8', background: 'rgba(56,189,248,0.1)' };
const panel: CSSProperties = { padding: 24, borderRadius: 16, background: '#0f172a', border: '1px solid #1e293b' };
const primaryLink: CSSProperties = { display: 'inline-block', padding: '10px 20px', borderRadius: 8, background: '#38bdf8', color: '#000', textDecoration: 'none', fontWeight: 'bold' };