import { CSSProperties, useState } from 'react';
import Head from 'next/head';
import { useSession } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

type TestCase = { id: string; input: string; expectedOutput: string; output: string; status: 'idle' | 'running' | 'passed' | 'failed' | 'error' };

export default function JudgePage() {
  const { data: session } = useSession();
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('cpp');
  
  // 👉 NEW: CPH Test Case Arrays
  const [activeTab, setActiveTab] = useState<'cph' | 'ai'>('cph');
  const [testcases, setTestcases] = useState<TestCase[]>([{ id: '1', input: '', expectedOutput: '', output: '', status: 'idle' }]);
  const [cfUrl, setCfUrl] = useState('');
  const [isFetchingSamples, setIsFetchingSamples] = useState(false);

  // 👉 NEW: AI Tool States
  const [aiGenDesc, setAiGenDesc] = useState('');
  const [aiGenSolution, setAiGenSolution] = useState('');
  const [aiGenLoading, setAiGenLoading] = useState(false);
  
  const [aiDebugDesc, setAiDebugDesc] = useState('');
  const [aiDebugLoading, setAiDebugLoading] = useState(false);
  const [aiDebugResult, setAiDebugResult] = useState<any>(null);

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

  // 👉 UPDATED: Runs a single CPH Testcase
  const runTestCase = async (index: number) => {
    if (!code.trim()) return alert("Code cannot be empty");
    
    const newCases = [...testcases];
    newCases[index].status = 'running';
    newCases[index].output = '';
    setTestcases(newCases);

    try {
      const res = await fetch(`${API_V2_BASE_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceCode: code, language, input: newCases[index].input })
      });
      const data = await res.json();
      
      const actualOut = data.stdout ? atob(data.stdout).trim() : (data.compile_output ? atob(data.compile_output) : 'Error');
      const expectedOut = newCases[index].expectedOutput.trim();
      
      newCases[index].output = actualOut;
      if (data.status?.id !== 3) {
        newCases[index].status = 'error';
      } else {
        newCases[index].status = (actualOut === expectedOut || !expectedOut) ? 'passed' : 'failed';
      }
    } catch (e) {
      newCases[index].status = 'error';
      newCases[index].output = 'Network execution failed.';
    }
    setTestcases([...newCases]);
  };

  const runAllTestcases = async () => {
    for (let i = 0; i < testcases.length; i++) {
      await runTestCase(i);
    }
  };

  // 👉 UPDATED: Extracts BOTH Inputs and Outputs
  const handleFetchCPHSamples = async () => {
    if (!cfUrl.includes('codeforces')) return alert('Please enter a valid Codeforces URL');
    setIsFetchingSamples(true);
    try {
      const res = await fetch(`${API_V2_BASE_URL}/proxy/problem?url=${encodeURIComponent(cfUrl)}`);
      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      const inputNodes = Array.from(doc.querySelectorAll('.input pre')).map(el => el.textContent?.trim() || '');
      const outputNodes = Array.from(doc.querySelectorAll('.output pre')).map(el => el.textContent?.trim() || '');
      
      if (inputNodes.length === 0) return alert("No sample test cases found.");
      
      const newCases = inputNodes.map((inp, idx) => ({
        id: Date.now().toString() + idx,
        input: inp,
        expectedOutput: outputNodes[idx] || '',
        output: '',
        status: 'idle' as const
      }));
      
      setTestcases(newCases);
      alert(`Successfully extracted ${newCases.length} sample test cases!`);
    } catch (error) {
      alert("Failed to fetch Codeforces samples.");
    } finally {
      setIsFetchingSamples(false);
    }
  };

  const handleGenerateTestcases = async () => {
    if (!aiGenDesc || !aiGenSolution) return alert("Need description and master solution.");
    setAiGenLoading(true);
    try {
      const res = await fetch(`${API_V2_BASE_URL}/ai/generate-testcases`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problemDescription: aiGenDesc, masterSolution: aiGenSolution })
      });
      const data = await res.json();
      if (res.ok) {
        const generated = data.testcases.map((tc: any, i: number) => ({
          id: 'gen' + i, input: tc.input, expectedOutput: tc.expectedOutput, output: '', status: 'idle'
        }));
        setTestcases([...testcases, ...generated]);
        setActiveTab('cph');
        alert("Testcases generated and added to CPH Runner!");
      }
    } catch (e) {} finally { setAiGenLoading(false); }
  };

  const handleAiDebug = async () => {
    if (!code || !aiDebugDesc) return alert("Need description and user code.");
    if (confirm("This will deduct 50 coins from your account. Proceed?")) {
      setAiDebugLoading(true);
      try {
        const res = await fetch(`${API_V2_BASE_URL}/ai/debug-with-coins`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-email': session?.user?.email || '' },
          body: JSON.stringify({ userCode: code, problemDescription: aiDebugDesc })
        });
        const data = await res.json();
        if (res.ok) setAiDebugResult(data.aiDebugData);
        else alert(data.error);
      } catch (e) {} finally { setAiDebugLoading(false); }
    }
  };

  return (
    <main style={page}>
      <Head><title>Universal Judge | DivineCode</title></Head>

      <header style={headerBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <a href="/" style={brand}>← DivineCode</a>
          <strong style={{ color: '#fff', fontSize: 18 }}>Universal Code Playground</strong>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} style={selectBox}>
            <option value="cpp">C++ 17</option>
            <option value="python">Python 3</option>
            <option value="java">Java</option>
          </select>
          <button onClick={runAllTestcases} style={runBtn}>Run All Test Cases ▶</button>
        </div>
      </header>

      <div style={splitLayout}>
        <section style={leftPane}>
          <div style={paneHeader}>Code Editor</div>
          <div style={paneContent}>
            <textarea 
              value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={handleEditorKeyDown}
              style={codeEditor} spellCheck={false} placeholder={`// Write your ${language} solution here...`}
            />
          </div>
        </section>

        <section style={rightPane}>
          <div style={tabsHeader}>
            <button style={activeTab === 'cph' ? activeTabStyle : inactiveTabStyle} onClick={() => setActiveTab('cph')}>CPH Runner</button>
            <button style={activeTab === 'ai' ? activeTabStyle : inactiveTabStyle} onClick={() => setActiveTab('ai')}>AI Tools</button>
          </div>

          <div style={paneContent}>
            {activeTab === 'cph' && (
              <>
                <div style={cphCard}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input type="text" value={cfUrl} onChange={(e) => setCfUrl(e.target.value)} placeholder="Paste Codeforces URL..." style={inputBox} />
                    <button onClick={handleFetchCPHSamples} disabled={isFetchingSamples} style={fetchBtn}>
                      {isFetchingSamples ? 'Scraping...' : 'Fetch CF Samples'}
                    </button>
                  </div>
                </div>

                <div style={{ padding: 15, overflowY: 'auto' }}>
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
              </>
            )}

            {activeTab === 'ai' && (
              <div style={{ padding: 15, overflowY: 'auto' }}>
                <div style={tcCard}>
                  <div style={tcHeader}>🧠 Generate Cases (Free)</div>
                  <div style={{ padding: 10 }}>
                    <textarea value={aiGenDesc} onChange={e => setAiGenDesc(e.target.value)} placeholder="Paste Problem Description here..." style={{...tcBox, height: 80, marginBottom: 10}} />
                    <textarea value={aiGenSolution} onChange={e => setAiGenSolution(e.target.value)} placeholder="Paste Master Solution code here..." style={{...tcBox, height: 100, marginBottom: 10}} />
                    <button onClick={handleGenerateTestcases} disabled={aiGenLoading} style={{...runBtn, width: '100%'}}>{aiGenLoading ? 'Generating...' : 'Generate 5 Test Cases'}</button>
                  </div>
                </div>

                <div style={{...tcCard, marginTop: 20}}>
                  <div style={tcHeader}>🐛 Find My Bug (Costs 50 Coins)</div>
                  <div style={{ padding: 10 }}>
                    <textarea value={aiDebugDesc} onChange={e => setAiDebugDesc(e.target.value)} placeholder="Paste Problem Description here (Uses editor code)..." style={{...tcBox, height: 80, marginBottom: 10}} />
                    <button onClick={handleAiDebug} disabled={aiDebugLoading} style={{...fetchBtn, width: '100%', padding: '10px', background: '#eab308', color: '#000'}}>
                      {aiDebugLoading ? 'Analyzing...' : 'Debug Solution (-50 Coins)'}
                    </button>
                    {aiDebugResult && (
                      <div style={{ marginTop: 15, background: 'rgba(234, 179, 8, 0.1)', padding: 10, borderRadius: 8, border: '1px solid rgba(234, 179, 8, 0.3)' }}>
                        <p style={{ color: '#fde047', fontWeight: 'bold', margin: '0 0 10px' }}>💡 Hint: {aiDebugResult.hint}</p>
                        <div style={{ display: 'flex', gap: 10 }}><div style={{ flex: 1 }}><div style={tcLabel}>Failing Input</div><pre style={{...tcBox, height: 60}}>{aiDebugResult.input}</pre></div><div style={{ flex: 1 }}><div style={tcLabel}>Expected</div><pre style={{...tcBox, height: 60}}>{aiDebugResult.expectedOutput}</pre></div></div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

// 🎨 CSS Configurations
const page: CSSProperties = { height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#020617', color: '#eef2ff', fontFamily: 'Inter, sans-serif' };
const headerBar: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', backgroundColor: '#0f172a', borderBottom: '1px solid #1e293b', zIndex: 10 };
const brand: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 'bold' };
const runBtn: CSSProperties = { background: '#3b82f6', border: 'none', color: '#fff', padding: '10px 20px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' };
const selectBox: CSSProperties = { background: '#1e293b', color: '#fff', border: '1px solid #334155', padding: '10px', borderRadius: 8, outline: 'none', fontWeight: 'bold' };
const splitLayout: CSSProperties = { display: 'flex', flex: 1, overflow: 'hidden', gap: 12, padding: 12, flexDirection: 'row' };
const leftPane: CSSProperties = { flex: 0.6, background: '#0f172a', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #1e293b' };
const rightPane: CSSProperties = { flex: 0.4, background: '#0f172a', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #1e293b' };
const paneHeader: CSSProperties = { padding: '12px 20px', background: '#1e293b', fontWeight: 'bold', fontSize: 14, color: '#94a3b8' };
const paneContent: CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const codeEditor: CSSProperties = { width: '100%', height: '100%', flex: 1, background: '#020617', color: '#a5b4fc', border: 'none', outline: 'none', fontFamily: 'monospace', fontSize: 15, resize: 'none', padding: 15 };
const cphCard: CSSProperties = { padding: 15, background: '#0f172a', borderBottom: '1px solid #1e293b' };
const inputBox: CSSProperties = { flex: 1, padding: 10, borderRadius: 8, border: '1px solid #334155', background: '#020617', color: '#fff', outline: 'none' };
const fetchBtn: CSSProperties = { background: '#0d9488', color: '#fff', border: 'none', padding: '0 15px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' };
const tabsHeader: CSSProperties = { display: 'flex', background: '#1e293b' };
const activeTabStyle: CSSProperties = { flex: 1, background: '#0f172a', border: 'none', color: '#38bdf8', padding: '12px', borderTop: '2px solid #38bdf8', cursor: 'pointer', fontWeight: 'bold' };
const inactiveTabStyle: CSSProperties = { flex: 1, background: 'transparent', border: 'none', color: '#94a3b8', padding: '12px', cursor: 'pointer' };
const tcCard: CSSProperties = { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, overflow: 'hidden', marginBottom: 15 };
const tcHeader: CSSProperties = { background: '#1e293b', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', fontSize: 13 };
const tcBox: CSSProperties = { width: '100%', height: 80, background: '#020617', border: '1px solid #334155', borderRadius: 6, color: '#fff', fontFamily: 'monospace', padding: 8, fontSize: 13, resize: 'none' };
const tcLabel: CSSProperties = { fontSize: 12, color: '#94a3b8', marginBottom: 4 };
const secondaryBtn: CSSProperties = { background: '#334155', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' };