import { CSSProperties, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';

export async function getServerSideProps() { return { props: {} }; }

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

const starter = `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    // write your solution here\n    return 0;\n}\n`;

function viewerQuery(session: any) {
  const query = new URLSearchParams();
  if (session?.user?.email) query.set('viewerEmail', session.user.email);
  if (session?.user?.name) query.set('viewerName', session.user.name);
  const value = query.toString();
  return value ? `?${value}` : '';
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
  
  // Coding State
  const [language, setLanguage] = useState('cpp');
  const [code, setCode] = useState(starter);
  
  // MCQ State
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
  const [activeTab, setActiveTab] = useState<'input' | 'output'>('input');

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
      audioRef.current.play().catch(e => console.log("Audio autoplay blocked by browser"));
    }
  };

  // 👉 UPDATED: Route execution through your own backend instead of direct external API
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

  async function submitCode() {
    if (!session?.user?.email) return alert('Sign in first');
    if (!contest || !problem) return alert('Contest problem not loaded');
    const member = contest.viewerMember;
    if (!member && !contest?.canManage) return alert('Only registered contest players can submit.');
    if (isCodeforces) return alert('For Codeforces problems, submit on Codeforces first, then ask the owner to run Codeforces sync.');
    
    if (isMCQ && selectedOption === null) return alert('Please select an answer option first.');

    setSubmitting(true);
    setVerdict(null);
    
    const finalLanguage = isMCQ ? 'mcq' : language;
    const finalCode = isMCQ ? String(selectedOption) : code;

    const res = await fetch(`${API_V2_BASE_URL}/contests/${contestId}/submissions`, {
      method: 'POST',
      headers: viewerHeaders(session),
      body: JSON.stringify({ code: finalCode, language: finalLanguage, contestProblemId: problemId })
    });
    const submissionData = await res.json();
    
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
    
    const finalVerdict = data.submission?.verdict || 'Finished';
    setVerdict(judgeRes.ok ? { verdict: finalVerdict, message: data.submission?.judgeMessage || 'Judged' } : { verdict: 'Judge Error', message: data.error || 'Could not judge submission' });

    if (finalVerdict === 'ACCEPTED' || finalVerdict === 'Accepted') {
      playSuccessSound();
    }
  }

  if (status === 'loading') return <main style={page}>Checking account...</main>;
  if (!session) return <main style={page}><section style={panel}><h1>Sign in required</h1><a href="/signin" style={primaryLink}>Sign in</a></section></main>;

  return (
    <main style={page}>
      <audio ref={audioRef} src="/accepted.mp3" preload="auto" />

      {submitting && (
        <div style={overlay}>
          <div style={overlayModal}>
            <h2 style={{ color: '#fff', margin: '0 0 10px 0' }}>{isMCQ ? 'Grading Answer...' : 'Judging Submission...'}</h2>
            <p style={{ color: '#67e8f9', margin: 0, fontSize: 14 }}>Evaluating against hidden system logic</p>
          </div>
        </div>
      )}

      <nav style={nav}>
        <a href={contestId ? `/contests/${contestId}` : '/contests'} style={brand}>Back to contest</a>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={() => setSoundEnabled(!soundEnabled)} style={soundBtn}>
            {soundEnabled ? '🔊 Sound On' : '🔇 Muted'}
          </button>
          <div style={userPill}>{session.user?.name || session.user?.email}</div>
        </div>
      </nav>

      <section style={layout}>
        <aside style={asideStyle}>
          <p style={eyebrow}>{isCodeforces ? 'External verified submission' : isMCQ ? 'Theoretical MCQ' : 'DivineCode local judge'}</p>
          <h1 style={{ margin: '10px 0' }}>{canSeeProblemMeta ? problem?.title || 'Loading problem...' : `Problem ${problemLabel}`}</h1>
          <p style={{ color: '#94a3b8', margin: '0 0 20px 0' }}>{problem?.platform}</p>

          {isCodeforces && <div style={warning}><strong>Codeforces problem</strong><p style={{ margin: '6px 0 0 0', fontSize: 14 }}>Submit your solution on Codeforces. DivineCode updates standings only after Codeforces sync.</p></div>}
          {!isMCQ && problem?.url && <a href={problem.url} target="_blank" rel="noreferrer" style={primaryLink}>{isCodeforces ? 'Open and Submit on Codeforces' : 'Open original problem'}</a>}
          
          {!isMCQ && (
            <div style={{ marginTop: 22 }}>
              <label style={{ fontWeight: 'bold' }}>Language</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} style={input}>
                <option value="cpp">C++</option>
                <option value="java">Java</option>
                <option value="python">Python</option>
                <option value="javascript">JavaScript</option>
                <option value="c">C</option>
              </select>
            </div>
          )}
          
          <button onClick={submitCode} disabled={submitting || !contest?.viewerMember} style={submitBtn}>
            {isCodeforces ? 'Store as Pending Verification' : isMCQ ? 'Submit Answer' : 'Final Submit to Judge'}
          </button>
          
          {!contest?.viewerMember && !contest?.canManage && <p style={{ color: '#fca5a5', marginTop: 12, textAlign: 'center' }}>Only registered players can submit.</p>}
          
          {verdict && (
            <div style={{ ...verdictBox, borderColor: verdict.verdict.includes('Accept') ? 'rgba(74,222,128,.4)' : 'rgba(239,68,68,.4)', backgroundColor: verdict.verdict.includes('Accept') ? 'rgba(74,222,128,.1)' : 'rgba(239,68,68,.1)' }}>
              <h2 style={{ margin: '0 0 6px 0', color: verdict.verdict.includes('Accept') ? '#4ade80' : '#f87171' }}>{verdict.verdict}</h2>
              <p style={{ margin: 0, color: '#e2e8f0' }}>{verdict.message}</p>
            </div>
          )}
        </aside>

        <section style={editorPanelStyle}>
          {isMCQ ? (
            <div style={{ padding: 32, display: 'flex', flexDirection: 'column', height: '100%' }}>
              <strong style={{ color: '#cbd5e1', fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Interview Question</strong>
              <h2 style={{ fontSize: 24, lineHeight: 1.5, margin: '20px 0 30px' }}>
                {mcqData?.prompt || 'Loading question data from database...'}
              </h2>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {mcqData?.options?.map((opt: string, idx: number) => (
                  <button 
                    key={idx}
                    onClick={() => setSelectedOption(idx)}
                    style={selectedOption === idx ? selectedOptionStyle : optionStyle}
                  >
                    <span style={{ fontWeight: 'bold', color: '#67e8f9', marginRight: 12 }}>{String.fromCharCode(65 + idx)}.</span>
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div style={editorTop}>
                <strong>{isCodeforces ? 'Scratchpad only' : 'Code editor'}</strong>
                <button onClick={runCustomTest} disabled={executing} style={runBtn}>
                  {executing ? 'Running...' : '▶ Run Code'}
                </button>
              </div>
              
              <textarea value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} style={editor} />
              
              <div style={terminal}>
                <div style={terminalTabs}>
                  <button onClick={() => setActiveTab('input')} style={activeTab === 'input' ? activeTabStyle : tabStyle}>Custom Input</button>
                  <button onClick={() => setActiveTab('output')} style={activeTab === 'output' ? activeTabStyle : tabStyle}>Console Output</button>
                </div>
                <div style={terminalBody}>
                  {activeTab === 'input' ? (
                    <textarea 
                      value={testInput} 
                      onChange={e => setTestInput(e.target.value)} 
                      placeholder="Paste your test cases here..." 
                      style={terminalInput} 
                    />
                  ) : (
                    <pre style={testError ? terminalError : terminalOutput}>
                      {testError || testOutput || 'No output generated. Click "Run Code" to test.'}
                    </pre>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

// RESTORED STYLES
const page: CSSProperties = { minHeight: '100vh', padding: 24, fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.35), transparent 34rem), #070a16', boxSizing: 'border-box' };
const nav: CSSProperties = { maxWidth: 1320, margin: '0 auto 24px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 };
const brand: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 900 };
const userPill: CSSProperties = { padding: '8px 14px', borderRadius: 999, background: 'rgba(15,23,42,.82)', border: '1px solid rgba(148,163,184,.22)', fontSize: 14 };
const soundBtn: CSSProperties = { padding: '8px 14px', borderRadius: 999, background: '#0f172a', border: '1px solid rgba(148,163,184,.22)', color: '#fff', fontSize: 14, cursor: 'pointer' };

const layout: CSSProperties = { maxWidth: 1320, margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: 18 };
const panel: CSSProperties = { padding: 24, borderRadius: 26, background: 'rgba(15,23,42,.86)', border: '1px solid rgba(148,163,184,.22)', boxShadow: '0 24px 70px rgba(0,0,0,.3)' };
const asideStyle: CSSProperties = { ...panel, flex: '1 1 320px', maxWidth: '100%', boxSizing: 'border-box' };
const editorPanelStyle: CSSProperties = { ...panel, flex: '2 1 500px', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: '70vh', boxSizing: 'border-box' };

const editorTop: CSSProperties = { padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#cbd5e1', background: 'rgba(2,6,23,.65)', borderBottom: '1px solid rgba(148,163,184,.16)' };
const eyebrow: CSSProperties = { color: '#67e8f9', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', margin: '0 0 8px 0' };
const input: CSSProperties = { width: '100%', padding: 12, marginTop: 8, borderRadius: 14, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(2,6,23,.55)', color: '#eef2ff', boxSizing: 'border-box' };
const submitBtn: CSSProperties = { width: '100%', marginTop: 18, padding: 14, borderRadius: 16, border: 0, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontWeight: 950, cursor: 'pointer', fontSize: 16 };
const primaryLink: CSSProperties = { display: 'inline-block', padding: '11px 15px', borderRadius: 999, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', textDecoration: 'none', fontWeight: 900, textAlign: 'center' };
const verdictBox: CSSProperties = { marginTop: 18, padding: 16, borderRadius: 18, border: '1px solid' };
const warning: CSSProperties = { margin: '16px 0', padding: 16, borderRadius: 18, background: 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.28)', color: '#fde68a' };

const editor: CSSProperties = { width: '100%', flex: 1, minHeight: '30vh', padding: 20, border: 0, outline: 0, resize: 'none', background: '#020617', color: '#e2e8f0', fontSize: 15, lineHeight: 1.65, fontFamily: 'JetBrains Mono, Consolas, monospace', boxSizing: 'border-box' };
const runBtn: CSSProperties = { background: '#22c55e', color: 'white', border: 0, borderRadius: 8, padding: '6px 16px', fontWeight: 'bold', cursor: 'pointer' };
const terminal: CSSProperties = { height: '32vh', background: '#0f172a', borderTop: '1px solid rgba(148,163,184,.16)', display: 'flex', flexDirection: 'column' };
const terminalTabs: CSSProperties = { display: 'flex', background: '#020617', borderBottom: '1px solid rgba(148,163,184,.16)' };
const tabStyle: CSSProperties = { padding: '10px 20px', background: 'transparent', border: 0, color: '#94a3b8', cursor: 'pointer', fontWeight: 'bold' };
const activeTabStyle: CSSProperties = { ...tabStyle, color: '#67e8f9', borderBottom: '2px solid #67e8f9' };
const terminalBody: CSSProperties = { flex: 1, padding: 12, overflow: 'auto' };
const terminalInput: CSSProperties = { width: '100%', height: '100%', background: 'transparent', border: 0, outline: 0, color: '#e2e8f0', fontFamily: 'monospace', resize: 'none' };
const terminalOutput: CSSProperties = { margin: 0, color: '#e2e8f0', fontFamily: 'monospace', whiteSpace: 'pre-wrap' };
const terminalError: CSSProperties = { ...terminalOutput, color: '#ef4444' };

const overlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(2,6,23,0.8)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 50 };
const overlayModal: CSSProperties = { padding: 30, backgroundColor: '#0f172a', border: '1px solid rgba(103,232,249,0.3)', borderRadius: 20, textAlign: 'center', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' };

// MCQ Specific Styles
const optionStyle: CSSProperties = { padding: 20, borderRadius: 16, background: 'rgba(2,6,23,.55)', color: '#eef2ff', border: '1px solid rgba(148,163,184,.24)', cursor: 'pointer', textAlign: 'left', fontSize: 16, transition: 'all 0.2s' };
const selectedOptionStyle: CSSProperties = { ...optionStyle, border: '1px solid rgba(34,211,238,.8)', background: 'rgba(34,211,238,.12)' };