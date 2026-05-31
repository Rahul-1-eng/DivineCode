import { CSSProperties, useEffect, useState } from 'react';
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
  const [language, setLanguage] = useState('cpp');
  const [code, setCode] = useState(starter);
  
  // Submission States
  const [verdict, setVerdict] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);

  // Terminal States
  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState('');
  const [testError, setTestError] = useState('');
  const [testVerdict, setTestVerdict] = useState('');
  const [executing, setExecuting] = useState(false);
  const [activeTab, setActiveTab] = useState<'input' | 'output'>('input');

  useEffect(() => {
    if (!contestId || status === 'loading') return;
    fetch(`${API_V2_BASE_URL}/contests/${contestId}${viewerQuery(session)}`)
      .then((r) => r.json())
      .then((data) => { setContest(data); setProblem(data.problems?.find((p: any) => p.id === problemId)); })
      .catch(() => null);
  }, [contestId, problemId, session?.user?.email, session?.user?.name, status]);

  const isCodeforces = problem?.platform?.toLowerCase?.().includes('codeforces');
  const canSeeProblemMeta = Boolean(contest?.visibility?.canSeeProblemMeta);
  const problemIndex = Math.max(0, (contest?.problems || []).findIndex((p: any) => p.id === problem?.id));
  const problemLabel = problem ? String.fromCharCode(65 + problemIndex) : '';

  // 👉 NEW: Run Custom Testcase Logic
  async function runCustomTest() {
    setExecuting(true);
    setActiveTab('output');
    setTestOutput('Running code in sandbox...');
    setTestError('');
    setTestVerdict('');
    try {
      const res = await fetch(`${API_V2_BASE_URL}/execute`, {
        method: 'POST',
        headers: viewerHeaders(session),
        body: JSON.stringify({ sourceCode: code, language, input: testInput })
      });
      const data = await res.json();
      setTestOutput(data.stdout || '');
      setTestError(data.compileError || data.stderr || '');
      setTestVerdict(data.verdict);
    } catch (e) {
      setTestError('Network error connecting to execution engine.');
    } finally {
      setExecuting(false);
    }
  }

  // Final Submit Logic
  async function submitCode() {
    if (!session?.user?.email) return alert('Sign in first');
    if (!contest || !problem) return alert('Contest problem not loaded');
    const member = contest.viewerMember;
    if (!member) return alert('Only registered contest players can submit.');
    if (isCodeforces) return alert('For Codeforces problems, submit on Codeforces first, then ask the owner to run Codeforces sync.');
    setSubmitting(true);
    setVerdict(null);
    const res = await fetch(`${API_V2_BASE_URL}/contests/${contestId}/submissions`, {
      method: 'POST',
      headers: viewerHeaders(session),
      body: JSON.stringify({ code, language, contestProblemId: problemId })
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
    setVerdict(judgeRes.ok ? { verdict: data.submission?.verdict || 'Finished', message: data.submission?.judgeMessage || 'Judged' } : { verdict: 'Judge Error', message: data.error || 'Could not judge submission' });
  }

  if (status === 'loading') return <main style={page}>Checking account...</main>;
  if (!session) return <main style={page}><section style={panel}><h1>Sign in required</h1><a href="/signin" style={primaryLink}>Sign in</a></section></main>;

  return (
    <main style={page}>
      <nav style={nav}>
        <a href={contestId ? `/contests/${contestId}` : '/contests'} style={brand}>Back to contest</a>
        <div style={userPill}>{session.user?.name || session.user?.email}</div>
      </nav>
      <section style={layout}>
        <aside style={panel}>
          <p style={eyebrow}>{isCodeforces ? 'External verified submission' : 'DivineCode local judge'}</p>
          <h1>{canSeeProblemMeta ? problem?.title || 'Loading problem...' : `Problem ${problemLabel}`}</h1>
          <p style={{ color: '#94a3b8' }}>{problem?.platform}</p>

          {isCodeforces && <div style={warning}><strong>Codeforces problem</strong><p>Submit your solution on Codeforces. DivineCode updates standings only after Codeforces sync.</p></div>}
          {problem?.url && <a href={problem.url} target="_blank" rel="noreferrer" style={primaryLink}>{isCodeforces ? 'Open and Submit on Codeforces' : 'Open original problem'}</a>}
          
          <div style={{ marginTop: 22 }}>
            <label>Language</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} style={input}>
              <option value="cpp">C++</option>
              <option value="java">Java</option>
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
              <option value="c">C</option>
            </select>
          </div>
          
          <button onClick={submitCode} disabled={submitting || !contest?.viewerMember} style={submitBtn}>
            {submitting ? 'Submitting...' : isCodeforces ? 'Store as Pending Verification' : 'Final Submit to Judge'}
          </button>
          
          {!contest?.viewerMember && <p style={{ color: '#fca5a5' }}>Only registered players can submit.</p>}
          {verdict && <div style={verdictBox}><h2>{verdict.verdict}</h2><p>{verdict.message}</p></div>}
        </aside>

        <section style={editorPanel}>
          <div style={editorTop}>
            <strong>{isCodeforces ? 'Scratchpad only' : 'Code editor'}</strong>
            <button onClick={runCustomTest} disabled={executing} style={runBtn}>
              {executing ? 'Running...' : '▶ Run Code'}
            </button>
          </div>
          
          <textarea value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} style={editor} />
          
          {/* 👉 NEW: Terminal UI */}
          <div style={terminal}>
            <div style={terminalTabs}>
              <button onClick={() => setActiveTab('input')} style={activeTab === 'input' ? activeTabStyle : tabStyle}>Custom Input</button>
              <button onClick={() => setActiveTab('output')} style={activeTab === 'output' ? activeTabStyle : tabStyle}>Output {testVerdict && `(${testVerdict})`}</button>
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
        </section>
      </section>
    </main>
  );
}

