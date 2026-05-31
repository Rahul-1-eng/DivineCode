import { CSSProperties, useState } from 'react';
import { useSession } from 'next-auth/react';

export async function getServerSideProps() { return { props: {} }; }

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;
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
  
  const [testCases, setTestCases] = useState<TestCase[]>([
    { id: 1, input: '', expectedOutput: '', actualOutput: '', error: '', verdict: '' }
  ]);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState<number>(1);

  const currentTestCase = testCases.find(tc => tc.id === selectedTestCaseId) || testCases[0];

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
    try {
      const res = await fetch(`${API_V2_BASE_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceCode: code,
          language,
          input: tc.input,
          expectedOutput: tc.expectedOutput || undefined
        })
      });

      const data = await res.json();
      
      return {
        id: tc.id,
        actualOutput: data.stdout || '',
        error: data.compileError || data.stderr || '',
        verdict: data.verdict as TestCase['verdict']
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

    for (let i = 0; i < updatedCases.length; i++) {
      setSelectedTestCaseId(updatedCases[i].id);
      const result = await runTestCase(updatedCases[i]);
      
      updatedCases[i] = {
        ...updatedCases[i],
        actualOutput: result.actualOutput,
        error: result.error,
        verdict: result.verdict
      };
    }

    setTestCases(updatedCases);
    setExecuting(false);
  }

  const passedCount = testCases.filter(tc => tc.verdict === 'ACCEPTED').length;

  return (
    <main style={page}>
      <nav style={nav}>
        <a href="/" style={brand}>DivineCode Sandbox</a>
        <div style={userPill}>{session?.user?.name || session?.user?.email || 'Guest Debugger'}</div>
      </nav>

      <section style={layout}>
        <aside style={leftPanel}>
          <div style={panelHeader}>
            <h2>CPH JUDGE: RESULTS</h2>
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
              <h3>Test Case Parameters</h3>
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
            {executing ? 'Compiling Code Suite...' : '⚡ Run All Test Cases'}
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

const page: CSSProperties = { minHeight: '100vh', padding: 24, fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: '#070a16' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 };
const brand: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 900, fontSize: 20 };
const userPill: CSSProperties = { padding: '8px 14px', borderRadius: 999, background: 'rgba(15,23,42,.82)', border: '1px solid rgba(148,163,184,.22)', fontSize: 14 };
const layout: CSSProperties = { display: 'grid', gridTemplateColumns: '420px 1fr', gap: 20, height: 'calc(100vh - 100px)' };
const leftPanel: CSSProperties = { padding: 20, borderRadius: 22, background: 'rgba(15,23,42,.86)', border: '1px solid rgba(148,163,184,.22)', display: 'flex', flexDirection: 'column' };
const rightPanel: CSSProperties = { borderRadius: 22, background: '#020617', border: '1px solid rgba(148,163,184,.22)', overflow: 'hidden', display: 'flex', flexDirection: 'column' };
const panelHeader: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 };
const badge: CSSProperties = { padding: '4px 10px', background: 'rgba(34,211,238,.15)', color: '#67e8f9', borderRadius: 6, fontSize: 13, fontWeight: 'bold' };
const tabBar: CSSProperties = { display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 };
const tab: CSSProperties = { padding: '8px 14px', background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.1)', borderRadius: 8, color: '#94a3b8', cursor: 'pointer', fontWeight: 'bold', fontSize: 13 };
const activeTab: CSSProperties = { ...tab, background: '#1e293b', color: '#67e8f9', borderColor: '#67e8f9' };
const addTabBtn: CSSProperties = { ...tab, background: '#22c55e', color: 'white', borderColor: 'transparent' };
const workspace: CSSProperties = { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 };
const rowHeader: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const label: CSSProperties = { fontSize: 13, color: '#94a3b8', fontWeight: 'bold', marginTop: 4 };
const terminalBox: CSSProperties = { width: '100%', minHeight: '120px', padding: 10, background: '#020617', border: '1px solid rgba(148,163,184,.16)', borderRadius: 10, color: '#e2e8f0', fontFamily: 'monospace', fontSize: 13, outline: 'none', resize: 'vertical' };
const outBox: CSSProperties = { margin: 0, padding: 10, background: 'rgba(34,211,238,.05)', border: '1px solid rgba(34,211,238,.15)', borderRadius: 10, color: '#38bdf8', fontFamily: 'monospace', fontSize: 13, whiteSpace: 'pre-wrap' };
const errBox: CSSProperties = { ...outBox, color: '#f87171', background: 'rgba(248,113,113,.05)', borderColor: 'rgba(248,113,113,.15)' };
const deleteBtn: CSSProperties = { padding: '4px 8px', background: 'rgba(239,68,68,.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,.2)', borderRadius: 6, fontSize: 12, cursor: 'pointer' };
const runAllBtn: CSSProperties = { width: '100%', marginTop: 16, padding: 14, borderRadius: 12, border: 0, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontWeight: 950, cursor: 'pointer', fontSize: 15 };
const editorHeader: CSSProperties = { padding: 14, background: 'rgba(2,6,23,.65)', borderBottom: '1px solid rgba(148,163,184,.16)' };
const selector: CSSProperties = { padding: '6px 10px', background: '#0f172a', border: '1px solid rgba(148,163,184,.2)', borderRadius: 8, color: '#fff', fontSize: 13, outline: 'none' };
const editorCodeBox: CSSProperties = { width: '100%', flex: 1, padding: 20, border: 0, outline: 0, background: 'transparent', color: '#e2e8f0', fontSize: 14, lineHeight: 1.6, fontFamily: 'JetBrains Mono, Consolas, monospace', resize: 'none' };