import { CSSProperties, useEffect, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from 'next-auth/react'; 

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

const SUGGESTED_QUESTIONS = [
  "Can you suggest a roadmap for learning Dynamic Programming?",
  "How should I approach tricky graph traversal problems?",
  "What are the most common array manipulation patterns?"
];

// 👉 NEW: Sliding Puzzle Game Migrated to Practice Tab
function SlidingPuzzleGame() {
  const [tiles, setTiles] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [won, setWon] = useState(false);

  useEffect(() => { resetGame(); }, []);

  function resetGame() {
    let initial = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0];
    for (let i = initial.length - 2; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [initial[i], initial[j]] = [initial[j], initial[i]];
    }
    setTiles(initial);
    setMoves(0);
    setWon(false);
  }

  function handleTileClick(index: number) {
    if (won) return;
    const emptyIndex = tiles.indexOf(0);
    const validMoves = [index - 1, index + 1, index - 4, index + 4];

    if (index % 4 === 0 && emptyIndex === index - 1) return;
    if ((index + 1) % 4 === 0 && emptyIndex === index + 1) return;

    if (validMoves.includes(emptyIndex)) {
      const nextTiles = [...tiles];
      [nextTiles[index], nextTiles[emptyIndex]] = [nextTiles[emptyIndex], nextTiles[index]];
      setTiles(nextTiles);
      setMoves(m => m + 1);

      const isWin = nextTiles.slice(0, 15).every((val, i) => val === i + 1);
      if (isWin) setWon(true);
    }
  }

  return (
    <div style={{ background: 'linear-gradient(180deg, rgba(15,23,42,0.9), rgba(15,23,42,0.6))', border: '1px solid rgba(148,163,184,.22)', padding: 30, borderRadius: 24, width: '100%', maxWidth: 450, margin: '0 auto', boxShadow: '0 28px 90px rgba(0,0,0,.3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ margin: 0, color: '#67e8f9', fontSize: 20, display: 'flex', alignItems: 'center', gap: 10 }}>🧠 Cognitive Arena</h3>
        <span style={{ fontSize: 14, color: '#94a3b8', background: 'rgba(2,6,23,.5)', padding: '6px 12px', borderRadius: 8 }}>Moves: <b style={{ color: '#fff' }}>{moves}</b></span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, background: '#020617', padding: 10, borderRadius: 16 }}>
        {tiles.map((tile, idx) => (
          <button 
            key={idx} 
            onClick={() => handleTileClick(idx)} 
            style={{ 
              width: '100%', aspectRatio: '1', borderRadius: 10, border: 'none', 
              background: tile === 0 ? 'transparent' : 'linear-gradient(135deg, #1e293b, #0f172a)', 
              borderBottom: tile === 0 ? 'none' : '3px solid #334155', 
              color: '#fff', fontSize: 20, fontWeight: 'bold', cursor: tile === 0 ? 'default' : 'pointer', 
              transition: 'all 0.1s ease',
              boxShadow: tile === 0 ? 'none' : '0 4px 6px rgba(0,0,0,0.3)'
            }}
          >
            {tile !== 0 ? tile : ''}
          </button>
        ))}
      </div>

      {won && <p style={{ color: '#4ade80', textAlign: 'center', fontWeight: 'bold', margin: '16px 0 0', fontSize: 18 }}>🎉 Perfect Solve!</p>}
      
      <button onClick={resetGame} style={{ marginTop: 20, width: '100%', padding: '12px', background: '#334155', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 'bold', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background = '#475569'} onMouseOut={e => e.currentTarget.style.background = '#334155'}>
        Reset Board Layout
      </button>
    </div>
  );
}

export default function PracticePage() {
  const { data: session } = useSession(); 
  const [problems, setProblems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Tab State
  const [activeTab, setActiveTab] = useState<'coding' | 'logical'>('coding');

  // Coding Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('All');
  const [platformFilter, setPlatformFilter] = useState('All');

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
    
    fetch(`${API_BASE_URL}/api/v2/ai-dataset`, { headers })
      .then(r => r.json())
      .then(dsaRes => { 
        setProblems(Array.isArray(dsaRes.problems) ? dsaRes.problems : []); 
        setLoading(false); 
      })
      .catch(() => { setLoading(false); });
  }, [session]); 

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, isAiTyping]);

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
          <div style={{ background: '#0f172a', padding: 40, borderRadius: 16, border: '1px solid #1e293b', minHeight: 400, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h2 style={{ margin: '0 0 10px', color: '#eef2ff' }}>The 15-Puzzle Simulator</h2>
            <p style={{ margin: '0 0 30px', color: '#94a3b8', textAlign: 'center', maxWidth: 600 }}>
              Improve your spatial reasoning and algorithmic thinking. Arrange the tiles in ascending order from 1 to 15, leaving the bottom-right corner empty.
            </p>
            <SlidingPuzzleGame />
          </div>
        )}

        {activeTab === 'coding' && (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              <input placeholder="Search problems or topics..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ ...filterInput, flex: 1, minWidth: 250 }} />
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
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}><motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} style={{ display: 'inline-block', width: 30, height: 30, border: '3px solid rgba(103,232,249,0.2)', borderTopColor: '#67e8f9', borderRadius: '50%' }} /><p style={{ marginTop: 15 }}>Loading Questions...</p></td></tr>
                  ) : filteredProblems.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>No problems match your filters in the database.</td></tr>
                  ) : (
                    filteredProblems.map((p, idx) => {
                      const hasDescription = p.descriptionHtml && p.descriptionHtml.replace(/<[^>]*>/g, '').trim().length > 15;
                      
                      return (
                        <motion.tr 
                          key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.02 }}
                          style={{ borderBottom: '1px solid #1e293b', background: idx % 2 === 0 ? 'transparent' : 'rgba(15,23,42,0.4)', transition: 'background 0.2s', cursor: 'pointer' }}
                          onClick={() => {
                            if (!hasDescription && p.originalUrl) {
                              window.open(p.originalUrl, '_blank', 'noopener,noreferrer');
                            } else {
                              window.location.href = `/practice/${p.id}`;
                            }
                          }}
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
                                <div style={{ background: 'rgba(56,189,248,0.06)', padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(56,189,248,0.2)', fontSize: 13, color: '#7dd3fc', display: 'inline-block' }}>
                                  <span>Solve this directly on {p.platform || 'the original platform'}. </span>
                                  {p.originalUrl && (
                                    <a href={p.originalUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: '#38bdf8', fontWeight: 'bold', marginLeft: 6, textDecoration: 'underline' }}>
                                      Open ↗
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