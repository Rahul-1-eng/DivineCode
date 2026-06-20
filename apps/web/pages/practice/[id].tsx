import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';

const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false, loading: () => <div style={{padding: 20, color: '#64748b'}}>Loading Editor...</div> });
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function ProblemWorkspace() {
  const router = useRouter();
  const { id } = router.query;
  const { data: session } = useSession(); 

  const [problem, setProblem] = useState<any>(null);
  const [language, setLanguage] = useState('cpp');
  const [code, setCode] = useState('// Write your solution here...');
  const [outputs, setOutputs] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<'console' | 'ai'>('console');

  const [aiExplanation, setAiExplanation] = useState('');
  const [isExplaining, setIsExplaining] = useState(false);

  useEffect(() => {
    if (!id) return;
    
    fetch(`${API_BASE_URL}/api/v2/ai-dataset`, { headers: { 'x-user-email': session?.user?.email || '' } })
      .then((r) => r.json())
      .then(data => {
         if (data.problems) {
            const found = data.problems.find((p: any) => p.id === id);
            if (found) {
               setProblem(found);
            } else {
               setProblem({ error: true, title: 'Not Found', description: 'Could not find this problem in the database.' });
            }
         }
      })
      .catch(err => setProblem({ error: true, title: 'Error', description: 'Failed to load.' }));
  }, [id, session]);

  // NEW: Defense in depth redirect
  useEffect(() => {
    if (!problem || problem.error) return;
    const hasRealDescription = problem.descriptionHtml && problem.descriptionHtml.replace(/<[^>]*>/g, '').trim().length > 15;
    if (!hasRealDescription && problem.originalUrl) {
      window.location.replace(problem.originalUrl);
    }
  }, [problem]);

  const sampleData = useMemo(() => {
    if (!problem || !problem.testcases) return { input: '', output: '' };
    try {
      const parsed = typeof problem.testcases === 'string' 
        ? JSON.parse(problem.testcases) 
        : problem.testcases;
      
      if (Array.isArray(parsed) && parsed.length > 0) {
        return {
          input: parsed[0].input || parsed[0].stdin || '',
          output: parsed[0].expectedOutput || parsed[0].output || ''
        };
      }
    } catch (e) {
      console.error("Failed parsing testcase array on frontend:", e);
    }
    return { input: '', output: '' };
  }, [problem]);

  async function runCode() {
    if (!problem || problem.error) return;
    setRunning(true);
    setActiveTab('console');
    try {
      const res = await fetch(`${API_BASE_URL}/api/v2/submissions/run-samples`, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', 'x-user-email': session?.user?.email || '' },
        body: JSON.stringify({ problemId: problem.id, code, language })
      });
      const data = await res.json();
      setOutputs(data.results || []);
    } catch (err) { alert('Failed to connect to execution server.'); } finally { setRunning(false); }
  }

  async function handleGenerateExplanation() {
    if (!problem || problem.error) return;
    setIsExplaining(true);
    try {
      const prompt = `Please explain the optimal approach for this problem step-by-step.\n\nTitle: ${problem.title}\n\nMy Code:\n${code}`;
      const res = await fetch(`${API_BASE_URL}/api/v2/ai/chat`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         // FIXED: Passed history array to satisfy backend validation
         body: JSON.stringify({ message: prompt, history: [] })
      });
      const data = await res.json();
      setAiExplanation(data.reply);
    } catch (err) {
      setAiExplanation("Error connecting to AI Mentor. Please try again.");
    } finally {
      setIsExplaining(false);
    }
  }

  if (!problem) return (
    <main style={{ padding: 40, background: '#070a16', color: 'white', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 50, height: 50, borderTop: '3px solid #22d3ee', borderRadius: '50%', animation: 'spin 1s linear infinite' }}/>
      <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </main>
  );

  const monacoLanguage = language === 'cpp' ? 'cpp' : language === 'python' ? 'python' : 'c';

  const problemDescriptionHtml = problem.descriptionHtml || problem.description || problem.content || '';
  const hasDescription = problemDescriptionHtml && problemDescriptionHtml.replace(/<[^>]*>/g, '').trim().length > 10;

  return (
    <main style={{ display: 'flex', height: '100vh', background: '#070a16', color: '#fff', fontFamily: 'Inter, sans-serif' }}>
      
      <section style={{ width: '40%', padding: 30, overflowY: 'auto', borderRight: '1px solid #1e293b', background: '#0f172a', paddingBottom: '60px' }}>
        <a href="/practice" style={{ color: '#67e8f9', textDecoration: 'none', fontWeight: 900, display: 'inline-block', marginBottom: 16 }}>← Back to Practice</a>
        <h1 style={{ margin: '0 0 8px 0', color: problem.error ? '#ef4444' : '#fff' }}>{problem.title}</h1>
        {!problem.error && <div style={{ color: '#67e8f9', marginBottom: 20 }}>Difficulty: {problem.difficulty || problem.rating || 'Unrated'}</div>}
        
        {/* FIXED: Robust External Link Fallback */}
        {hasDescription ? (
            <div style={{ lineHeight: 1.7, color: '#cbd5e1', fontSize: '15px' }} dangerouslySetInnerHTML={{__html: problemDescriptionHtml}}></div>
        ) : (
            <div style={{ padding: 30, background: '#1e1b4b', borderRadius: 12, border: '1px solid #6366f1', textAlign: 'center', marginTop: 20 }}>
               <h3 style={{ color: '#eef2ff', margin: '0 0 10px' }}>Problem Details Hidden</h3>
               <p style={{ color: '#cbd5e1', marginBottom: 20 }}>Due to platform restrictions, this description cannot be rendered natively.</p>
               {problem.originalUrl && (
                  <a href={problem.originalUrl} target="_blank" rel="noreferrer" style={{ background: '#6366f1', color: '#fff', padding: '10px 20px', borderRadius: 8, textDecoration: 'none', fontWeight: 'bold', display: 'inline-block' }}>
                    View Original Problem ↗
                  </a>
               )}
            </div>
        )}

        {/* FIXED: Dynamic YouTube Embed */}
        {!problem.error && (
          <div style={{ marginTop: 40, padding: 20, background: '#020617', borderRadius: 12, border: '1px solid #1e293b' }}>
               <h3 style={{ color: '#f87171', margin: '0 0 15px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  ▶️ Video Tutorial
               </h3>
               <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden', borderRadius: 8, background: '#000' }}>
                   <iframe 
                     style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} 
                     src={`https://www.youtube.com/embed?listType=search&list=${encodeURIComponent((problem.title || 'Coding Problem') + ' solution')}`}
                     title="YouTube Search Results" 
                     frameBorder="0" 
                     allowFullScreen
                   />
               </div>
               <p style={{ color: '#64748b', fontSize: 12, marginTop: 10, textAlign: 'center' }}>First search result mapped dynamically.</p>
          </div>
        )}

        {(sampleData.input || sampleData.output) && (
          <div style={{ marginTop: 24, padding: 16, borderRadius: 12, background: '#020617', border: '1px solid rgba(148,163,184,.18)' }}>
            {sampleData.input && (
              <><strong style={{ display: 'block', marginBottom: 8, color: '#94a3b8' }}>Sample Input</strong>
              <pre style={{ margin: '0 0 16px 0', color: '#e2e8f0', background: '#0f172a', padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap' }}>{sampleData.input}</pre></>
            )}
            {sampleData.output && (
              <><strong style={{ display: 'block', marginBottom: 8, color: '#94a3b8' }}>Expected Output</strong>
              <pre style={{ margin: 0, color: '#e2e8f0', background: '#0f172a', padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap' }}>{sampleData.output}</pre></>
            )}
          </div>
        )}
      </section>

      <section style={{ width: '60%', display: 'flex', flexDirection: 'column', background: '#020617' }}>
        <div style={{ padding: 12, background: '#0f172a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b' }}>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} style={selectControl}>
            <option value="cpp">C++ (GCC 9.2)</option>
            <option value="python">Python 3</option>
            <option value="c">C</option>
          </select>
          <button onClick={runCode} disabled={running || problem.error} style={runBtn}>{running ? 'Running...' : 'Run Code ▶'}</button>
        </div>

        <div style={{ flex: 1 }}>
          <Editor
            height="100%" theme="vs-dark" language={monacoLanguage} value={code} onChange={(val) => setCode(val || '')}
            options={{ minimap: { enabled: false }, fontSize: 15, padding: { top: 16 } }}
          />
        </div>

        <div style={{ height: '40%', background: '#020617', borderTop: '1px solid #1e293b', display: 'flex', flexDirection: 'column' }}>
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
              <div style={{ paddingTop: 10 }}>
                {aiExplanation ? (
                  <div style={{ background: '#0f172a', padding: 20, borderRadius: 12, border: '1px solid #334155' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                       <h3 style={{ color: '#a5b4fc', margin: 0 }}>🤖 AI Mentor Analysis</h3>
                       <button onClick={handleGenerateExplanation} disabled={isExplaining} style={{ background: 'transparent', border: '1px solid #a5b4fc', color: '#a5b4fc', padding: '6px 12px', borderRadius: 8, cursor: 'pointer' }}>
                         {isExplaining ? 'Thinking...' : 'Regenerate'}
                       </button>
                    </div>
                    <div style={{ color: '#cbd5e1', fontSize: 15, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                      {aiExplanation}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', marginTop: 40 }}>
                    <h3 style={{ color: '#a5b4fc', marginTop: 0 }}>🤖 Interactive AI Explainer</h3>
                    <p style={{ color: '#cbd5e1', marginBottom: 20 }}>Stuck? Let the AI break down the optimal approach step-by-step.</p>
                    <button onClick={handleGenerateExplanation} disabled={isExplaining || problem.error} style={{ background: '#5356ff', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' }}>
                      {isExplaining ? 'Analyzing problem and code...' : 'Generate Explanation'}
                    </button>
                  </div>
                )}
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