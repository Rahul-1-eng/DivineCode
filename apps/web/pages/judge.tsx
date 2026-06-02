import { CSSProperties, useState } from 'react';
import Head from 'next/head';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

export default function JudgePage() {
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('cpp');
  
  const [customInput, setCustomInput] = useState('');
  const [runResult, setRunResult] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);

  // CPH Helper States
  const [cfUrl, setCfUrl] = useState('');
  const [isFetchingSamples, setIsFetchingSamples] = useState(false);

  // Editor Autocomplete
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

  // Execution Engine
  const handleRunCode = async () => {
    if (!code.trim()) return alert("Code cannot be empty");
    setIsRunning(true);
    try {
      const res = await fetch(`${API_V2_BASE_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceCode: code, language, input: customInput })
      });
      const data = await res.json();
      setRunResult(data);
    } catch (e) {
      alert("Execution failed to connect to the Judge.");
    } finally {
      setIsRunning(false);
    }
  };

  // CPH Helper Auto-Fetcher (Uses the proxy to extract inputs)
  const handleFetchCPHSamples = async () => {
    if (!cfUrl.includes('codeforces')) return alert('Please enter a valid Codeforces URL');
    setIsFetchingSamples(true);
    try {
      // 1. Fetch the raw HTML via our proxy
      const res = await fetch(`${API_V2_BASE_URL}/proxy/problem?url=${encodeURIComponent(cfUrl)}`);
      const html = await res.text();
      
      // 2. Parse the HTML natively in the browser
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // 3. Extract the test cases
      const inputs = Array.from(doc.querySelectorAll('.input pre')).map(el => el.textContent?.trim() || '');
      
      if (inputs.length === 0) {
        alert("No sample test cases found on that page.");
        return;
      }

      // 4. Combine them into the custom input box
      setCustomInput(inputs.join('\n\n'));
      alert(`Successfully extracted ${inputs.length} sample test cases!`);
    } catch (error) {
      alert("Failed to fetch Codeforces samples.");
    } finally {
      setIsFetchingSamples(false);
    }
  };

  return (
    <main style={page}>
      <Head>
        <title>Universal Judge | DivineCode</title>
      </Head>

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
          <button onClick={handleRunCode} disabled={isRunning} style={runBtn}>
            {isRunning ? 'Executing...' : 'Run Code ▶'}
          </button>
        </div>
      </header>

      <div style={splitLayout}>
        {/* Left Pane: Code Editor */}
        <section style={leftPane}>
          <div style={paneHeader}>Code Editor</div>
          <div style={paneContent}>
            <textarea 
              value={code} 
              onChange={(e) => setCode(e.target.value)} 
              onKeyDown={handleEditorKeyDown}
              style={codeEditor} 
              spellCheck={false}
              placeholder={`// Write your ${language} code here...\n// You can test algorithms freely here.`}
            />
          </div>
        </section>

        {/* Right Pane: Custom Input & CPH Tools */}
        <section style={rightPane}>
          
          {/* CPH Auto-Fetcher Block */}
          <div style={cphCard}>
            <h3 style={{ margin: '0 0 10px 0', color: '#67e8f9', fontSize: 16 }}>⚡ CPH Helper (Auto-Fetch)</h3>
            <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>Paste a Codeforces problem URL to automatically extract its sample test cases.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <input 
                type="text" 
                value={cfUrl} 
                onChange={(e) => setCfUrl(e.target.value)} 
                placeholder="https://codeforces.com/problemset/problem/..." 
                style={inputBox}
              />
              <button onClick={handleFetchCPHSamples} disabled={isFetchingSamples} style={fetchBtn}>
                {isFetchingSamples ? 'Scraping...' : 'Fetch'}
              </button>
            </div>
          </div>

          <div style={paneHeader}>Custom Input (stdin)</div>
          <div style={{ flex: 0.4, padding: 10, display: 'flex' }}>
            <textarea 
              value={customInput} 
              onChange={e => setCustomInput(e.target.value)} 
              placeholder="Provide custom input here or fetch it using the CPH tool above..."
              style={{ ...codeEditor, border: '1px solid #334155', borderRadius: 8 }} 
            />
          </div>
          
          <div style={paneHeader}>Execution Result (stdout)</div>
          <div style={{ flex: 0.6, padding: 10, overflow: 'auto', background: '#020617', borderTop: '1px solid #1e293b' }}>
            {isRunning ? (
              <span style={{ color: '#fbbf24', fontFamily: 'monospace' }}>Running code on Judge0 cluster...</span>
            ) : runResult ? (
              <div style={{ fontFamily: 'monospace', fontSize: 14 }}>
                <div style={{ color: runResult.status?.id === 3 ? '#4ade80' : '#f87171', fontWeight: 'bold', marginBottom: 15, fontSize: 16 }}>
                  Verdict: {runResult.status?.description || 'Error'}
                </div>
                {runResult.compile_output && (
                  <div style={{ marginBottom: 15 }}>
                    <div style={{ color: '#f87171', marginBottom: 4 }}>Compile Output:</div>
                    <pre style={resultBlock}>{atob(runResult.compile_output)}</pre>
                  </div>
                )}
                {runResult.stdout && (
                  <div style={{ marginBottom: 15 }}>
                    <div style={{ color: '#94a3b8', marginBottom: 4 }}>Standard Output:</div>
                    <pre style={{...resultBlock, color: '#fff'}}>{atob(runResult.stdout)}</pre>
                  </div>
                )}
                {runResult.stderr && (
                  <div style={{ marginBottom: 15 }}>
                    <div style={{ color: '#f87171', marginBottom: 4 }}>Standard Error:</div>
                    <pre style={resultBlock}>{atob(runResult.stderr)}</pre>
                  </div>
                )}
                <div style={{ color: '#64748b', fontSize: 12, marginTop: 15 }}>
                  Execution Time: {runResult.time}s | Memory: {runResult.memory}KB
                </div>
              </div>
            ) : (
              <span style={{ color: '#64748b', fontFamily: 'monospace' }}>Output will appear here.</span>
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
const runBtn: CSSProperties = { background: '#3b82f6', border: 'none', color: '#fff', padding: '10px 20px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', transition: '0.2s' };
const selectBox: CSSProperties = { background: '#1e293b', color: '#fff', border: '1px solid #334155', padding: '10px', borderRadius: 8, outline: 'none', fontWeight: 'bold' };
const splitLayout: CSSProperties = { display: 'flex', flex: 1, overflow: 'hidden', gap: 12, padding: 12, flexDirection: 'row' };
const leftPane: CSSProperties = { flex: 0.6, background: '#0f172a', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #1e293b' };
const rightPane: CSSProperties = { flex: 0.4, background: '#0f172a', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #1e293b' };
const paneHeader: CSSProperties = { padding: '12px 20px', background: '#1e293b', fontWeight: 'bold', fontSize: 14, color: '#94a3b8' };
const paneContent: CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', padding: 10 };
const codeEditor: CSSProperties = { width: '100%', height: '100%', flex: 1, background: '#020617', color: '#a5b4fc', border: 'none', outline: 'none', fontFamily: 'monospace', fontSize: 15, resize: 'none', lineHeight: '1.6', padding: 15 };
const cphCard: CSSProperties = { padding: 20, background: 'linear-gradient(145deg, rgba(15,23,42,1), rgba(2,6,23,1))', borderBottom: '1px solid #1e293b' };
const inputBox: CSSProperties = { flex: 1, padding: 12, borderRadius: 8, border: '1px solid #334155', background: '#020617', color: '#fff', outline: 'none' };
const fetchBtn: CSSProperties = { background: '#0d9488', color: '#fff', border: 'none', padding: '0 20px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' };
const resultBlock: CSSProperties = { background: 'rgba(248, 113, 113, 0.1)', padding: 12, color: '#f87171', borderRadius: 8, overflow: 'auto', border: '1px solid rgba(248, 113, 113, 0.2)', margin: 0 };