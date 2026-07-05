/**
 * @file [id].tsx (Workspace)
 * @author Rahul Kumar Sahoo
 * @description Unified IDE workspace supporting local code execution, live socket code synchronization, 
 * AI video/voice assistance, and collaborative terminal features.
 */
import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import dynamic from 'next/dynamic';
import { io, Socket } from 'socket.io-client';
import { useTheme } from 'next-themes';
import VoiceInterviewer from '../../components/VoiceInterviewer';
import { fetchApi } from '../../lib/api'; 

const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false, loading: () => <div style={{padding: 20, color: 'var(--text-muted)'}}>Provisioning Editor Environment...</div> });
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

// Pulls the video id out of any youtube link format (watch/shorts/youtu.be/embed).
// Returns null when there is no real id. Don't render an iframe without one:
// search-based embeds are dead on YouTube's side and just show an error player.
const getYouTubeEmbedUrl = (url?: string | null) => {
    if (!url || typeof url !== 'string') return null;
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|shorts\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    return match && match[1] ? `https://www.youtube.com/embed/${match[1]}` : null;
};

export default function ProblemWorkspace() {
  const router = useRouter();
  const { id } = router.query;
  const { data: session } = useSession();
  const { theme } = useTheme();

  const [problem, setProblem] = useState<Problem | null>(null);
  const [code, setCode] = useState('// Competitive Programming Workspace Initialized\n');
  const [language, setLanguage] = useState('cpp');
  const [problemLoadError, setProblemLoadError] = useState('');
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

  const [customInput, setCustomInput] = useState('');
  const [isTerminalMode, setIsTerminalMode] = useState(false);

  // Ready-to-go snippets prioritizing competitive programming setups
  const battleKits = [
    { name: 'IICPC Fast IO Boilerplate (C++)', code: '#include <bits/stdc++.h>\nusing namespace std;\n\n#define int long long\n#define pb push_back\n#define all(x) (x).begin(), (x).end()\n\nvoid solve() {\n    // Implementation here\n}\n\nint32_t main() {\n    ios_base::sync_with_stdio(0); cin.tie(0); cout.tie(0);\n    int t = 1; cin >> t;\n    while(t--) solve();\n    return 0;\n}' },
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

  useEffect(() => {
    if (id) {
      const saved = localStorage.getItem(`chat_${id}`);
      if (saved) setPosts(JSON.parse(saved));
      else setPosts([{ author: 'System_Admin', message: 'If executing in O(N), ensure the sparse initialization bounds are checked properly to avoid segmentation faults.', timestamp: '1 hour ago' }]);
    }
  }, [id]);

  useEffect(() => {
    if (id && posts.length > 0) {
      localStorage.setItem(`chat_${id}`, JSON.stringify(posts));
    }
  }, [posts, id]);

  useEffect(() => {
    if (!id) return;
    
    // Connect to synchronization socket for live collaboration
    const newSocket = io(API_BASE_URL, { transports: ['websocket'] });
    setSocket(newSocket);
    newSocket.emit('join-workspace', id);

    newSocket.on('remote-code-update', (newCode: string) => {
      setCode(newCode);
    });

    // Hydrate problem constraints natively from the API
    fetchApi(`/api/v2/problems/${id}/redirect`)
      .then(data => {
        if (data && data.title) {
          const rawTestcases = data.customTestCases || data.testcases || [];
          let parsedTestcases: any[] = [];

          try {
            if (typeof rawTestcases === 'string') {
              parsedTestcases = JSON.parse(rawTestcases);
            } else if (Array.isArray(rawTestcases)) {
              parsedTestcases = rawTestcases;
            }
          } catch {
            parsedTestcases = [];
          }

          setIsTerminalMode(parsedTestcases.length === 0);
          setProblemLoadError('');
          setProblem({
            id: data.id,
            title: data.title,
            videoUrl: data.videoUrl,
            difficulty: data.difficulty,
            rating: data.rating,
            descriptionHtml: data.description || data.customDescription || '<p>Problem description is unavailable right now. The workspace remains usable for code practice.</p>',
            description: data.description || data.customDescription || 'Problem description is unavailable right now. The workspace remains usable for code practice.',
            content: data.description || data.customDescription || 'Problem description is unavailable right now. The workspace remains usable for code practice.',
            testcases: rawTestcases,
            originalUrl: data.externalUrl,
          });
        } else {
          throw new Error('Invalid schema mapping returned from API');
        }
      })
      .catch((err) => {
        console.error('[ProblemWorkspace] Fetch error:', err);
        setProblemLoadError(err.message || 'Unable to load this practice problem.');
        setProblem({ 
          error: true, 
          title: 'Problem Not Found', 
          description: `Could not load problem: ${err.message}` 
        });
      });

    // Extremely important: Detach socket listener on unmount to prevent rapid memory leaks
    return () => { 
      newSocket.off('remote-code-update');
      newSocket.disconnect(); 
    };
  }, [id, session]);

  const sampleData = useMemo(() => {
    if (!problem || !problem.testcases) return { input: '', output: '' };
    try {
      const parsed = typeof problem.testcases === 'string' ? JSON.parse(problem.testcases) : problem.testcases;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { input: parsed[0].input || parsed[0].stdin || '', output: parsed[0].expectedOutput || parsed[0].output || '' };
      }
    } catch (e) {
      console.error("Testcase string buffer failed to deserialize:", e);
    }
    return { input: '', output: '' };
  }, [problem]);

  async function runCode() {
    if (!problem || problem.error) return;
    setRunning(true);
    setConsoleTab('output');
    
    try {
      let data;
      
      // Route code execution to the proper isolated docker container context
      if (isTerminalMode) {
        data = await fetchApi('/api/v2/submissions/execute-raw', {
          method: 'POST',
          body: JSON.stringify({
            code,
            language,
            stdin: customInput
          })
        });
        
        setOutputs([{
          verdict: data.verdict,
          stdout: data.stdout,
          stderr: data.stderr,
          compileError: data.compileError,
          runtimeMs: data.runtimeMs
        }]);
      } else {
        data = await fetchApi('/api/v2/submissions/run-samples', {
          method: 'POST',
          body: JSON.stringify({ 
            problemId: problem.id, 
            code, 
            language 
          })
        });
        
        setOutputs(data.results || []);
        
        const allAccepted = data.results?.length > 0 && data.results.every((r: ExecutionResult) => r.verdict === 'ACCEPTED');
        if (allAccepted) {
          playSuccessAudio();
        }
      }
    } catch (err: any) {
      console.error('[ProblemWorkspace] Run code error:', err);
      alert(`Execution fault: ${err.message}`);
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
      
      setAiAnalysis(resData.reply || 'The AI analysis service did not return a response. Your editor is still available for manual problem solving.');
    } catch (err: any) {
      setAiAnalysis(`The AI analysis service is unavailable right now. You can still use the editor and the problem description. ${err.message || ''}`.trim());
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
    <main style={{ padding: 40, background: 'var(--bg-main)', color: 'var(--text-main)', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 50, height: 50, borderTop: '3px solid var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}/>
      <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </main>
  );

  const monacoLanguage = language === 'cpp' ? 'cpp' : language === 'python' ? 'python' : 'c';
  const problemDescriptionHtml = problem.descriptionHtml || problem.description || problem.content || '';
  const hasDescription = problemDescriptionHtml && problemDescriptionHtml.replace(/<[^>]*>/g, '').trim().length > 10;
  const editorTheme = theme === 'light' ? 'light' : 'vs-dark';

  return (
    <main className="workspace-container">
      <style>{`
        .workspace-container {
          display: flex;
          height: 100vh;
          background: var(--bg-main);
          font-family: Inter, sans-serif;
          flex-direction: row;
        }
        .workspace-left {
          width: 45%;
          border-right: 1px solid var(--border-color);
          background: var(--bg-panel);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .workspace-right {
          width: 55%;
          display: flex;
          flex-direction: column;
        }
        .mobile-scroll-x {
          display: flex;
          overflow-x: auto;
          white-space: nowrap;
        }
        .mobile-scroll-x::-webkit-scrollbar {
          height: 4px;
        }
        .mobile-scroll-x::-webkit-scrollbar-thumb {
          background: var(--border-color);
          border-radius: 4px;
        }
        @media (max-width: 768px) {
          .workspace-container {
            flex-direction: column;
            height: auto;
            min-height: 100vh;
          }
          .workspace-left {
            width: 100%;
            border-right: none;
            border-bottom: 4px solid var(--border-color);
            height: 60vh;
          }
          .workspace-right {
            width: 100%;
            height: 90vh;
          }
        }
      `}</style>
      
      <section className="workspace-left">
        <div style={{ padding: '16px 24px', background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)' }}>
           <a href="/practice" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 900, display: 'inline-block' }}>← Practice Hub</a>
        </div>
        
        <div className="mobile-scroll-x" style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)' }}>
          {[['problem', 'Problem Details'], ['video', '🎬 Video Solution'], ['discuss', '💬 Discussion Threads'], ['voice', '🎙️ Voice AI']].map(([tId, title]) => (
            <button key={tId} onClick={() => setWorkspaceTab(tId as any)} style={{ flex: '1 0 auto', padding: 14, background: workspaceTab === tId ? 'var(--bg-panel-solid)' : 'transparent', color: workspaceTab === tId ? 'var(--accent-primary)' : 'var(--text-muted)', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, letterSpacing: 0.5 }}>{title}</button>
          ))}
        </div>

        <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
          {workspaceTab === 'problem' && (
            <>
              <h1 style={{ color: 'var(--text-main)', fontSize: 'clamp(20px, 4vw, 24px)', margin: '0 0 8px' }}>{problem.title}</h1>
              {problemLoadError && (
                <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(248,113,113,0.12)', color: '#fda4af', border: '1px solid rgba(248,113,113,0.3)', fontSize: 13 }}>
                  {problemLoadError}
                </div>
              )}
              {!problem.error && <div style={{ color: 'var(--accent-primary)', fontSize: 13, marginBottom: 20 }}>Complexity Floor: {problem.difficulty || problem.rating || 'Unrated'}</div>}
              
              {hasDescription ? (
                <div style={{ color: 'var(--text-main)', lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: problemDescriptionHtml }} />
              ) : (
                <div style={{ padding: 30, background: 'var(--accent-glow)', borderRadius: 12, border: '1px solid var(--accent-primary)', textAlign: 'center', marginTop: 20 }}>
                   <h3 style={{ color: 'var(--text-main)', margin: '0 0 10px' }}>Problem Details Hidden</h3>
                   <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>Due to platform constraints, this description cannot be rendered natively.</p>
                   {problem.originalUrl && (
                     <a href={problem.originalUrl} target="_blank" rel="noreferrer" style={{ background: 'var(--accent-primary)', color: '#000', padding: '10px 20px', borderRadius: 8, textDecoration: 'none', fontWeight: 'bold', display: 'inline-block' }}>
                       View Original Problem ↗
                     </a>
                   )}
                </div>
              )}

              {(sampleData.input || sampleData.output) && !isTerminalMode && (
                <div style={{ marginTop: 24, padding: 16, borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  {sampleData.input && (
                    <><strong style={{ display: 'block', marginBottom: 8, color: 'var(--text-muted)' }}>Sample Input</strong>
                    <pre style={{ margin: '0 0 16px 0', color: 'var(--text-main)', background: 'var(--bg-panel-solid)', padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap' }}>{sampleData.input}</pre></>
                  )}
                  {sampleData.output && (
                    <><strong style={{ display: 'block', marginBottom: 8, color: 'var(--text-muted)' }}>Expected Output</strong>
                    <pre style={{ margin: 0, color: 'var(--text-main)', background: 'var(--bg-panel-solid)', padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap' }}>{sampleData.output}</pre></>
                  )}
                </div>
              )}

              {isTerminalMode && (
                <div style={{ marginTop: 24, padding: 16, borderRadius: 12, background: 'var(--bg-card)', border: '2px solid var(--accent-primary)' }}>
                  <strong style={{ display: 'block', marginBottom: 8, color: 'var(--accent-primary)' }}>🖥️ Terminal Mode</strong>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 8px' }}>No predefined test cases mapped in DB. Pass standard STDIN parameters below:</p>
                  <textarea
                    placeholder="Enter STDIN here...\nExample:\n5\n1 2 3 4 5"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    style={{
                      width: '100%',
                      height: 120,
                      background: 'var(--bg-panel-solid)',
                      color: 'var(--text-main)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 8,
                      padding: 12,
                      fontFamily: 'monospace',
                      fontSize: 13,
                      outline: 'none',
                      resize: 'vertical',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              )}
            </>
          )}

          {workspaceTab === 'video' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h3 style={{ color: 'var(--text-main)', margin: 0 }}>Algorithmic Video Streaming</h3>
              
              {getYouTubeEmbedUrl(problem.videoUrl) ? (
                <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden', borderRadius: 12, background: '#000' }}>
                   <iframe
                      src={getYouTubeEmbedUrl(problem.videoUrl)!}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                      allowFullScreen
                   />
                </div>
              ) : (
                <div style={{ padding: '40px 24px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                  <div style={{ fontSize: 34, marginBottom: 10 }}>🎥</div>
                  <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text-main)' }}>No editorial video linked yet</div>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: '0 0 16px 0' }}>Watch a community walkthrough of this exact topic on YouTube instead.</p>
                  <a
                    href={`https://www.youtube.com/results?search_query=${encodeURIComponent(problem.title + ' algorithm explanation')}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent-primary)', fontWeight: 700, textDecoration: 'none' }}
                  >
                    Search matching lessons on YouTube →
                  </a>
                </div>
              )}
            </div>
          )}

          {workspaceTab === 'discuss' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <h2 style={{ color: 'var(--text-main)', margin: '0 0 15px 0' }}>Community Threads</h2>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {posts.map((p, idx) => (
                  <div key={idx} style={{ background: 'var(--bg-card)', padding: 16, borderRadius: 12, border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}><strong style={{ color: 'var(--accent-primary)' }}>{p.author}</strong><span style={{ color: 'var(--text-muted)' }}>{p.timestamp}</span></div>
                    <div style={{ color: 'var(--text-main)', fontSize: 14, lineHeight: 1.5 }}>{p.message}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input value={discussionInput} onChange={e => setDiscussionInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitComment()} placeholder="Share your approach..." style={{ flex: 1, padding: 12, borderRadius: 8, background: 'var(--bg-panel-solid)', border: '1px solid var(--border-color)', color: 'var(--text-main)', outline: 'none' }} />
                <button onClick={submitComment} style={{ background: 'var(--accent-primary)', color: '#000', border: 'none', padding: '0 20px', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>Post</button>
              </div>
            </div>
          )}

          {workspaceTab === 'voice' && problem?.id && (
             <VoiceInterviewer
                currentQuestion={{ ...problem, id: problem.id }}
                code={code}
                onSuccess={() => playSuccessAudio()}
             />
          )}

        </div>
      </section>

      <section className="workspace-right">
        <div style={{ padding: '12px 16px', background: 'var(--bg-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap', gap: 10 }}>
          
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <select value={language} onChange={e => setLanguage(e.target.value)} style={{ background: 'var(--bg-panel-solid)', color: 'var(--text-main)', border: '1px solid var(--border-color)', padding: '8px 12px', borderRadius: 8, outline: 'none', cursor: 'pointer' }}>
              <option value="cpp">C++ (GCC 9.2)</option>
              <option value="python">Python 3</option>
              <option value="c">C</option>
            </select>

            <div style={{ position: 'relative' }}>
              <button 
                onClick={() => setIsKitsMenuOpen(!isKitsMenuOpen)}
                style={{ background: 'var(--accent-glow)', color: 'var(--accent-primary)', border: '1px solid var(--accent-glow)', padding: '8px 16px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>
                🎒 Battle-Kits ▼
              </button>
              
              {isKitsMenuOpen && (
                <div style={{ position: 'absolute', top: 45, left: 0, width: 280, background: 'var(--bg-panel-solid)', border: '1px solid var(--border-color)', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.2)', zIndex: 100, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 15px', background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', fontSize: 12, color: 'var(--text-muted)', fontWeight: 'bold' }}>INJECT TEMPLATE</div>
                  {battleKits.map((kit, i) => (
                    <button 
                      key={i} 
                      onClick={() => { setCode(kit.code); setIsKitsMenuOpen(false); }}
                      style={{ display: 'block', width: '100%', padding: '12px 15px', textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-glow)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      ⚡ {kit.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <button onClick={runCode} disabled={running || problem?.error} style={{ background: running || problem?.error ? 'var(--border-color)' : 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#000', border: 'none', padding: '8px 24px', borderRadius: 8, fontWeight: 900, cursor: problem?.error ? 'not-allowed' : 'pointer', boxShadow: '0 0 15px var(--accent-glow)', opacity: problem?.error ? 0.5 : 1 }}>
            {running ? 'Compiling...' : isTerminalMode ? '▶ Run Code' : 'Submit Job ▶'}
          </button>
        </div>
        
        <div style={{ height: '60%' }}>
          <Editor height="100%" theme={editorTheme} language={monacoLanguage} value={code} onChange={handleEditorChange} options={{ fontSize: 15, minimap: { enabled: false }, padding: { top: 16 } }} />
        </div>
        
        <div style={{ height: '40%', background: 'var(--bg-main)', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
          <div className="mobile-scroll-x" style={{ background: 'var(--bg-panel-solid)' }}>
            <button onClick={() => setConsoleTab('output')} style={{ flex: '1 0 auto', padding: '12px 20px', background: consoleTab === 'output' ? 'var(--bg-panel-solid)' : 'transparent', color: consoleTab === 'output' ? 'var(--accent-primary)' : 'var(--text-main)', border: 'none', borderTop: consoleTab === 'output' ? '2px solid var(--accent-primary)' : '2px solid transparent', cursor: 'pointer', fontWeight: 'bold' }}>Console Output</button>
            <button onClick={() => setConsoleTab('mentor')} style={{ flex: '1 0 auto', padding: '12px 20px', background: consoleTab === 'mentor' ? 'var(--bg-panel-solid)' : 'transparent', color: consoleTab === 'mentor' ? 'var(--accent-primary)' : 'var(--text-main)', border: 'none', borderTop: consoleTab === 'mentor' ? '2px solid var(--accent-primary)' : '2px solid transparent', cursor: 'pointer', fontWeight: 'bold' }}>AI Profiler</button>
            <button onClick={invokeAIProfiler} disabled={analyzing || problem?.error} style={{ marginLeft: 'auto', flex: '0 0 auto', background: analyzing || problem?.error ? 'var(--border-color)' : 'var(--accent-primary)', color: '#000', border: 'none', padding: '0 20px', fontWeight: 700, cursor: problem?.error ? 'not-allowed' : 'pointer', opacity: problem?.error ? 0.5 : 1 }}>{analyzing ? 'Analyzing...' : 'Run Stack Analysis'}</button>
          </div>
          <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
            {consoleTab === 'output' ? (
              <>
                {outputs.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Execute program block to monitor standard output hooks.</p>}
                {outputs.map((out, idx) => (
                  <div key={idx} style={{ marginBottom: 12, padding: 12, borderRadius: 8, background: out.verdict === 'ACCEPTED' ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)' }}>
                    {isTerminalMode ? (
                      <>
                        <strong style={{ color: 'var(--text-main)' }}>Execution Status: </strong>
                        <span style={{ color: out.verdict === 'ACCEPTED' ? '#4ade80' : '#ef4444', fontWeight: 'bold' }}>{out.verdict}</span>
                        {out.runtimeMs && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>({out.runtimeMs}ms)</span>}
                        
                        {out.stdout && (
                          <>
                            <h4 style={{ color: 'var(--text-muted)', marginTop: 12 }}>STDOUT:</h4>
                            <pre style={{ color: 'var(--text-main)', background: 'var(--bg-panel-solid)', padding: 12, borderRadius: 6, whiteSpace: 'pre-wrap', margin: 0 }}>{out.stdout}</pre>
                          </>
                        )}
                        
                        {out.stderr && (
                          <>
                            <h4 style={{ color: '#ef4444', marginTop: 12 }}>STDERR:</h4>
                            <pre style={{ color: '#ef4444', background: 'var(--bg-panel-solid)', padding: 12, borderRadius: 6, whiteSpace: 'pre-wrap', margin: 0 }}>{out.stderr}</pre>
                          </>
                        )}
                        
                        {out.compileError && (
                          <>
                            <h4 style={{ color: '#ef4444', marginTop: 12 }}>Compilation Fault:</h4>
                            <pre style={{ color: '#ef4444', background: 'var(--bg-panel-solid)', padding: 12, borderRadius: 6, whiteSpace: 'pre-wrap', margin: 0 }}>{out.compileError}</pre>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <strong style={{ color: 'var(--text-main)' }}>Sys-Test {idx + 1}: </strong>
                        <span style={{ color: out.verdict === 'ACCEPTED' ? '#4ade80' : '#ef4444', fontWeight: 'bold' }}>{out.verdict}</span>
                        {out.runtimeMs && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>({out.runtimeMs}ms)</span>}
                        {out.compileError && <pre style={{ color: '#ef4444', marginTop: 12, whiteSpace: 'pre-wrap', fontSize: 13, background: 'var(--bg-panel-solid)', padding: 12, borderRadius: 6 }}>{out.compileError}</pre>}
                      </>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <div style={{ paddingTop: 10 }}>
                {aiAnalysis ? (
                  <div style={{ color: 'var(--text-main)', fontSize: 15, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {aiAnalysis}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', marginTop: 20 }}>
                    <h3 style={{ color: 'var(--accent-primary)', marginTop: 0 }}>🤖 Interactive Stack Explainer</h3>
                    <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>Execute the Profiler to dissect edge cases and Time Complexity gaps against constraints.</p>
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