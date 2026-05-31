import { CSSProperties, useState, useRef } from 'react';
import { useSession } from 'next-auth/react';

export async function getServerSideProps() { return { props: {} }; }

const WANDBOX_URL = 'https://wandbox.org/api/compile.json';

const languageMap: Record<string, string> = {
  cpp: 'gcc-head',
  c: 'gcc-head-c',
  java: 'openjdk-head',
  python: 'cpython-head',
  javascript: 'nodejs-head'
};

const starterCode = `#include <bits/stdc++.h>\nusing namespace std;\n\nvoid solve() {\n    // Write your solution here\n}\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    solve();\n    return 0;\n}\n`;

interface TestCase {
  id: number;
  input: string;
  expectedOutput: string;
  actualOutput: string;
  error: string;
  verdict: 'PENDING' | 'ACCEPTED' | 'WRONG_ANSWER' | 'COMPILATION_ERROR' | 'RUNTIME_ERROR' | '';
}

export default function StandaloneJudgePage() {
  const { data: session } = useSession();
  const [language, setLanguage] = useState('cpp');
  const [code, setCode] = useState(starterCode);
  const [executing, setExecuting] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  
  const [testCases, setTestCases] = useState<TestCase[]>([
    { id: 1, input: '', expectedOutput: '', actualOutput: '', error: '', verdict: '' }
  ]);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState<number>(1);

  const currentTestCase = testCases.find(tc => tc.id === selectedTestCaseId) || testCases[0];
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playSuccessSound = () => {
    if (soundEnabled && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(e => console.log("Audio autoplay blocked"));
    }
  };

  function updateCurrentTestCase(fields: Partial<TestCase>) {
    setTestCases(prev => prev.map(tc => tc.id === selectedTestCaseId ? { ...tc, ...fields } : tc));
  }

  function addNewTestCase() {
    const newId = testCases.length ? Math.max(...testCases.map(t => t.id)) + 1 : 1;
    setTestCases(prev => [...prev, { id: newId, input: '', expectedOutput: '', actualOutput: '', error: '', verdict: '' }]);
    setSelectedTestCaseId(newId);
  }

  function deleteTestCase(idToDelete: number) {
    if (testCases.length === 1) return;
    const filtered = testCases.filter(tc => tc.id !== idToDelete);
    setTestCases(filtered);
    setSelectedTestCaseId(filtered[0].id);
  }

  async function runTestCase(tc: TestCase) {
    const compiler = languageMap[language];
    try {
      const response = await fetch(WANDBOX_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compiler, code, stdin: tc.input || '' })
      });

      if (!response.ok) throw new Error('Execution failed');
      const data = await response.json();

      let error = '';
      let verdict: TestCase['verdict'] = 'PENDING';
      
      if (data.compiler_error) {
        error = data.compiler_error;
        verdict = 'COMPILATION_ERROR';
      } else if (data.status !== '0') {
        error = data.program_error || 'Runtime error occurred';
        verdict = 'RUNTIME_ERROR';
      } else {
        const actual = String(data.program_message || '').trim().replace(/\s+/g, ' ');
        if (tc.expectedOutput) {
          const expected = String(tc.expectedOutput || '').trim().replace(/\s+/g, ' ');
          verdict = actual === expected ? 'ACCEPTED' : 'WRONG_ANSWER';
        } else {
          verdict = 'ACCEPTED'; 
        }
      }

      return {
        id: tc.id,
        actualOutput: data.program_message || '',
        error: error,
        verdict: verdict
      };
    } catch (e) {
      return {
        id: tc.id,
        actualOutput: '',
        error: 'Execution platform communication link failed.',
        verdict: 'RUNTIME_ERROR' as const
      };
    }
  }

  async function runAllTestCases() {
    setExecuting(true);
    const updatedCases = [...testCases];
    let anyPassed = false;

    for (let i = 0; i < updatedCases.length; i++) {
      setSelectedTestCaseId(updatedCases[i].id);
      const result = await runTestCase(updatedCases[i]);
      
      updatedCases[i] = { ...updatedCases[i], actualOutput: result.actualOutput, error: result.error, verdict: result.verdict };
      if (result.verdict === 'ACCEPTED') anyPassed = true;
    }

    setTestCases(updatedCases);
    setExecuting(false);
    if (anyPassed) playSuccessSound();
  }

  const passedCount = testCases.filter(tc => tc.verdict === 'ACCEPTED').length;

  return (
    <main style={page}>
      <audio ref={audioRef} src="/accepted.mp3" preload="auto" />

      {executing && (
        <div style={overlay}>
          <div style={overlayModal}>
            <h2 style={{ color: '#fff', margin: '0 0 10px 0' }}>Compiling Suite...</h2>
            <p style={{ color: '#67e8f9', margin: 0, fontSize: 14 }}>Running test cases against execution engine</p>
          </div>
        </div>
      )}

      <nav style={nav}>
        <a href="/" style={brand}>DivineCode Sandbox</a>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={() => setSoundEnabled(!soundEnabled)} style={soundBtn}>
            {soundEnabled ? '🔊 Sound On' : '🔇 Muted'}
          </button>
          <div style={userPill}>{session?.user?.name || session?.user?.email || 'Guest Debugger'}</div>
        </div>
      </nav>

      <section style={layout}>
        <aside style={leftPanel}>
          <div style={panelHeader}>
            <h2 style={{ margin: 0 }}>CPH JUDGE: RESULTS</h2>
            <span style={badge}>{passedCount} / {testCases.length} passed</span>
          </div>

          <div style={tabBar}>
            {testCases.map((tc, idx) => (
              <button 
                key={tc.id} 
                onClick={() => setSelectedTestCaseId(tc.id)}
                style={tc.id === selectedTestCaseId ? activeTab : tab}
              >
                TC {idx + 1} {tc.verdict === 'ACCEPTED' ? '✅' : tc.verdict === 'WRONG_ANSWER' ? '❌' : ''}
              </button>
            ))}
            <button onClick={addNewTestCase} style={addTabBtn}>+ New</button>
          </div>

          <div style={workspace}>
            <div style={rowHeader}>
              <h3 style={{ margin: 0 }}>Test Case Parameters</h3>
              {testCases.length > 1 && (
                <button onClick={() => deleteTestCase(currentTestCase.id)} style={deleteBtn}>Wipe Case</button>
              )}
            </div>

            <label style={label}>Input Data:</label>
            <textarea
              value={currentTestCase.input}
              onChange={e => updateCurrentTestCase({ input: e.target.value })}
              placeholder="Provide system stdin data..."
              style={terminalBox}
            />

            <label style={label}>Expected Output (Optional):</label>
            <textarea
              value={currentTestCase.expectedOutput}
              onChange={e => updateCurrentTestCase({ expectedOutput: e.target.value })}
              placeholder="Provide matching assertions..."
              style={terminalBox}
            />

            {currentTestCase.verdict && (
              <div style={{ marginTop: 12 }}>
                <label style={label}>Execution Status Output:</label>
                <pre style={currentTestCase.error ? errBox : outBox}>
                  {currentTestCase.error || currentTestCase.actualOutput || 'Empty system stdout returned.'}
                </pre>
              </div>
            )}
          </div>

          <button onClick={runAllTestCases} disabled={executing} style={runAllBtn}>
            ⚡ Run All Test Cases
          </button>
        </aside>

        <section style={rightPanel}>
          <div style={editorHeader}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <strong style={{ color: '#eef2ff' }}>Interactive Workspace</strong>
              <select value={language} onChange={e => setLanguage(e.target.value)} style={selector}>
                <option value="cpp">C++</option>
                <option value="java">Java</option>
                <option value="python">Python</option>
                <option value="javascript">JavaScript</option>
                <option value="c">C</option>
              </select>
            </div>
          </div>
          <textarea
            value={code}
            onChange={e => setCode(e.target.value)}
            spellCheck={false}
            style={editorCodeBox}
          />
        </section>
      </section>
    </main>
  );
}

