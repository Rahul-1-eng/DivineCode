import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import dynamic from 'next/dynamic';
import { io, Socket } from 'socket.io-client';
import VoiceInterviewer from '../../components/VoiceInterviewer';
import { fetchApi } from '../../lib/api'; 

const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false, loading: () => <div style={{padding: 20, color: '#64748b'}}>Loading Editor...</div> });
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

interface Problem {
  id?: string;
  title: string;
  videoUrl?: string;
  difficulty?: string;
  rating?: number;
  descriptionHtml?: string;
  description?: string;
  content?: string;
  originalUrl?: string;
  testcases?: string | { input?: string; stdin?: string; expectedOutput?: string; output?: string }[];
  error?: boolean;
}

interface ExecutionResult {
  verdict: string;
  runtimeMs?: number;
  compileError?: string;
  stdout?: string;
  stderr?: string;
}

interface ChatPost {
  author: string;
  message: string;
  timestamp: string;
}
const getYouTubeEmbedUrl = (url: string) => {
    let videoId = '';
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    if (match && match[1]) {
      videoId = match[1];
      return `https://www.youtube.com/embed/${videoId}`;
    }
    return url; 
};

export default function ProblemWorkspace() {
  const router = useRouter();
  const { id } = router.query;
  const { data: session } = useSession();

  const [problem, setProblem] = useState<Problem | null>(null);
  const [code, setCode] = useState('// Implementation source framework entry\n');
  const [language, setLanguage] = useState('cpp');
  const [outputs, setOutputs] = useState<ExecutionResult[]>([]);
  const [running, setRunning] = useState(false);
  const [isKitsMenuOpen, setIsKitsMenuOpen] = useState(false);
  
  const [workspaceTab, setWorkspaceTab] = useState<'problem' | 'video' | 'discuss' | 'voice'>('problem');
  const [consoleTab, setConsoleTab] = useState<'output' | 'mentor'>('output');

  const [aiAnalysis, setAiAnalysis] = useState('');
  const [analyzing, setAnalyzing] = useState(false);

  const [discussionInput, setDiscussionInput] = useState('');
  const [posts, setPosts] = useState<ChatPost[]>([]);

  const [socket, setSocket] = useState<Socket | null>(null);

  // ✅ NEW: Terminal Mode States
  const [customInput, setCustomInput] = useState('');
  const [isTerminalMode, setIsTerminalMode] = useState(false);

  const battleKits = [
    { name: 'IICPC Standard IO Boilerplate', code: '#include <bits/stdc++.h>\nusing namespace std;\n\nvoid solve() {\n    // Implementation here\n}\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    int t; cin >> t;\n    while(t--) solve();\n    return 0;\n}' },
    { name: 'Segment Tree Template', code: '// Segment Tree (Point Update, Range Query)\nconst int N = 1e5+5;\nint tree[4*N];\n\nvoid build(int node, int start, int end) {\n    if(start == end) return;\n    int mid = (start + end) / 2;\n    build(2*node, start, mid);\n    build(2*node+1, mid+1, end);\n    tree[node] = tree[2*node] + tree[2*node+1];\n}' },
    { name: 'Graph BFS/DFS Skeleton', code: 'vector<int> adj[100005];\nbool vis[100005];\n\nvoid dfs(int node) {\n    vis[node] = true;\n    for(int child : adj[node]) {\n        if(!vis[child]) dfs(child);\n    }\n}' }
  ];

  const playSuccessAudio = () => {
    try {
      const audio = new Audio('/accepted.mp3');
      audio.volume = 0.6;
      audio.play().catch(() => {});
    } catch (e) {}
  };

  // Load messages from local storage
  useEffect(() => {
    if (id) {
      const saved = localStorage.getItem(`chat_${id}`);
      if (saved) setPosts(JSON.parse(saved));
      else setPosts([{ author: 'System_Admin', message: 'If executing in O(N), ensure the sparse initialization bounds are checked properly to avoid segment errors.', timestamp: '1 hour ago' }]);
    }
  }, [id]);

  // Save messages to local storage
  useEffect(() => {
    if (id && posts.length > 0) {
      localStorage.setItem(`chat_${id}`, JSON.stringify(posts));
    }
  }, [posts, id]);

  useEffect(() => {
    if (!id) return;
    
    const newSocket = io(API_BASE_URL, { transports: ['websocket'] });
    setSocket(newSocket);
    newSocket.emit('join-workspace', id);

    newSocket.on('remote-code-update', (newCode: string) => {
      setCode(newCode);
    });

    fetchApi(`/api/v2/problems/${id}/redirect`)
      .then(data => {
        if (data && data.title) {
          const hasTestcases = data.customTestCases || data.testcases;
          setIsTerminalMode(!hasTestcases || (typeof hasTestcases === 'string' && JSON.parse(hasTestcases).length === 0) || (Array.isArray(hasTestcases) && hasTestcases.length === 0));
          
          setProblem({
            id: data.id,
            title: data.title,
            videoUrl: data.videoUrl,
            difficulty: data.difficulty,
            rating: data.rating,
            descriptionHtml: data.description || data.customDescription,
            description: data.description || data.customDescription,
            content: data.description || data.customDescription,
            testcases: data.customTestCases || data.testcases,
            originalUrl: data.externalUrl,
          });
        } else {
          throw new Error('Invalid problem data returned from API');
        }
      })
      .catch((err) => {
        console.error('[ProblemWorkspace] Fetch error:', err);
        setProblem({ 
          error: true, 
          title: 'Problem Not Found', 
          description: `Could not load problem: ${err.message}` 
        });
      });

    return () => { newSocket.disconnect(); };
  }, [id, session]);

  const sampleData = useMemo(() => {
    if (!problem || !problem.testcases) return { input: '', output: '' };
    try {
      const parsed = typeof problem.testcases === 'string' ? JSON.parse(problem.testcases) : problem.testcases;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { input: parsed[0].input || parsed[0].stdin || '', output: parsed[0].expectedOutput || parsed[0].output || '' };
      }
    } catch (e) {
      console.error("Failed parsing testcase array on frontend:", e);
    }
    return { input: '', output: '' };
  }, [problem]);

  // ✅ UPDATED: Run Code with Terminal Mode Support
  async function runCode() {
    if (!problem || problem.error) return;
    setRunning(true);
    setConsoleTab('output');
    
    try {
      let data;
      
      if (isTerminalMode) {
        // Terminal Mode: Use execute-raw endpoint
        console.log('[ProblemWorkspace] Running in Terminal Mode with custom input');
        data = await fetchApi('/api/v2/submissions/execute-raw', {
          method: 'POST',
          body: JSON.stringify({
            code,
            language,
            stdin: customInput
          })
        });
        
        // Format response for terminal mode
        setOutputs([{
          verdict: data.verdict,
          stdout: data.stdout,
          stderr: data.stderr,
          compileError: data.compileError,
          runtimeMs: data.runtimeMs
        }]);
      } else {
        // Test Case Mode: Use run-samples endpoint
        console.log('[ProblemWorkspace] Running in Test Case Mode');
        data = await fetchApi('/api/v2/submissions/run-samples', {
          method: 'POST',
          body: JSON.stringify({ 
            problemId: problem.id, 
            code, 
            language 
          })
        });
        
        setOutputs(data.results || []);
        
        // Play sound if all tests passed
        const allAccepted = data.results?.length > 0 && data.results.every((r: ExecutionResult) => r.verdict === 'ACCEPTED');
        if (allAccepted) {
          playSuccessAudio();
        }
      }
    } catch (err: any) {
      console.error('[ProblemWorkspace] Run code error:', err);
      alert(`Failed to run code: ${err.message}`);
    } finally {
      setRunning(false);
    }
  }

  const invokeAIProfiler = async () => {
    if (!problem || problem.error) return;
    setAnalyzing(true);
    setConsoleTab('mentor');
    try {
      const prompt = `Please explain the optimal approach for this problem step-by-step and provide deep optimization hints.\n\nTitle: ${problem.title}\n\nMy Code:\n${code}`;
      const resData = await fetchApi('/api/v2/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message: prompt, history: [] })
      });
      
      setAiAnalysis(resData.reply || 'No response from AI');
    } catch (err: any) {
      setAiAnalysis(`Error: ${err.message}. Please check your API configuration.`);
    } finally {
      setAnalyzing(false);
    }
  };

  const submitComment = () => {
    if (!discussionInput.trim()) return;
    setPosts(prev => [...prev, { author: session?.user?.name || 'Anonymous', message: discussionInput.trim(), timestamp: 'Just now' }]);
    setDiscussionInput('');
  };

  const handleEditorChange = (value: string | undefined) => {
    const val = value || '';
    setCode(val);
    if (socket) socket.emit('local-code-update', { roomId: id, code: val });
  };

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
    <main style={{ display: 'flex', height: '100vh', background: '#020617', fontFamily: 'Inter, sans-serif' }}>
      
      <section style={{ width: '45%', borderRight: '1px solid #1e293b', background: '#0f172a', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 24px', background: '#020617', borderBottom: '1px solid #1e293b' }}>
           <a href="/practice" style={{ color: '#67e8f9', textDecoration: 'none', fontWeight: 900, display: 'inline-block' }}>← Practice Hub</a>
        </div>
        
        <div style={{ display: 'flex', background: '#020617', borderBottom: '1px solid #1e293b' }}>
          {[['problem', 'Problem Details'], ['video', '🎬 Video Solution'], ['discuss', '💬 Discussion Threads'], ['voice', '🎙️ Voice AI']].map(([tId, title]) => (
            <button key={tId} onClick={() => setWorkspaceTab(tId as any)} style={{ flex: 1, padding: 14, background: workspaceTab === tId ? '#0f172a' : 'transparent', color: workspaceTab === tId ? '#22d3ee' : '#64748b', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, letterSpacing: 0.5 }}>{title}</button>
          ))}
        </div>

        <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
          {workspaceTab === 'problem' && (
            <>
              <h1 style={{ color: '#fff', fontSize: 24, margin: '0 0 8px' }}>{problem.title}</h1>
              {!problem.error && <div style={{ color: '#22d3ee', fontSize: 13, marginBottom: 20 }}>Complexity Floor: {problem.difficulty || problem.rating || 'Unrated'}</div>}
              
              {hasDescription ? (
                <div style={{ color: '#cbd5e1', lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: problemDescriptionHtml }} />
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

              {(sampleData.input || sampleData.output) && !isTerminalMode && (
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

              {isTerminalMode && (
                <div style={{ marginTop: 24, padding: 16, borderRadius: 12, background: '#020617', border: '2px solid #22d3ee' }}>
                  <strong style={{ display: 'block', marginBottom: 8, color: '#22d3ee' }}>🖥️ Terminal Mode</strong>
                  <p style={{ color: '#cbd5e1', fontSize: 13, margin: '0 0 8px' }}>No predefined test cases found. Enter custom input below:</p>
                  <textarea
                    placeholder="Enter STDIN here...\nExample:\n5\n1 2 3 4 5"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    style={{
                      width: '100%',
                      height: 120,
                      background: '#0f172a',
                      color: '#e2e8f0',
                      border: '1px solid #334155',
                      borderRadius: 8,
                      padding: 12,
                      fontFamily: 'monospace',
                      fontSize: 13,
                      outline: 'none',
                      resize: 'vertical'
                    }}
                  />
                </div>
              )}
            </>
          )}

         {workspaceTab === 'video' && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <h3 style={{ color: '#fff', margin: 0 }}>Algorithmic Video Streaming</h3>
    
    {/* 👉 FIXED: Prioritize the saved videoUrl from the database first */}
    {problem.videoUrl ? (
      <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden', borderRadius: 12, background: '#000' }}>
         <iframe 
            src={getYouTubeEmbedUrl(problem.videoUrl)} 
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
            frameBorder="0" 
            allowFullScreen 
         />
      </div>
    ) : !problem.error ? (
      // Fallback to search if no videoUrl is saved
      <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden', borderRadius: 12, background: '#000' }}>
        <iframe 
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} 
          src={`https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(problem.title + ' optimal solution algorithm')}`} 
          frameBorder="0" 
          allowFullScreen 
        />
      </div>
    ) : (
      <p style={{ color: '#94a3b8' }}>Cannot load video for this problem.</p>
    )}
  </div>
)}

          {workspaceTab === 'discuss' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <h2 style={{ color: '#fff', margin: '0 0 15px 0' }}>Community Threads</h2>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {posts.map((p, idx) => (
                  <div key={idx} style={{ background: '#020617', padding: 16, borderRadius: 12, border: '1px solid #1e293b' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}><strong style={{ color: '#818cf8' }}>{p.author}</strong><span style={{ color: '#64748b' }}>{p.timestamp}</span></div>
                    <div style={{ color: '#e2e8f0', fontSize: 14, lineHeight: 1.5 }}>{p.message}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input value={discussionInput} onChange={e => setDiscussionInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitComment()} placeholder="Share your approach..." style={{ flex: 1, padding: 12, borderRadius: 8, background: '#020617', border: '1px solid #334155', color: '#fff', outline: 'none' }} />
                <button onClick={submitComment} style={{ background: '#22d3ee', color: '#000', border: 'none', padding: '0 20px', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>Post</button>
              </div>
            </div>
          )}

          {workspaceTab === 'voice' && (
             <VoiceInterviewer
                currentQuestion={problem}
                code={code}
                onSuccess={() => playSuccessAudio()}
             />
          )}

        </div>
      </section>

      <section style={{ width: '55%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 12, background: '#020617', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b' }}>
          
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <select value={language} onChange={e => setLanguage(e.target.value)} style={{ background: '#0f172a', color: '#fff', border: '1px solid #334155', padding: '8px 12px', borderRadius: 8, outline: 'none', cursor: 'pointer' }}>
              <option value="cpp">C++ (GCC 9.2)</option>
              <option value="python">Python 3</option>
              <option value="c">C</option>
            </select>

            <div style={{ position: 'relative' }}>
              <button 
                onClick={() => setIsKitsMenuOpen(!isKitsMenuOpen)}
                style={{ background: 'rgba(56,189,248,0.1)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)', padding: '8px 16px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>
                🎒 Battle-Kits ▼
              </button>
              
              {isKitsMenuOpen && (
                <div style={{ position: 'absolute', top: 45, left: 0, width: 280, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.5)', zIndex: 100, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 15px', background: '#020617', borderBottom: '1px solid #1e293b', fontSize: 12, color: '#94a3b8', fontWeight: 'bold' }}>INJECT TEMPLATE</div>
                  {battleKits.map((kit, i) => (
                    <button 
                      key={i} 
                      onClick={() => { setCode(kit.code); setIsKitsMenuOpen(false); }}
                      style={{ display: 'block', width: '100%', padding: '12px 15px', textAlign: 'left', background: 'transparent', border: 'none', color: '#e2e8f0', cursor: 'pointer', borderBottom: '1px solid #1e293b' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(56,189,248,0.1)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      ⚡ {kit.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <button onClick={runCode} disabled={running || problem?.error} style={{ background: running || problem?.error ? '#64748b' : 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', border: 'none', padding: '8px 24px', borderRadius: 8, fontWeight: 900, cursor: problem?.error ? 'not-allowed' : 'pointer', boxShadow: '0 0 15px rgba(34,211,238,0.3)', opacity: problem?.error ? 0.5 : 1 }}>
            {running ? 'Compiling...' : isTerminalMode ? '▶ Run' : 'Run Code ▶'}
          </button>
        </div>
        
        <div style={{ height: '60%' }}>
          <Editor height="100%" theme="vs-dark" language={monacoLanguage} value={code} onChange={handleEditorChange} options={{ fontSize: 15, minimap: { enabled: false }, padding: { top: 16 } }} />
        </div>
        
        <div style={{ height: '40%', background: '#020617', borderTop: '1px solid #1e293b', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', background: '#0f172a' }}>
            <button onClick={() => setConsoleTab('output')} style={{ padding: '12px 20px', background: consoleTab === 'output' ? '#020617' : 'transparent', color: consoleTab === 'output' ? '#38bdf8' : '#fff', border: 'none', borderTop: consoleTab === 'output' ? '2px solid #38bdf8' : '2px solid transparent', cursor: 'pointer', fontWeight: 'bold' }}>Console Output</button>
            <button onClick={() => setConsoleTab('mentor')} style={{ padding: '12px 20px', background: consoleTab === 'mentor' ? '#020617' : 'transparent', color: consoleTab === 'mentor' ? '#38bdf8' : '#fff', border: 'none', borderTop: consoleTab === 'mentor' ? '2px solid #38bdf8' : '2px solid transparent', cursor: 'pointer', fontWeight: 'bold' }}>AI Explainer</button>
            <button onClick={invokeAIProfiler} disabled={analyzing || problem?.error} style={{ marginLeft: 'auto', background: analyzing || problem?.error ? '#64748b' : '#22d3ee', color: '#000', border: 'none', padding: '0 20px', fontWeight: 700, cursor: problem?.error ? 'not-allowed' : 'pointer', opacity: problem?.error ? 0.5 : 1 }}>{analyzing ? 'Analyzing...' : 'Run AI Analysis'}</button>
          </div>
          <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
            {consoleTab === 'output' ? (
              <>
                {outputs.length === 0 && <p style={{ color: '#475569' }}>Run your code to see results here.</p>}
                {outputs.map((out, idx) => (
                  <div key={idx} style={{ marginBottom: 12, padding: 12, borderRadius: 8, background: out.verdict === 'ACCEPTED' ? 'rgba(34,211,238,0.1)' : 'rgba(239,68,68,0.1)' }}>
                    {isTerminalMode ? (
                      <>
                        <strong>Execution Status: </strong>
                        <span style={{ color: out.verdict === 'ACCEPTED' ? '#22d3ee' : '#ef4444', fontWeight: 'bold' }}>{out.verdict}</span>
                        {out.runtimeMs && <span style={{ color: '#94a3b8', marginLeft: 8 }}>({out.runtimeMs}ms)</span>}
                        
                        {out.stdout && (
                          <>
                            <h4 style={{ color: '#cbd5e1', marginTop: 12 }}>Output:</h4>
                            <pre style={{ color: '#e2e8f0', background: '#0f172a', padding: 12, borderRadius: 6, whiteSpace: 'pre-wrap', margin: 0 }}>{out.stdout}</pre>
                          </>
                        )}
                        
                        {out.stderr && (
                          <>
                            <h4 style={{ color: '#ef4444', marginTop: 12 }}>Stderr:</h4>
                            <pre style={{ color: '#ef4444', background: '#0f172a', padding: 12, borderRadius: 6, whiteSpace: 'pre-wrap', margin: 0 }}>{out.stderr}</pre>
                          </>
                        )}
                        
                        {out.compileError && (
                          <>
                            <h4 style={{ color: '#ef4444', marginTop: 12 }}>Compile Error:</h4>
                            <pre style={{ color: '#ef4444', background: '#0f172a', padding: 12, borderRadius: 6, whiteSpace: 'pre-wrap', margin: 0 }}>{out.compileError}</pre>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <strong>Test Case {idx + 1}: </strong>
                        <span style={{ color: out.verdict === 'ACCEPTED' ? '#22d3ee' : '#ef4444', fontWeight: 'bold' }}>{out.verdict}</span>
                        {out.runtimeMs && <span style={{ color: '#94a3b8', marginLeft: 8 }}>({out.runtimeMs}ms)</span>}
                        {out.compileError && <pre style={{ color: '#ef4444', marginTop: 12, whiteSpace: 'pre-wrap', fontSize: 13, background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 6 }}>{out.compileError}</pre>}
                      </>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <div style={{ paddingTop: 10 }}>
                {aiAnalysis ? (
                  <div style={{ color: '#cbd5e1', fontSize: 15, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {aiAnalysis}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', marginTop: 20 }}>
                    <h3 style={{ color: '#a5b4fc', marginTop: 0 }}>🤖 Interactive AI Explainer</h3>
                    <p style={{ color: '#cbd5e1', marginBottom: 20 }}>Stuck? Let the AI break down the optimal approach step-by-step.</p>
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