import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';

const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false, loading: () => <div style={{padding: 20, color: '#64748b'}}>Loading Editor...</div> });
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function ProblemWorkspace() {
  const router = useRouter();
  const { id } = router.query;

  const [problem, setProblem] = useState<any>(null);
  const [language, setLanguage] = useState('cpp');
  const [code, setCode] = useState('// Write your solution here...');
  const [outputs, setOutputs] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<'console' | 'ai'>('console');

  useEffect(() => {
    if (!id) return;
    fetch(`${API_BASE_URL}/api/problems/${id}`)
      .then((r) => r.json())
      .then(data => setProblem(data))
      .catch(err => console.error("Failed to load problem:", err));
  }, [id]);

  async function runCode() {
    if (!problem) return;
    setRunning(true);
    setActiveTab('console');
    try {
      const res = await fetch(`${API_BASE_URL}/api/v2/submissions/run-samples`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problemId: problem.id, code, language })
      });
      const data = await res.json();
      setOutputs(data.results || []);
    } catch (err) { alert('Failed to connect to execution server.'); } finally { setRunning(false); }
  }

  if (!problem) return (
    <main style={{ padding: 40, background: '#070a16', color: 'white', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 50, height: 50, borderTop: '3px solid #22d3ee', borderRadius: '50%', animation: 'spin 1s linear infinite' }}/>
      <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </main>
  );

  const monacoLanguage = language === 'cpp' ? 'cpp' : language === 'python' ? 'python' : 'c';

  return (
    <main style={{ display: 'flex', height: '100vh', background: '#070a16', color: '#fff', fontFamily: 'Inter, sans-serif' }}>
      
      {/* Left Panel: Description */}
      <section style={{ width: '40%', padding: 30, overflowY: 'auto', borderRight: '1px solid #1e293b', background: '#0f172a' }}>
        <a href="/practice" style={{ color: '#67e8f9', textDecoration: 'none', fontWeight: 900, display: 'inline-block', marginBottom: 16 }}>← Back to Practice</a>
        <h1 style={{ margin: '0 0 8px 0' }}>{problem.title}</h1>
        <div style={{ color: '#67e8f9', marginBottom: 20 }}>Difficulty: {problem.difficulty || problem.rating || 'Unrated'}</div>
        <div style={{ lineHeight: 1.7, color: '#cbd5e1', fontSize: '15px' }}>{problem.description}</div>

        {(problem.stdin || problem.expectedOutput) && (
          <div style={{ marginTop: 24, padding: 16, borderRadius: 12, background: '#020617', border: '1px solid rgba(148,163,184,.18)' }}>
            {problem.stdin && (
              <><strong style={{ display: 'block', marginBottom: 8, color: '#94a3b8' }}>Sample Input</strong>
              <pre style={{ margin: '0 0 16px 0', color: '#e2e8f0', background: '#0f172a', padding: 12, borderRadius: 8 }}>{problem.stdin}</pre></>
            )}
            {problem.expectedOutput && (
              <><strong style={{ display: 'block', marginBottom: 8, color: '#94a3b8' }}>Expected Output</strong>
              <pre style={{ margin: 0, color: '#e2e8f0', background: '#0f172a', padding: 12, borderRadius: 8 }}>{problem.expectedOutput}</pre></>
            )}
          </div>
        )}
      </section>

      {/* Right Panel: Editor & Terminal */}
      <section style={{ width: '60%', display: 'flex', flexDirection: 'column', background: '#020617' }}>
        <div style={{ padding: 12, background: '#0f172a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b' }}>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} style={selectControl}>
            <option value="cpp">C++ (GCC 9.2)</option>
            <option value="python">Python 3</option>
            <option value="c">C</option>
          </select>
          <button onClick={runCode} disabled={running} style={runBtn}>{running ? 'Running...' : 'Run Code ▶'}</button>
        </div>

        <div style={{ flex: 1 }}>
          <Editor
            height="100%" theme="vs-dark" language={monacoLanguage} value={code} onChange={(val) => setCode(val || '')}
            options={{ minimap: { enabled: false }, fontSize: 15, padding: { top: 16 } }}
          />
        </div>

        {/* Terminal Split */}
        <div style={{ height: '35%', background: '#020617', borderTop: '1px solid #1e293b', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', background: '#0f172a' }}>
            <button style={activeTab === 'console' ? activeTabStyle : inactiveTabStyle} onClick={() => setActiveTab('console')}>Console Output</button>
            <button style={activeTab === 'ai' ? activeTabStyle : inactiveTabStyle} onClick={() => setActiveTab('ai')}>AI Explainer</button>
          </div>
          
          <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
            {activeTab === 'console' && (
              <>
                {outputs.length === 0 && <p style={{ color: '#475569' }}>Run your code to see results here.</p>}
                {outputs.map((out, idx) => (
                  <div key={idx} style={{ marginBottom: 12, padding: 12, borderRadius: 8, background: out.verdict === 'ACCEPTED' ? 'rgba(34,211,238,0.1)' : 'rgba(239,68,68,0.1)' }}>
                    <strong>Test Case {idx + 1}: </strong> 
                    <span style={{ color: out.verdict === 'ACCEPTED' ? '#22d3ee' : '#ef4444', fontWeight: 'bold' }}>{out.verdict}</span>
                    {out.runtimeMs && <span style={{ color: '#94a3b8', marginLeft: 8 }}>({out.runtimeMs}ms)</span>}
                    {out.compileError && <pre style={{ color: '#ef4444', marginTop: 12, whiteSpace: 'pre-wrap', fontSize: 13, background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 6 }}>{out.compileError}</pre>}
                  </div>
                ))}
              </>
            )}

            {activeTab === 'ai' && (
              <div style={{ textAlign: 'center', paddingTop: 20 }}>
                <h3 style={{ color: '#a5b4fc', marginTop: 0 }}>🤖 Interactive AI Explainer</h3>
                <p style={{ color: '#cbd5e1' }}>Stuck? Let the AI break down the optimal approach step-by-step.</p>
                <button style={{ background: '#5356ff', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' }}>Generate Explanation</button>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

const selectControl = { background: '#1e293b', color: '#fff', border: '1px solid #334155', padding: '8px 12px', borderRadius: 8, outline: 'none', cursor: 'pointer' };
const runBtn = { background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', border: 'none', padding: '8px 20px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' };
const activeTabStyle = { background: '#020617', border: 'none', color: '#38bdf8', padding: '10px 20px', borderTop: '2px solid #38bdf8', cursor: 'pointer', fontWeight: 'bold' };
const inactiveTabStyle = { background: 'transparent', border: 'none', color: '#94a3b8', padding: '10px 20px', cursor: 'pointer' };