// RESTORED CSS PROPERTIES
const page: CSSProperties = { minHeight: '100vh', padding: 24, fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: '#070a16', boxSizing: 'border-box' };
const nav: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 };
const brand: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 900, fontSize: 20 };
const userPill: CSSProperties = { padding: '8px 14px', borderRadius: 999, background: 'rgba(15,23,42,.82)', border: '1px solid rgba(148,163,184,.22)', fontSize: 14 };
const soundBtn: CSSProperties = { padding: '8px 14px', borderRadius: 999, background: '#0f172a', border: '1px solid rgba(148,163,184,.22)', color: '#fff', fontSize: 14, cursor: 'pointer' };

// 👉 THE FIX FOR DEVICES: Using Flex Wrap instead of rigid Grid
const layout: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 20, minHeight: 'calc(100vh - 100px)' };
const leftPanel: CSSProperties = { flex: '1 1 400px', minWidth: 300, padding: 20, borderRadius: 22, background: 'rgba(15,23,42,.86)', border: '1px solid rgba(148,163,184,.22)', display: 'flex', flexDirection: 'column' };
const rightPanel: CSSProperties = { flex: '2 1 500px', minWidth: 300, minHeight: 600, borderRadius: 22, background: '#020617', border: '1px solid rgba(148,163,184,.22)', overflow: 'hidden', display: 'flex', flexDirection: 'column' };