// 👉 STYLES
const page: CSSProperties = { minHeight: '100vh', padding: 28, fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.35), transparent 34rem), #070a16' };
const nav: CSSProperties = { maxWidth: 1320, margin: '0 auto 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 };
const brand: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 900 };
const userPill: CSSProperties = { padding: '10px 14px', borderRadius: 999, background: 'rgba(15,23,42,.82)', border: '1px solid rgba(148,163,184,.22)' };
const layout: CSSProperties = { maxWidth: 1320, margin: '0 auto', display: 'grid', gridTemplateColumns: '360px 1fr', gap: 18 };
const panel: CSSProperties = { padding: 24, borderRadius: 26, background: 'rgba(15,23,42,.86)', border: '1px solid rgba(148,163,184,.22)', boxShadow: '0 24px 70px rgba(0,0,0,.3)' };
const editorTop: CSSProperties = { padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#cbd5e1', background: 'rgba(2,6,23,.65)', borderBottom: '1px solid rgba(148,163,184,.16)' };
const eyebrow: CSSProperties = { color: '#67e8f9', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase' };
const input: CSSProperties = { width: '100%', padding: 12, marginTop: 8, borderRadius: 14, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(2,6,23,.55)', color: '#eef2ff' };
const submitBtn: CSSProperties = { width: '100%', marginTop: 18, padding: 14, borderRadius: 16, border: 0, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontWeight: 950, cursor: 'pointer' };
const primaryLink: CSSProperties = { display: 'inline-block', padding: '11px 15px', borderRadius: 999, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', textDecoration: 'none', fontWeight: 900 };
const verdictBox: CSSProperties = { marginTop: 18, padding: 16, borderRadius: 18, background: 'rgba(34,211,238,.1)', border: '1px solid rgba(34,211,238,.22)' };
const warning: CSSProperties = { margin: '16px 0', padding: 16, borderRadius: 18, background: 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.28)', color: '#fde68a' };

// Terminal Styles
const editorPanel: CSSProperties = { ...panel, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' };
const editor: CSSProperties = { width: '100%', flex: 1, minHeight: '45vh', padding: 20, border: 0, outline: 0, resize: 'none', background: '#020617', color: '#e2e8f0', fontSize: 15, lineHeight: 1.65, fontFamily: 'JetBrains Mono, Consolas, monospace' };
const runBtn: CSSProperties = { background: '#22c55e', color: 'white', border: 0, borderRadius: 8, padding: '6px 16px', fontWeight: 'bold', cursor: 'pointer' };
const terminal: CSSProperties = { height: '28vh', background: '#0f172a', borderTop: '1px solid rgba(148,163,184,.16)', display: 'flex', flexDirection: 'column' };
const terminalTabs: CSSProperties = { display: 'flex', background: '#020617', borderBottom: '1px solid rgba(148,163,184,.16)' };
const tabStyle: CSSProperties = { padding: '10px 20px', background: 'transparent', border: 0, color: '#94a3b8', cursor: 'pointer', fontWeight: 'bold' };
const activeTabStyle: CSSProperties = { ...tabStyle, color: '#67e8f9', borderBottom: '2px solid #67e8f9' };
const terminalBody: CSSProperties = { flex: 1, padding: 12, overflow: 'auto' };
const terminalInput: CSSProperties = { width: '100%', height: '100%', background: 'transparent', border: 0, outline: 0, color: '#e2e8f0', fontFamily: 'monospace', resize: 'none' };
const terminalOutput: CSSProperties = { margin: 0, color: '#e2e8f0', fontFamily: 'monospace', whiteSpace: 'pre-wrap' };
const terminalError: CSSProperties = { ...terminalOutput, color: '#ef4444' };