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
    if (!code.trim()) return alert("Code cannot be empty");
    
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
      
      const actualOut = data.stdout ? atob(data.stdout).trim() : (data.compile_output ? atob(data.compile_output) : 'Error');
      const expectedOut = newCases[index].expectedOutput.trim();
      
      newCases[index].output = actualOut;
      newCases[index].status = (actualOut === expectedOut || !expectedOut) ? 'passed' : 'failed';
    } catch (e) {
      newCases[index].status = 'error';
      newCases[index].output = 'Execution failed on server.';
    }
    setTestcases([...newCases]);
  };

  const runAllTestcases = async () => {
    for (let i = 0; i < testcases.length; i++) {
      await runTestCase(i);
    }
  };

  const handleFetchCPHSamples = async () => {
    if (!cfUrl) return alert('Enter a URL');
    setGlobalLoadingText('Attempting standard extraction...');
    setIsFetchingSamples(true);
    
    try {
      const res = await fetch(`${API_V2_BASE_URL}/proxy/problem?url=${encodeURIComponent(cfUrl)}`);
      
      if (!res.ok) {
         setGlobalLoadingText('Standard extraction blocked. Routing to AI fallback parser...');
         
         const aiRes = await fetch(`${API_V2_BASE_URL}/ai/generate-testcases`, {
           method: 'POST', 
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ problemDescription: `Extract the input and output test cases exactly from this URL: ${cfUrl}` })
         });
         
         const aiData = await aiRes.json();
         if (!aiRes.ok || !aiData.testcases) throw new Error();
         
         // 👉 FIX: Added 'as const'
         const newCases: TestCase[] = aiData.testcases.map((tc: any, idx: number) => ({
           id: Date.now().toString() + idx, input: tc.input, expectedOutput: tc.expectedOutput, output: '', status: 'idle' as const
         }));
         setTestcases(newCases);
         setIsFetchingSamples(false);
         return toast?.success("AI successfully bypassed block and extracted test cases!");
      }

      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const inputNodes = Array.from(doc.querySelectorAll('.input pre')).map(el => el.textContent?.trim() || '');
      const outputNodes = Array.from(doc.querySelectorAll('.output pre')).map(el => el.textContent?.trim() || '');
      
      // 👉 FIX: Added 'as const'
      const newCases: TestCase[] = inputNodes.map((inp, idx) => ({
        id: Date.now().toString() + idx, input: inp, expectedOutput: outputNodes[idx] || '', output: '', status: 'idle' as const
      }));
      setTestcases(newCases);
      
    } catch (error) {
      alert("Both standard and AI extraction failed. Try pasting the problem text in the AI tab.");
    } finally {
      setIsFetchingSamples(false);
    }
  };

  const handleGenerateTestcases = async () => {
    if (!aiGenDesc && !imageBase64) return alert("Upload an image or paste description.");
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
        // 👉 FIX: Added 'as const'
        const generated: TestCase[] = data.testcases.map((tc: any, i: number) => ({
          id: 'gen' + i, input: tc.input, expectedOutput: tc.expectedOutput, output: '', status: 'idle' as const
        }));
        setTestcases(generated);
        setActiveTab('cph');
      }
    } catch (e) {} finally { setAiGenLoading(false); }
  };

  return (
    <main style={{...page, minHeight: '100vh', height: 'auto'}}>
      <Head><title>Universal Judge | DivineCode</title></Head>

      <AnimatePresence>
        {(isFetchingSamples || aiGenLoading) && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.85)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <motion.div animate={{ rotate: 360, boxShadow: ["0 0 0 0 rgba(56, 189, 248, 0.4)", "0 0 0 20px rgba(56, 189, 248, 0)", "0 0 0 0 rgba(56, 189, 248, 0)"] }} transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }} style={{ width: 64, height: 64, border: '5px solid #1e293b', borderTopColor: '#38bdf8', borderRadius: '50%' }} />
            <motion.h2 initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} style={{ color: '#67e8f9', marginTop: 24, fontSize: 24 }}>{globalLoadingText}</motion.h2>
          </motion.div>
        )}
      </AnimatePresence>

      <header style={headerBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <a href="/" style={brand}>← DivineCode</a>
          <strong style={{ color: '#fff', fontSize: 18 }}>Universal Playground</strong>
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
        <section style={{ flex: '1 1 600px', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column' }}>
          <div style={paneHeader}>Code Editor (Autosaves)</div>
          <textarea 
            value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={handleEditorKeyDown}
            style={codeEditor} spellCheck={false} placeholder={`// Write your ${language} solution here...`}
          />
        </section>

        <section style={{ flex: '1 1 500px', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column' }}>
          <div style={tabsHeader}>
            <button style={activeTab === 'cph' ? activeTabStyle : inactiveTabStyle} onClick={() => setActiveTab('cph')}>Platform Cases</button>
            <button style={activeTab === 'ai' ? activeTabStyle : inactiveTabStyle} onClick={() => setActiveTab('ai')}>AI OCR & Generation</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {activeTab === 'cph' && (
              <>
                <div style={{ padding: 15, background: '#1e293b' }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input type="text" value={cfUrl} onChange={(e) => setCfUrl(e.target.value)} placeholder="Paste any problem URL..." style={inputBox} />
                    <button onClick={handleFetchCPHSamples} style={fetchBtn}>Extract Data</button>
                  </div>
                </div>

                <div style={{ padding: 15 }}>
                  {testcases.map((tc, idx) => (
                    <div key={tc.id} style={tcCard}>
                      <div style={tcHeader}>
                        <strong>Test Case {idx + 1}</strong>
                        <span style={{ color: tc.status === 'passed' ? '#4ade80' : tc.status === 'failed' || tc.status === 'error' ? '#f87171' : '#94a3b8' }}>{tc.status.toUpperCase()}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 10, padding: 10 }}>
                        <div style={{ flex: 1 }}><div style={tcLabel}>Input</div><textarea value={tc.input} onChange={e => { const n = [...testcases]; n[idx].input = e.target.value; setTestcases(n); }} style={tcBox} /></div>
                        <div style={{ flex: 1 }}><div style={tcLabel}>Expected</div><textarea value={tc.expectedOutput} onChange={e => { const n = [...testcases]; n[idx].expectedOutput = e.target.value; setTestcases(n); }} style={tcBox} /></div>
                      </div>
                      <div style={{ padding: '0 10px 10px' }}>
                        <div style={tcLabel}>Actual Output</div>
                        <pre style={{...tcBox, height: 60, margin: 0, overflow: 'auto', background: tc.status === 'failed' ? 'rgba(248,113,113,0.1)' : '#020617'}}>{tc.output}</pre>
                      </div>
                      <button onClick={() => runTestCase(idx)} style={{ width: '100%', padding: 8, background: '#1e293b', color: '#fff', border: 'none', cursor: 'pointer' }}>{tc.status === 'running' ? 'Running...' : '▶ Run this case'}</button>
                    </div>
                  ))}
                  {/* 👉 FIX: Added 'as const' to the new item button */}
                  <button onClick={() => setTestcases([...testcases, { id: Date.now().toString(), input: '', expectedOutput: '', output: '', status: 'idle' as const }])} style={{...secondaryBtn, width: '100%'}}>+ Add Custom Test Case</button>
                </div>
              </>
            )}

            {activeTab === 'ai' && (
              <div style={{ padding: 15 }}>
                <div style={tcCard}>
                  <div style={tcHeader}>🧠 AI Image OCR / Text Generation</div>
                  <div style={{ padding: 15 }}>
                    <div style={{ border: '1px dashed #38bdf8', padding: 15, borderRadius: 8, textAlign: 'center', marginBottom: 15 }}>
                      <p style={{ margin: '0 0 10px', color: '#94a3b8' }}>Upload a screenshot of a problem</p>
                      <input type="file" accept="image/*" onChange={handleImageUpload} style={{ color: '#fff' }} />
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

// STYLES
const page: CSSProperties = { display: 'flex', flexDirection: 'column', backgroundColor: '#020617', color: '#eef2ff', fontFamily: 'Inter, sans-serif' };
const headerBar: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', backgroundColor: '#0f172a', borderBottom: '1px solid #1e293b', zIndex: 10 };
const brand: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 'bold' };
const runBtn: CSSProperties = { background: '#3b82f6', border: 'none', color: '#fff', padding: '10px 20px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' };
const selectBox: CSSProperties = { background: '#1e293b', color: '#fff', border: '1px solid #334155', padding: '10px', borderRadius: 8, outline: 'none', fontWeight: 'bold' };
const paneHeader: CSSProperties = { padding: '12px 20px', background: '#1e293b', fontWeight: 'bold', fontSize: 14, color: '#94a3b8' };
const codeEditor: CSSProperties = { width: '100%', height: '70vh', flex: 1, background: '#020617', color: '#a5b4fc', border: 'none', outline: 'none', fontFamily: 'monospace', fontSize: 15, resize: 'none', padding: 15 };
const inputBox: CSSProperties = { flex: 1, padding: 10, borderRadius: 8, border: '1px solid #334155', background: '#020617', color: '#fff', outline: 'none' };
const fetchBtn: CSSProperties = { background: '#0d9488', color: '#fff', border: 'none', padding: '0 15px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' };
const tabsHeader: CSSProperties = { display: 'flex', background: '#1e293b' };
const activeTabStyle: CSSProperties = { flex: 1, background: '#0f172a', border: 'none', color: '#38bdf8', padding: '12px', borderTop: '2px solid #38bdf8', cursor: 'pointer', fontWeight: 'bold' };
const inactiveTabStyle: CSSProperties = { flex: 1, background: 'transparent', border: 'none', color: '#94a3b8', padding: '12px', cursor: 'pointer' };
const tcCard: CSSProperties = { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, overflow: 'hidden', marginBottom: 15 };
const tcHeader: CSSProperties = { background: '#1e293b', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', fontSize: 13 };
const tcBox: CSSProperties = { width: '100%', height: 80, background: '#020617', border: '1px solid #334155', borderRadius: 6, color: '#fff', fontFamily: 'monospace', padding: 8, fontSize: 13, resize: 'none' };
const tcLabel: CSSProperties = { fontSize: 12, color: '#94a3b8', marginBottom: 4, display: 'block' };
const secondaryBtn: CSSProperties = { background: '#334155', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' };