const panelHeader: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 };
const badge: CSSProperties = { padding: '4px 10px', background: 'rgba(34,211,238,.15)', color: '#67e8f9', borderRadius: 6, fontSize: 13, fontWeight: 'bold' };
const tabBar: CSSProperties = { display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 };
const tab: CSSProperties = { padding: '8px 14px', background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.1)', borderRadius: 8, color: '#94a3b8', cursor: 'pointer', fontWeight: 'bold', fontSize: 13, whiteSpace: 'nowrap' };
const activeTab: CSSProperties = { ...tab, background: '#1e293b', color: '#67e8f9', borderColor: '#67e8f9' };
const addTabBtn: CSSProperties = { ...tab, background: '#22c55e', color: 'white', borderColor: 'transparent' };
const workspace: CSSProperties = { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 };
const rowHeader: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const label: CSSProperties = { fontSize: 13, color: '#94a3b8', fontWeight: 'bold', marginTop: 4 };
const terminalBox: CSSProperties = { width: '100%', boxSizing: 'border-box', minHeight: '120px', padding: 10, background: '#020617', border: '1px solid rgba(148,163,184,.16)', borderRadius: 10, color: '#e2e8f0', fontFamily: 'monospace', fontSize: 13, outline: 'none', resize: 'vertical' };
const outBox: CSSProperties = { margin: 0, padding: 10, background: 'rgba(34,211,238,.05)', border: '1px solid rgba(34,211,238,.15)', borderRadius: 10, color: '#38bdf8', fontFamily: 'monospace', fontSize: 13, whiteSpace: 'pre-wrap' };
const errBox: CSSProperties = { ...outBox, color: '#f87171', background: 'rgba(248,113,113,.05)', borderColor: 'rgba(248,113,113,.15)' };
const deleteBtn: CSSProperties = { padding: '4px 8px', background: 'rgba(239,68,68,.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,.2)', borderRadius: 6, fontSize: 12, cursor: 'pointer' };
const runAllBtn: CSSProperties = { width: '100%', marginTop: 16, padding: 14, borderRadius: 12, border: 0, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontWeight: 950, cursor: 'pointer', fontSize: 15 };
const editorHeader: CSSProperties = { padding: 14, background: 'rgba(2,6,23,.65)', borderBottom: '1px solid rgba(148,163,184,.16)' };
const selector: CSSProperties = { padding: '6px 10px', background: '#0f172a', border: '1px solid rgba(148,163,184,.2)', borderRadius: 8, color: '#fff', fontSize: 13, outline: 'none' };
const editorCodeBox: CSSProperties = { width: '100%', boxSizing: 'border-box', flex: 1, padding: 20, border: 0, outline: 0, background: 'transparent', color: '#e2e8f0', fontSize: 14, lineHeight: 1.6, fontFamily: 'JetBrains Mono, Consolas, monospace', resize: 'none' };

const overlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(2,6,23,0.8)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 50 };
const overlayModal: CSSProperties = { padding: 30, backgroundColor: '#0f172a', border: '1px solid rgba(103,232,249,0.3)', borderRadius: 20, textAlign: 'center', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' };