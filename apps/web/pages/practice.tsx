import { CSSProperties, useEffect, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from 'next-auth/react'; 

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

const SUGGESTED_QUESTIONS = [
  "Can you suggest a roadmap for learning Dynamic Programming?",
  "How should I approach tricky graph traversal problems?",
  "What are the most common array manipulation patterns?"
];

export default function PracticePage() {
  const { data: session } = useSession(); 
  const [problems, setProblems] = useState<any[]>([]);
  const [mcqData, setMcqData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Tab State
  const [activeTab, setActiveTab] = useState<'coding' | 'logical'>('coding');

  // Coding Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('All');
  const [platformFilter, setPlatformFilter] = useState('All');

  // Logical Games State
  const [stopwatchTime, setStopwatchTime] = useState(0);
  const [isStopwatchRunning, setIsStopwatchRunning] = useState(false);
  const [logicalAnswers, setLogicalAnswers] = useState<Record<number, number>>({});
  const [logicalScore, setLogicalScore] = useState<number | null>(null);

  // Chatbot State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const [chatMessages, setChatMessages] = useState<{role: 'user'|'ai', text: string, image?: string}[]>([
    { role: 'ai', text: 'Hello! I have access to over 5,000+ DSA questions. How can I help you practice today? Upload an image if you have a specific unexpected question!' }
  ]);

  // FULLY DYNAMIC API FETCH
  useEffect(() => {
    const headers = { 'x-user-email': session?.user?.email || '' };
    
    Promise.allSettled([
      fetch(`${API_BASE_URL}/api/v2/ai-dataset`, { headers }).then(r => r.json()),
      fetch(`${API_BASE_URL}/api/v2/mcqs`, { headers }).then(r => r.json())
    ])
    .then(([dsaRes, mcqRes]) => { 
      if (dsaRes.status === 'fulfilled') {
        setProblems(Array.isArray(dsaRes.value.problems) ? dsaRes.value.problems : []); 
      }
      if (mcqRes.status === 'fulfilled') {
        setMcqData(Array.isArray(mcqRes.value) ? mcqRes.value : []);
      }
      setLoading(false); 
    })
    .catch(() => { setLoading(false); });
  }, [session]); 

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, isAiTyping]);

  // Stopwatch Logic
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isStopwatchRunning) {
      interval = setInterval(() => setStopwatchTime(prev => prev + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [isStopwatchRunning]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Dynamically uses backend dataset
  const dailyLogicalGames = useMemo(() => {
    const logicalPool = mcqData.filter(q => q.type === 'logical');
    if (logicalPool.length === 0) return [];
    
    const dayOfYear = Math.floor(Date.now() / 86400000);
    const startIndex = dayOfYear % Math.max(1, logicalPool.length - 2);
    
    return logicalPool.slice(startIndex, startIndex + 3);
  }, [mcqData]);

  const submitLogicalGames = () => {
    let currentScore = 0;
    dailyLogicalGames.forEach(q => {
      if (logicalAnswers[q.id] === q.correctIndex) currentScore++;
    });
    setLogicalScore(currentScore);
    setIsStopwatchRunning(false);
  };

  const getDifficultyColor = (rating: number | string | null) => {
    if (!rating) return '#94a3b8'; 
    if (rating === 'Easy' || Number(rating) < 1200) return '#4ade80';
    if (rating === 'Medium' || Number(rating) < 1600) return '#fbbf24'; 
    return '#f87171'; 
  };

  const filteredProblems = useMemo(() => {
    return problems.filter((p) => {
      const matchesSearch = p.title?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            p.tags?.some((t: string) => t.toLowerCase().includes(searchQuery.toLowerCase()));
      const difficulty = p.difficulty || 'Unrated';
      const matchesDifficulty = difficultyFilter === 'All' || difficulty === difficultyFilter;
      const matchesPlatform = platformFilter === 'All' || (p.platform || 'DivineCode') === platformFilter;
      return matchesSearch && matchesDifficulty && matchesPlatform;
    });
  }, [problems, searchQuery, difficultyFilter, platformFilter]);

  const sendToAI = async (text: string, imageBase64: string | null = null) => {
    const userMsg = { role: 'user' as const, text: text + (imageBase64 ? '\n[Image Attached]' : ''), image: imageBase64 || undefined };
    setChatMessages(prev => [...prev, userMsg]);
    setIsAiTyping(true);
    
    const systemPrompt = "You are the DivineCode Practice Guide. Recommend problems, explain concepts, and analyze any uploaded images accurately. Keep answers highly concise, friendly, and use markdown.";
    
    const payloadHistory = [
      { role: 'user', text: systemPrompt },
      { role: 'model', text: 'Understood. I will help them practice.' },
      ...chatMessages.slice(1).map(m => ({ role: m.role === 'ai' ? 'model' : 'user', text: m.text }))
    ];

    try {
      const res = await fetch(`${API_BASE_URL}/api/v2/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: payloadHistory, image: imageBase64 })
      });
      const data = await res.json();
      setChatMessages(prev => [...prev, { role: 'ai', text: data.reply }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'ai', text: 'Error connecting to neural core.' }]);
    } finally { setIsAiTyping(false); }
  };

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    const text = chatInput;
    setChatInput('');
    sendToAI(text);
  };

  const handleImageUpload = (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
       const base64 = event.target?.result as string;
       sendToAI(chatInput || "I need help with this image.", base64);
       setChatInput('');
    };
    reader.readAsDataURL(file);
  };

  return (
    <main style={page}>
      <section style={{ maxWidth: 1200, margin: '0 auto' }}>
        <nav style={nav}>
          <a href="/" style={brand}>
            <span style={logoBadge}>DC</span> DivineCode Practice
          </a>
          <a href="/contests" style={pill}>Contests Arena</a>
        </nav>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} style={hero}>
          <div style={{ flex: 1 }}>
            <p style={eyebrow}>AI-Powered Workspace</p>
            <h1 style={{ fontSize: 48, margin: '10px 0' }}>Master Data Structures & Algorithms</h1>
            <p style={{ color: '#94a3b8', fontSize: 16, maxWidth: 800 }}>
              Solve curated problems using our localized execution environment. 
              Stuck on a tricky graph problem? Launch the AI Avatar Explainer in the workspace for step-by-step guidance.
            </p>
          </div>
        </motion.div>

        <div style={{ display: 'flex', gap: 15, marginBottom: 25, borderBottom: '1px solid #1e293b', paddingBottom: 15 }}>
          <button onClick={() => setActiveTab('coding')} style={activeTab === 'coding' ? activeTabStyle : inactiveTabStyle}>
            Terminal & Coding Problems
          </button>
          <button onClick={() => setActiveTab('logical')} style={activeTab === 'logical' ? activeTabStyle : inactiveTabStyle}>
            Logical & Reasoning Games
          </button>
        </div>

        {activeTab === 'logical' && (
          <div style={{ background: '#0f172a', padding: 30, borderRadius: 16, border: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30, flexWrap: 'wrap', gap: 20 }}>
              <div>
                <h2 style={{ margin: '0 0 5px', color: '#eef2ff' }}>Daily Logic Arena</h2>
                <p style={{ margin: 0, color: '#94a3b8' }}>Train your deductive reasoning. Problems reset every 24 hours.</p>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 15, background: '#020617', padding: '10px 20px', borderRadius: 12, border: '1px solid #334155' }}>
                <span style={{ fontSize: 28, fontWeight: 'bold', color: '#38bdf8', fontFamily: 'monospace', width: 90 }}>
                  {formatTime(stopwatchTime)}
                </span>
                <button 
                  onClick={() => setIsStopwatchRunning(!isStopwatchRunning)} 
                  style={{ background: isStopwatchRunning ? '#ef4444' : '#10b981', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}
                >
                  {isStopwatchRunning ? '⏸ Pause' : '▶ Start'}
                </button>
                <button 
                  onClick={() => { setStopwatchTime(0); setLogicalScore(null); setLogicalAnswers({}); setIsStopwatchRunning(false); }}
                  style={{ background: '#1e293b', color: '#cbd5e1', border: 'none', padding: '8px 16px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}
                >
                  🔄 Reset
                </button>
              </div>
            </div>

            {loading ? (
              <p style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Initializing puzzle engine...</p>
            ) : dailyLogicalGames.length === 0 ? (
              <p style={{ color: '#f87171', textAlign: 'center', padding: 40 }}>Could not fetch today's puzzles from the server.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
                {dailyLogicalGames.map((q, idx) => (
                  <div key={q.id} style={{ background: '#1e293b', padding: 20, borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 15 }}>
                      <strong style={{ color: '#38bdf8' }}>Puzzle {idx + 1}</strong>
                      <span style={{ background: 'rgba(56,189,248,0.1)', color: '#7dd3fc', padding: '2px 8px', borderRadius: 6, fontSize: 12 }}>{q.concept}</span>
                    </div>
                    <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 20 }}>{q.question}</p>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {q.options.map((opt: string, optIdx: number) => {
                        const isSelected = logicalAnswers[q.id] === optIdx;
                        const showCorrect = logicalScore !== null && q.correctIndex === optIdx;
                        const showWrong = logicalScore !== null && isSelected && q.correctIndex !== optIdx;

                        return (
                          <button 
                            key={optIdx} 
                            disabled={logicalScore !== null}
                            onClick={() => {
                              setLogicalAnswers(prev => ({ ...prev, [q.id]: optIdx }));
                              if (!isStopwatchRunning && stopwatchTime === 0) setIsStopwatchRunning(true);
                            }}
                            style={{
                              padding: '12px 16px', borderRadius: 8, textAlign: 'left', cursor: logicalScore !== null ? 'default' : 'pointer', transition: '0.2s',
                              background: showCorrect ? 'rgba(74,222,128,0.2)' : showWrong ? 'rgba(248,113,113,0.2)' : isSelected ? 'rgba(56,189,248,0.2)' : '#0f172a',
                              border: `1px solid ${showCorrect ? '#4ade80' : showWrong ? '#f87171' : isSelected ? '#38bdf8' : '#334155'}`,
                              color: showCorrect ? '#4ade80' : showWrong ? '#f87171' : '#eef2ff'
                            }}
                          >
                            {String.fromCharCode(65 + optIdx)}. {opt}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {logicalScore === null ? (
                  <button onClick={submitLogicalGames} style={{ background: '#38bdf8', color: '#000', padding: 16, borderRadius: 12, border: 'none', fontSize: 18, fontWeight: 'bold', cursor: 'pointer', marginTop: 10 }}>
                    Submit Answers & Stop Clock
                  </button>
                ) : (
                  <div style={{ background: 'linear-gradient(135deg, rgba(74,222,128,0.2), rgba(56,189,248,0.2))', padding: 25, borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>
                    <h3 style={{ margin: '0 0 10px', fontSize: 24 }}>Session Complete!</h3>
                    <p style={{ margin: 0, fontSize: 18, color: '#cbd5e1' }}>
                      You scored <strong style={{ color: '#4ade80' }}>{logicalScore} / {dailyLogicalGames.length}</strong> in <strong style={{ color: '#38bdf8' }}>{formatTime(stopwatchTime)}</strong>.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'coding' && (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              <input placeholder="Search 5000+ questions or topics..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ ...filterInput, flex: 1, minWidth: 250 }} />
              <select value={difficultyFilter} onChange={(e) => setDifficultyFilter(e.target.value)} style={filterInput}><option value="All">All Difficulties</option><option value="Easy">Easy</option><option value="Medium">Medium</option><option value="Hard">Hard</option></select>
              <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} style={filterInput}><option value="All">All Platforms</option><option value="Codeforces">Codeforces</option><option value="LeetCode">LeetCode</option><option value="AtCoder">AtCoder</option><option value="CodeChef">CodeChef</option></select>
            </div>

            <div style={tableContainer}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e293b', color: '#94a3b8', fontSize: 14, background: '#020617' }}>
                    <th style={{ padding: '16px 20px', width: '5%' }}>Status</th><th style={{ padding: '16px 20px', width: '40%' }}>Title</th><th style={{ padding: '16px 20px', width: '15%' }}>Platform</th><th style={{ padding: '16px 20px', width: '15%' }}>Difficulty</th><th style={{ padding: '16px 20px', width: '25%' }}>Topics</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}><motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} style={{ display: 'inline-block', width: 30, height: 30, border: '3px solid rgba(103,232,249,0.2)', borderTopColor: '#67e8f9', borderRadius: '50%' }} /><p style={{ marginTop: 15 }}>Loading 5000+ Questions...</p></td></tr>
                  ) : filteredProblems.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>No problems match your filters in the database.</td></tr>
                  ) : (
                    filteredProblems.map((p, idx) => {
                      const hasDescription = p.descriptionHtml && p.descriptionHtml.replace(/<[^>]*>/g, '').trim().length > 15;
                      
                      return (
                        <motion.tr 
                          key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.02 }}
                          style={{ borderBottom: '1px solid #1e293b', background: idx % 2 === 0 ? 'transparent' : 'rgba(15,23,42,0.4)', transition: 'background 0.2s', cursor: 'pointer' }}
                          onClick={() => window.location.href = `/practice/${p.id}`}
                          onMouseOver={(e) => e.currentTarget.style.background = 'rgba(30,41,59,0.8)'}
                          onMouseOut={(e) => e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'rgba(15,23,42,0.4)'}
                        >
                          <td style={{ padding: '16px 20px', verticalAlign: 'top' }}><div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #334155', marginTop: 4 }} /></td>
                          <td style={{ padding: '16px 20px', verticalAlign: 'top' }}>
                            <div style={{ fontWeight: 'bold', color: '#eef2ff', marginBottom: 8 }}>{p.title}</div>
                            <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
                              {hasDescription ? (
                                <div dangerouslySetInnerHTML={{ __html: p.descriptionHtml.substring(0, 120) + '...' }} />
                              ) : (
                                <div style={{ background: 'rgba(239,68,68,0.06)', padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)', fontSize: 13, color: '#f87171', display: 'inline-block' }}>
                                  <span>Problem text hidden. </span>
                                  {p.originalUrl && (
                                    <a href={p.originalUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: '#38bdf8', fontWeight: 'bold', marginLeft: 6, textDecoration: 'underline' }}>
                                      Open External Platform ↗
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '16px 20px', color: '#cbd5e1', verticalAlign: 'top' }}>{p.platform || 'DivineCode'}</td>
                          <td style={{ padding: '16px 20px', color: getDifficultyColor(p.difficulty), fontWeight: 600, verticalAlign: 'top' }}>{p.difficulty || 'Unrated'}</td>
                          <td style={{ padding: '16px 20px', verticalAlign: 'top' }}>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {(p.tags || []).slice(0, 3).map((tag: string) => (<span key={tag} style={tagStyle}>{tag}</span>))}
                              {(p.tags?.length > 3) && <span style={tagStyle}>+{p.tags.length - 3}</span>}
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <div style={floatingAiWrapper}>
        <AnimatePresence>
          {isChatOpen && (
            <motion.div initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.95 }} style={chatWindow}>
              <div style={chatHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={avatarImg}>🤖</div><strong style={{ color: '#fff' }}>Divine AI Guide</strong></div>
                <button onClick={() => setIsChatOpen(false)} style={closeBtn}>×</button>
              </div>
              <div style={chatBody}>
                {chatMessages.map((msg, i) => (
                   <div key={i} style={{ ...chatBubble, alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', background: msg.role === 'user' ? '#38bdf8' : '#1e293b', color: msg.role === 'user' ? '#000' : '#e2e8f0' }}>
                     {msg.text}
                     {msg.image && <img src={msg.image} alt="Uploaded" style={{ width: '100%', borderRadius: 8, marginTop: 10 }} />}
                   </div>
                ))}
                
                {chatMessages.length === 1 && !isAiTyping && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                    <p style={{ color: '#94a3b8', fontSize: 12, margin: 0 }}>Suggested Prompts:</p>
                    {SUGGESTED_QUESTIONS.map((q, i) => (
                      <button 
                        key={i} 
                        onClick={() => sendToAI(q)} 
                        style={{ background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: 8, padding: '8px 12px', textAlign: 'left', cursor: 'pointer', fontSize: 13, transition: '0.2s' }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}

                {isAiTyping && <div style={{ alignSelf: 'flex-start', background: '#1e293b', color: '#94a3b8', padding: '10px 14px', borderRadius: 12, fontSize: 14 }}>Thinking...</div>}
                <div ref={chatEndRef} />
              </div>
              <div style={chatFooter}>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, background: '#0f172a', borderRadius: 8, border: '1px solid #334155', fontSize: 16 }}>
                  📷<input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
                </label>
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} placeholder="Ask me anything..." style={chatInputStyle} />
                <button onClick={handleSendMessage} style={sendBtn}>↑</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {!isChatOpen && <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setIsChatOpen(true)} style={floatingBtn}>🤖 AI Guide</motion.button>}
      </div>
    </main>
  );
}

// Styles
const page: CSSProperties = { minHeight: '100vh', padding: '30px 20px', fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: '#020617', position: 'relative' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 };
const brand: CSSProperties = { color: '#fff', textDecoration: 'none', fontWeight: 900, fontSize: 22, display: 'flex', alignItems: 'center', gap: 12 };
const logoBadge: CSSProperties = { width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontSize: 16 };
const pill: CSSProperties = { color: '#dbeafe', textDecoration: 'none', padding: '10px 18px', borderRadius: 999, border: '1px solid rgba(148,163,184,.25)', background: '#0f172a', fontWeight: 'bold' };
const hero: CSSProperties = { padding: 40, borderRadius: 24, background: 'radial-gradient(circle at top right, rgba(34,211,238,.1), transparent 30rem), #0f172a', border: '1px solid #1e293b', marginBottom: 30, display: 'flex' };
const eyebrow: CSSProperties = { color: '#22d3ee', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 0 };

const activeTabStyle: CSSProperties = { background: 'transparent', color: '#38bdf8', border: 'none', borderBottom: '2px solid #38bdf8', paddingBottom: 10, fontSize: 18, fontWeight: 'bold', cursor: 'pointer' };
const inactiveTabStyle: CSSProperties = { background: 'transparent', color: '#64748b', border: 'none', borderBottom: '2px solid transparent', paddingBottom: 10, fontSize: 18, fontWeight: 'bold', cursor: 'pointer' };

const filterInput: CSSProperties = { padding: '12px 16px', borderRadius: 12, border: '1px solid #334155', background: '#0f172a', color: '#eef2ff', outline: 'none' };
const tableContainer: CSSProperties = { background: '#0f172a', borderRadius: 16, border: '1px solid #1e293b', overflow: 'hidden', paddingBottom: 50 };
const tagStyle: CSSProperties = { background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', padding: '4px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: '1px solid rgba(56, 189, 248, 0.2)' };

const floatingAiWrapper: CSSProperties = { position: 'fixed', bottom: 30, right: 30, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' };
const floatingBtn: CSSProperties = { background: '#38bdf8', color: '#000', border: 'none', padding: '15px 25px', borderRadius: 999, fontSize: 16, fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 10px 25px rgba(56, 189, 248, 0.3)' };
const chatWindow: CSSProperties = { width: 350, height: 480, background: '#0f172a', border: '1px solid #38bdf8', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' };
const chatHeader: CSSProperties = { background: '#1e293b', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155' };
const avatarImg: CSSProperties = { width: 30, height: 30, background: '#020617', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 18 };
const closeBtn: CSSProperties = { background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 24, cursor: 'pointer' };
const chatBody: CSSProperties = { flex: 1, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 };
const chatBubble: CSSProperties = { maxWidth: '85%', padding: '10px 14px', borderRadius: 12, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
const chatFooter: CSSProperties = { padding: 12, background: '#1e293b', borderTop: '1px solid #334155', display: 'flex', gap: 8, alignItems: 'center' };
const chatInputStyle: CSSProperties = { flex: 1, background: '#020617', border: '1px solid #334155', color: '#fff', borderRadius: 8, padding: '8px 12px', outline: 'none' };
const sendBtn: CSSProperties = { background: '#38bdf8', color: '#000', border: 'none', width: 40, height: 36, borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' };