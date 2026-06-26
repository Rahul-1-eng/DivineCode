import { CSSProperties, useState, useEffect } from 'react';
import Head from 'next/head';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import toast, { Toaster } from 'react-hot-toast';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

type TestCase = { id: string; input: string; expectedOutput: string; output: string; status: 'idle' | 'running' | 'passed' | 'failed' | 'error' };

export default function JudgePage() {
  const { data: session } = useSession();
  
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('cpp');
  
  const [activeTab, setActiveTab] = useState<'cph' | 'ai'>('cph');
  const [testcases, setTestcases] = useState<TestCase[]>([{ id: '1', input: '', expectedOutput: '', output: '', status: 'idle' }]);
  const [cfUrl, setCfUrl] = useState('');
  const [imageBase64, setImageBase64] = useState('');
  
  const [isFetchingSamples, setIsFetchingSamples] = useState(false);
  const [aiGenDesc, setAiGenDesc] = useState('');
  const [aiGenLoading, setAiGenLoading] = useState(false);
  const [globalLoadingText, setGlobalLoadingText] = useState('');

  useEffect(() => {
    const savedCode = localStorage.getItem('divinecode_playground_code');
    const savedLang = localStorage.getItem('divinecode_playground_lang');
    if (savedCode) setCode(savedCode);
    if (savedLang) setLanguage(savedLang);
  }, []);

  useEffect(() => {
    localStorage.setItem('divinecode_playground_code', code);
    localStorage.setItem('divinecode_playground_lang', language);
  }, [code, language]);

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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setImageBase64(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const runTestCase = async (index: number) => {
    if (!code.trim()) return toast.error("Code cannot be empty");
    
    const newCases = [...testcases];
    newCases[index].status = 'running';
    newCases[index].output = '';
    setTestcases(newCases);

    try {
      const res = await fetch(`${API_V2_BASE_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-email': session?.user?.email || '' },
        body: JSON.stringify({ sourceCode: code, language, input: newCases[index].input })
      });
      
      const data = await res.json();
      
      let actualOut = 'No Output';
      if (data.stdout) {
         try { actualOut = atob(data.stdout).trim(); } 
         catch { actualOut = data.stdout.trim(); } 
      } else if (data.stderr || data.compileError) {
         actualOut = data.stderr || data.compileError;
         newCases[index].status = 'error';
      }

      const expectedOut = newCases[index].expectedOutput.trim();
      newCases[index].output = actualOut;
      
      if (newCases[index].status !== 'error') {
        newCases[index].status = (actualOut === expectedOut || !expectedOut) ? 'passed' : 'failed';
      }
    } catch (e) {
      newCases[index].status = 'error';
      newCases[index].output = 'Connection error: Judge engine unreachable.';
    }
    setTestcases([...newCases]);
  };

  const runAllTestcases = async () => {
    for (let i = 0; i < testcases.length; i++) {
      await runTestCase(i);
    }
  };

  const handleFetchCPHSamples = async () => {
    if (!cfUrl) return toast.error('Enter a URL');
    setGlobalLoadingText('Attempting standard extraction...');
    setIsFetchingSamples(true);
    
    try {
      const res = await fetch(`${API_V2_BASE_URL}/proxy/problem?url=${encodeURIComponent(cfUrl)}`);
      const data = await res.json();
      if (data.requiresRedirect) {
         toast.error("Extraction failed. Redirecting to problem page...");
         window.open(data.url, '_blank');
         return;
      }

      if (!res.ok || !data.html) throw new Error();
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(data.html, 'text/html');
      const inputNodes = Array.from(doc.querySelectorAll('.input pre')).map(el => el.textContent?.trim() || '');
      const outputNodes = Array.from(doc.querySelectorAll('.output pre')).map(el => el.textContent?.trim() || '');
      
      const newCases: TestCase[] = inputNodes.map((inp, idx) => ({
        id: Date.now().toString() + idx, input: inp, expectedOutput: outputNodes[idx] || '', output: '', status: 'idle' as const
      }));
      setTestcases(newCases);
      toast.success("Extraction successful!");
      
    } catch (error) {
      toast.error("Extraction failed. Try the AI tab.");
    } finally {
      setIsFetchingSamples(false);
    }
  };

  const handleGenerateTestcases = async () => {
    if (!aiGenDesc && !imageBase64) return toast.error("Upload an image or paste description.");
    setGlobalLoadingText('AI is generating hidden test cases...');
    setAiGenLoading(true);
    
    try {
      const payload = imageBase64 ? `Analyze this problem image and extract tricky edge test cases. Image Data: ${imageBase64}` : aiGenDesc;
      
      const res = await fetch(`${API_V2_BASE_URL}/ai/generate-testcases`, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', 'x-user-email': session?.user?.email || '' },
        body: JSON.stringify({ problemDescription: payload })
      });
      const data = await res.json();
      if (res.ok && data.testcases) {
        const generated: TestCase[] = data.testcases.map((tc: any, i: number) => ({
          id: 'gen' + i, input: tc.input, expectedOutput: tc.expectedOutput, output: '', status: 'idle' as const
        }));
        setTestcases(generated);
        setActiveTab('cph');
        toast.success("AI generated hidden test cases!");
      } else {
        toast.error(data.error || "AI generation failed.");
      }
    } catch (e) {
      toast.error("Network error.");
    } finally { 
      setAiGenLoading(false); 
    }
  };

  return (
    <main style={{...page, minHeight: '100vh', height: 'auto'}}>
      <Head><title>Universal Judge | DivineCode</title></Head>
      <Toaster position="top-center" toastOptions={{ style: { background: 'var(--bg-panel-solid)', color: 'var(--text-main)', border: '1px solid var(--border-color)' } }} />

      <AnimatePresence>
        {(isFetchingSamples || aiGenLoading) && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.85)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} style={{ width: 64, height: 64, border: '5px solid var(--border-color)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%' }} />
            <motion.h2 style={{ color: 'var(--accent-primary)', marginTop: 24, fontSize: 24 }}>{globalLoadingText}</motion.h2>
          </motion.div>
        )}
      </AnimatePresence>

      <header style={headerBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <a href="/" style={brand}>← DivineCode</a>
          <strong style={{ color: 'var(--text-main)', fontSize: 18 }}>Universal Playground</strong>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} style={selectBox}>
            <option value="cpp">C++</option>
            <option value="python">Python</option>
            <option value="java">Java</option>
          </select>
          <button onClick={runAllTestcases} style={runBtn}>Run All Tests ▶</button>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 12, padding: 12, flexWrap: 'wrap' }}>
        <section style={{ flex: '1 1 600px', background: 'var(--bg-panel)', borderRadius: 12, border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
          <div style={paneHeader}>Code Editor (Autosaves)</div>
          <textarea 
            value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={handleEditorKeyDown}
            style={codeEditor} spellCheck={false} placeholder={`// Write your ${language} solution here...`}
          />
        </section>

        <section style={{ flex: '1 1 500px', background: 'var(--bg-panel)', borderRadius: 12, border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
          <div style={tabsHeader}>
            <button style={activeTab === 'cph' ? activeTabStyle : inactiveTabStyle} onClick={() => setActiveTab('cph')}>Platform Cases</button>
            <button style={activeTab === 'ai' ? activeTabStyle : inactiveTabStyle} onClick={() => setActiveTab('ai')}>AI OCR & Generation</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {activeTab === 'cph' && (
              <>
                <div style={{ padding: 15, background: 'var(--bg-panel-solid)' }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input type="text" value={cfUrl} onChange={(e) => setCfUrl(e.target.value)} placeholder="Paste any problem URL..." style={inputBox} />
                    <button onClick={handleFetchCPHSamples} style={fetchBtn}>Extract Data</button>
                  </div>
                </div>

                <div style={{ padding: 15 }}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 15 }}>
                     {testcases.map((tc, idx) => (
                        <div key={`dot-${idx}`} style={{ width: 10, height: 10, borderRadius: '50%', background: tc.status === 'passed' ? '#22c55e' : tc.status === 'failed' || tc.status === 'error' ? '#ef4444' : tc.status === 'running' ? '#eab308' : 'var(--text-muted)' }} title={`Test ${idx+1}`} />
                     ))}
                  </div>

                  {testcases.map((tc, idx) => (
                    <div key={tc.id} style={tcCard}>
                      <div style={tcHeader}>
                        <strong style={{ color: 'var(--text-main)' }}>Test Case {idx + 1}</strong>
                        <span style={{ color: tc.status === 'passed' ? '#4ade80' : tc.status === 'failed' || tc.status === 'error' ? '#f87171' : '#eab308', fontWeight: 'bold' }}>{tc.status.toUpperCase()}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 10, padding: 10, flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 200px' }}><div style={tcLabel}>Input</div><textarea value={tc.input} onChange={e => { const n = [...testcases]; n[idx].input = e.target.value; setTestcases(n); }} style={tcBox} /></div>
                        <div style={{ flex: '1 1 200px' }}><div style={tcLabel}>Expected</div><textarea value={tc.expectedOutput} onChange={e => { const n = [...testcases]; n[idx].expectedOutput = e.target.value; setTestcases(n); }} style={tcBox} /></div>
                      </div>
                      <div style={{ padding: '0 10px 10px' }}>
                        <div style={tcLabel}>Actual Output</div>
                        <pre style={{...tcBox, height: 60, margin: 0, overflow: 'auto', background: tc.status === 'failed' ? 'rgba(248,113,113,0.1)' : 'var(--bg-main)'}}>{tc.output}</pre>
                      </div>
                      <button onClick={() => runTestCase(idx)} style={{ width: '100%', padding: 10, background: 'var(--bg-panel-solid)', color: 'var(--text-main)', border: 'none', borderTop: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 'bold', transition: '0.2s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-panel-solid)'}>
                        {tc.status === 'running' ? 'Running...' : '▶ Run this case'}
                      </button>
                    </div>
                  ))}
                  <button onClick={() => setTestcases([...testcases, { id: Date.now().toString(), input: '', expectedOutput: '', output: '', status: 'idle' as const }])} style={{...secondaryBtn, width: '100%'}}>+ Add Custom Test Case</button>
                </div>
              </>
            )}

            {activeTab === 'ai' && (
              <div style={{ padding: 15 }}>
                <div style={tcCard}>
                  <div style={tcHeader}><strong style={{ color: 'var(--text-main)' }}>🧠 AI Image OCR / Text Generation</strong></div>
                  <div style={{ padding: 15 }}>
                    <div style={{ border: '1px dashed var(--accent-primary)', padding: 15, borderRadius: 8, textAlign: 'center', marginBottom: 15, background: 'var(--bg-card)' }}>
                      <p style={{ margin: '0 0 10px', color: 'var(--text-muted)' }}>Upload a screenshot of a problem</p>
                      <input type="file" accept="image/*" onChange={handleImageUpload} style={{ color: 'var(--text-main)' }} />
                    </div>
                    {imageBase64 && <img src={imageBase64} alt="Preview" style={{ width: '100%', maxHeight: 150, objectFit: 'contain', marginBottom: 10 }} />}
                    <textarea value={aiGenDesc} onChange={e => setAiGenDesc(e.target.value)} placeholder="...Or paste problem description text here" style={{...tcBox, height: 80, marginBottom: 10}} />
                    <button onClick={handleGenerateTestcases} style={{...runBtn, width: '100%'}}>Extract & Generate Hidden Cases</button>
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

const page: CSSProperties = { display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-main)', color: 'var(--text-main)', fontFamily: 'Inter, sans-serif' };
const headerBar: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', backgroundColor: 'var(--bg-panel-solid)', borderBottom: '1px solid var(--border-color)', zIndex: 10, flexWrap: 'wrap', gap: 10 };
const brand: CSSProperties = { color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 'bold' };
const runBtn: CSSProperties = { background: 'var(--accent-primary)', border: 'none', color: '#000', padding: '10px 20px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' };
const selectBox: CSSProperties = { background: 'var(--bg-panel)', color: 'var(--text-main)', border: '1px solid var(--border-color)', padding: '10px', borderRadius: 8, outline: 'none', fontWeight: 'bold' };
const paneHeader: CSSProperties = { padding: '12px 20px', background: 'var(--bg-panel-solid)', fontWeight: 'bold', fontSize: 14, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' };
const codeEditor: CSSProperties = { width: '100%', height: '70vh', flex: 1, background: 'var(--bg-main)', color: 'var(--text-main)', border: 'none', outline: 'none', fontFamily: 'monospace', fontSize: 15, resize: 'none', padding: 15, boxSizing: 'border-box' };
const inputBox: CSSProperties = { flex: 1, padding: 10, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-main)', outline: 'none' };
const fetchBtn: CSSProperties = { background: 'var(--border-color)', color: 'var(--text-main)', border: 'none', padding: '0 15px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' };
const tabsHeader: CSSProperties = { display: 'flex', background: 'var(--bg-panel-solid)', flexWrap: 'wrap' };
const activeTabStyle: CSSProperties = { flex: 1, background: 'var(--bg-panel)', border: 'none', color: 'var(--accent-primary)', padding: '12px', borderTop: '2px solid var(--accent-primary)', cursor: 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap' };
const inactiveTabStyle: CSSProperties = { flex: 1, background: 'transparent', border: 'none', color: 'var(--text-muted)', padding: '12px', borderTop: '2px solid transparent', cursor: 'pointer', whiteSpace: 'nowrap' };
const tcCard: CSSProperties = { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden', marginBottom: 15 };
const tcHeader: CSSProperties = { background: 'var(--bg-panel-solid)', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', fontSize: 13, borderBottom: '1px solid var(--border-color)' };
const tcBox: CSSProperties = { width: '100%', height: 80, background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)', fontFamily: 'monospace', padding: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' };
const tcLabel: CSSProperties = { fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block', fontWeight: 'bold' };
const secondaryBtn: CSSProperties = { background: 'var(--bg-panel-solid)', color: 'var(--text-main)', border: '1px solid var(--border-color)', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' };