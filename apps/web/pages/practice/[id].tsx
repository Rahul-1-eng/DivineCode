import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';

// Safely load Monaco editor on the client side only to avoid Next.js SSR errors
const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function ProblemWorkspace() {
  const router = useRouter();
  const { id } = router.query;

  const [problem, setProblem] = useState<any>(null);
  const [language, setLanguage] = useState('cpp');
  const [code, setCode] = useState('// Write your solution here...');
  const [outputs, setOutputs] = useState<any[]>([]);
  const [running, setRunning] = useState(false);

  // Fetch the problem details when the page loads
  useEffect(() => {
    if (!id) return;
    fetch(`${API_BASE_URL}/api/problems/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setProblem(data);
      })
      .catch((err) => console.error("Failed to load problem:", err));
  }, [id]);

  async function runCode() {
    if (!problem) return;
    setRunning(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v2/submissions/run-samples`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problemId: problem.id, code, language })
      });
      const data = await res.json();
      setOutputs(data.results || []);
    } catch (err) {
      alert('Failed to connect to execution server.');
    } finally {
      setRunning(false);
    }
  }

  if (!problem) {
    return (
      <main style={{ padding: 40, background: '#070a16', color: 'white', height: '100vh', fontFamily: 'Inter, sans-serif' }}>
        <h2>Loading problem...</h2>
      </main>
    );
  }

  const monacoLanguage = language === 'cpp' ? 'cpp' : language === 'python' ? 'python' : 'c';

  return (
    <main style={{ display: 'flex', height: '100vh', background: '#070a16', color: '#fff', fontFamily: 'Inter, sans-serif' }}>
      
      {/* Left Panel: Question Details */}
      <section style={{ width: '40%', padding: 30, overflowY: 'auto', borderRight: '1px solid #1e293b' }}>
        <a href="/practice" style={{ color: '#67e8f9', textDecoration: 'none', fontWeight: 900, display: 'inline-block', marginBottom: 16 }}>← Back to Practice</a>
        <h1 style={{ margin: '0 0 8px 0' }}>{problem.title}</h1>
        <div style={{ color: '#67e8f9', marginBottom: 20 }}>Difficulty: {problem.difficulty || problem.rating || 'Unrated'}</div>
        
        <div style={{ lineHeight: 1.7, color: '#cbd5e1', fontSize: '15px' }}>
          {problem.description}
        </div>

        {/* Render Sample Input/Output if available */}
        {(problem.stdin || problem.expectedOutput) && (
          <div style={{ marginTop: 24, padding: 16, borderRadius: 12, background: 'rgba(2,6,23,.55)', border: '1px solid rgba(148,163,184,.18)' }}>
            {problem.stdin && (
              <>
                <strong style={{ display: 'block', marginBottom: 8, color: '#94a3b8' }}>Sample Input</strong>
                <pre style={{ margin: '0 0 16px 0', color: '#e2e8f0', background: '#0f172a', padding: 12, borderRadius: 8 }}>{problem.stdin}</pre>
              </>
            )}
            {problem.expectedOutput && (
              <>
                <strong style={{ display: 'block', marginBottom: 8, color: '#94a3b8' }}>Expected Output</strong>
                <pre style={{ margin: 0, color: '#e2e8f0', background: '#0f172a', padding: 12, borderRadius: 8 }}>{problem.expectedOutput}</pre>
              </>
            )}
          </div>
        )}
      </section>

      {/* Right Panel: Editor Area */}
      <section style={{ width: '60%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 12, background: '#0f172a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} style={selectControl}>
              <option value="cpp">C++ (GCC 9.2)</option>
              <option value="python">Python 3</option>
              <option value="c">C</option>
            </select>
          </div>
          <button onClick={runCode} disabled={running} style={runBtn}>
            {running ? 'Running...' : 'Run Code'}
          </button>
        </div>

        <div style={{ flex: 1 }}>
          <Editor
            height="100%"
            theme="vs-dark"
            language={monacoLanguage}
            value={code}
            onChange={(val) => setCode(val || '')}
            options={{ minimap: { enabled: false }, fontSize: 15 }}
          />
        </div>

        {/* Verdict Console Panel */}
        <div style={{ height: '30%', background: '#020617', borderTop: '1px solid #1e293b', padding: 20, overflowY: 'auto' }}>
          <h3 style={{ margin: '0 0 16px 0', color: '#94a3b8' }}>Console Output</h3>
          
          {outputs.length === 0 && <p style={{ color: '#475569' }}>Run your code to see results here.</p>}
          
          {outputs.map((out, idx) => (
            <div key={idx} style={{ marginBottom: 12, padding: 12, borderRadius: 8, background: out.verdict === 'ACCEPTED' ? 'rgba(34,211,238,0.1)' : 'rgba(239,68,68,0.1)' }}>
              <strong>Test Case {idx + 1}: </strong> 
              <span style={{ color: out.verdict === 'ACCEPTED' ? '#22d3ee' : '#ef4444', fontWeight: 'bold' }}>{out.verdict}</span>
              {out.runtimeMs && <span style={{ color: '#94a3b8', marginLeft: 8 }}>({out.runtimeMs}ms)</span>}
              
              {out.compileError && (
                <pre style={{ color: '#ef4444', marginTop: 12, whiteSpace: 'pre-wrap', fontSize: 13, background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 6 }}>
                  {out.compileError}
                </pre>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

const selectControl = { background: '#1e293b', color: '#fff', border: '1px solid #334155', padding: '8px 12px', borderRadius: 8, outline: 'none', cursor: 'pointer' };
const runBtn = { background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', border: 'none', padding: '8px 20px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' };