/**
 * @file practice.tsx
 * @author Rahul Kumar Sahoo
 * @description Page-level experience and view logic.
 */

import { useEffect, useState, useRef, useMemo, CSSProperties } from 'react';
import { useSession } from 'next-auth/react'; 
import { motion, AnimatePresence } from 'framer-motion';
import toast, { Toaster } from 'react-hot-toast';
import { fetchApi } from '../lib/api';
import FloatingWindow from '../components/FloatingWindow';
import ContextLoader from '../components/ContextLoader';
import ChessGame from '../components/games/ChessGame';
import Minesweeper from '../components/games/Minesweeper';
import MemoryMatrix from '../components/games/MemoryMatrix';

const SUGGESTED_QUESTIONS = [
  "Can you suggest a roadmap for learning Dynamic Programming?",
  "How should I approach tricky graph traversal problems?",
  "What are the most common array manipulation patterns?"
];

// --- BIG O GUESSER DATA ---
const BIG_O_SNIPPETS = [
  { code: "for (let i = 0; i < n; i++) {\n  console.log(i);\n}", answer: "O(n)" },
  { code: "for (let i = 0; i < n; i++) {\n  for (let j = 0; j < n; j++) {\n    console.log(i, j);\n  }\n}", answer: "O(n^2)" },
  { code: "let i = n;\nwhile (i > 0) {\n  i = Math.floor(i / 2);\n}", answer: "O(log n)" },
  { code: "function fib(n) {\n  if (n <= 1) return n;\n  return fib(n - 1) + fib(n - 2);\n}", answer: "O(2^n)" },
  { code: "const val = arr[0];\nconsole.log(val);", answer: "O(1)" }
];
const BIG_O_OPTIONS = ["O(1)", "O(log n)", "O(n)", "O(n log n)", "O(n^2)", "O(2^n)"];

export default function PracticePage() {
  const { data: session, status } = useSession(); 

  const [problems, setProblems] = useState<any[]>([]);
  const [mcqData, setMcqData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Tab State
  const [activeTab, setActiveTab] = useState<'coding' | 'logical' | 'community'>('coding');
  const [communityProblems, setCommunityProblems] = useState<any[]>([]);
  const [communityError, setCommunityError] = useState('');
  const [logicalMode, setLogicalMode] = useState<'daily'|'sliding'|'base'|'bigo'|'chess'|'mines'|'memory'>('daily');

  // Coding Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('All');
  const [platformFilter, setPlatformFilter] = useState('All');

  // Logical Games State: Daily MCQs
  const [stopwatchTime, setStopwatchTime] = useState(0);
  const [isStopwatchRunning, setIsStopwatchRunning] = useState(false);
  const [logicalAnswers, setLogicalAnswers] = useState<Record<string, number>>({});
  const [logicalScore, setLogicalScore] = useState<number | null>(null);

  // Logical Games State: Sliding Puzzle
  const [puzzleGrid, setPuzzleGrid] = useState<number[]>([]);
  const [puzzleMoves, setPuzzleMoves] = useState(0);

  // Logical Games State: Base Converter
  const [baseQuestion, setBaseQuestion] = useState({ val: 0, from: 10, to: 2 });
  const [baseInput, setBaseInput] = useState('');
  const [baseScore, setBaseScore] = useState(0);

  // Logical Games State: Big O Guesser
  const [bigOIndex, setBigOIndex] = useState(0);
  const [bigOScore, setBigOScore] = useState(0);
  const [bigOFeedback, setBigOFeedback] = useState<string | null>(null);

  // Chatbot State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [chatMessages, setChatMessages] = useState<{role: 'user'|'ai', text: string, image?: string}[]>([
    { role: 'ai', text: 'Hello! I have access to over 5,000+ DSA questions. How can I help you practice today? Upload an image if you have a specific unexpected question!' }
  ]);

  // FULLY DYNAMIC API FETCH — cached copy paints instantly, then the network
  // response refreshes it in the background (stale-while-revalidate).
  useEffect(() => {
    if (status === 'loading') return;

    try {
      const cached = sessionStorage.getItem('dc-practice-data');
      if (cached) {
        const { problems: p, mcqs: m } = JSON.parse(cached);
        if (Array.isArray(p) && p.length) { setProblems(p); setLoading(false); }
        if (Array.isArray(m) && m.length) setMcqData(m);
      }
    } catch { /* cache is best-effort only */ }

    Promise.allSettled([
      fetchApi('/api/v2/ai-dataset'),
      fetchApi('/api/v2/mcqs')
    ]).then(([dsaRes, mcqRes]) => {
      const freshProblems = dsaRes.status === 'fulfilled' && Array.isArray(dsaRes.value.problems) ? dsaRes.value.problems : null;
      const freshMcqs = mcqRes.status === 'fulfilled' && Array.isArray(mcqRes.value) ? mcqRes.value : null;
      if (freshProblems) setProblems(freshProblems);
      if (freshMcqs) setMcqData(freshMcqs);
      if (freshProblems || freshMcqs) {
        try { sessionStorage.setItem('dc-practice-data', JSON.stringify({ problems: freshProblems || [], mcqs: freshMcqs || [] })); } catch { /* quota */ }
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [session, status]);

  // COMMUNITY HUB FETCH
  useEffect(() => {
    if (activeTab === 'community') {
      fetchApi('/api/v2/community/problems')
        .then(data => {
          if (data.error) {
            setCommunityError(data.error);
          } else {
            setCommunityProblems(data);
          }
        })
        .catch(() => setCommunityError("Failed to load community hub."));
    }
  }, [activeTab]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, isAiTyping]);

  // Stopwatch Logic
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isStopwatchRunning) interval = setInterval(() => setStopwatchTime(prev => prev + 1), 1000);
    return () => clearInterval(interval);
  }, [isStopwatchRunning]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // --- QUESTION OF THE DAY LOGIC ---
  const dailyChallenges = useMemo(() => {
    if (!problems || problems.length < 3) return [];

    // Seeded Fisher-Yates keyed on the calendar date: a genuinely different
    // trio every midnight (the old parity-comparator barely reordered anything).
    const today = new Date().toDateString();
    let seed = 0;
    for (let i = 0; i < today.length; i++) seed = ((seed * 31 + today.charCodeAt(i)) >>> 0);
    const rng = () => { seed = ((seed * 1664525 + 1013904223) >>> 0); return seed / 4294967296; };
    const shuffled = [...problems];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const easy = shuffled.find(p => p.difficulty === 'Easy') || shuffled[0];
    const medium = shuffled.find(p => p.difficulty === 'Medium' && p.id !== easy?.id) || shuffled[1];
    const hard = shuffled.find(p => p.difficulty === 'Hard' && p.id !== easy?.id && p.id !== medium?.id) || shuffled[2];

    // Label with the problem's REAL platform — an AtCoder task must never
    // wear a "Codeforces" badge.
    return [
      { ...easy, dayLabel: `${easy.platform || 'DivineCode'} Warm-up (Easy)`, dColor: '#4ade80' },
      { ...medium, dayLabel: `${medium.platform || 'DivineCode'} Builder (Medium)`, dColor: '#fbbf24' },
      { ...hard, dayLabel: `${hard.platform || 'DivineCode'} Arena (Hard)`, dColor: '#f87171' }
    ].filter(Boolean);
  }, [problems]);

  // Dynamically uses backend dataset for daily MCQs — a seeded shuffle keyed
  // on the day picks 5 fresh puzzles every midnight.
  const dailyLogicalGames = useMemo(() => {
    const logicalPool = mcqData.filter(q => q.type === 'logical');
    if (logicalPool.length === 0) return [];
    let seed = Math.floor(Date.now() / 86400000);
    const rng = () => { seed = ((seed * 1664525 + 1013904223) >>> 0); return seed / 4294967296; };
    const shuffled = [...logicalPool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, Math.min(5, shuffled.length));
  }, [mcqData]);

  const submitLogicalGames = () => {
    let currentScore = 0;
    dailyLogicalGames.forEach(q => { if (logicalAnswers[q.id] === q.correctIndex) currentScore++; });
    setLogicalScore(currentScore);
    setIsStopwatchRunning(false);
  };

  // --- SLIDING PUZZLE LOGIC ---
  const initPuzzle = () => {
    // Shuffle by applying random legal moves from the solved state — a naive
    // random permutation is unsolvable half the time (15-puzzle parity).
    let arr = Array.from({length: 15}, (_, i) => i + 1).concat([0]);
    let zero = 15;
    for (let step = 0; step < 250; step++) {
      const candidates = [zero - 1, zero + 1, zero - 4, zero + 4].filter(n =>
        n >= 0 && n < 16 &&
        !(zero % 4 === 0 && n === zero - 1) &&
        !(zero % 4 === 3 && n === zero + 1)
      );
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      [arr[zero], arr[pick]] = [arr[pick], arr[zero]];
      zero = pick;
    }
    setPuzzleGrid(arr);
    setPuzzleMoves(0);
  };
  useEffect(() => { if (puzzleGrid.length === 0) initPuzzle(); }, []);

  const handlePuzzleClick = (idx: number) => {
    const zeroIdx = puzzleGrid.indexOf(0);
    const isAdjacent = [1, -1, 4, -4].includes(idx - zeroIdx) && 
      !(zeroIdx % 4 === 3 && idx % 4 === 0) && !(zeroIdx % 4 === 0 && idx % 4 === 3);
    
    if (isAdjacent) {
      let newGrid = [...puzzleGrid];
      [newGrid[idx], newGrid[zeroIdx]] = [newGrid[zeroIdx], newGrid[idx]];
      setPuzzleGrid(newGrid);
      setPuzzleMoves(m => m + 1);
    }
  };

  // --- BASE CONVERTER LOGIC ---
  const generateBaseQ = () => {
    const bases = [2, 10, 16];
    const from = bases[Math.floor(Math.random() * bases.length)];
    let to = bases[Math.floor(Math.random() * bases.length)];
    while (to === from) to = bases[Math.floor(Math.random() * bases.length)];
    setBaseQuestion({ val: Math.floor(Math.random() * 255) + 1, from, to });
    setBaseInput('');
  };
  useEffect(() => { generateBaseQ(); }, []);

  const handleBaseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const correctAns = baseQuestion.val.toString(baseQuestion.to).toUpperCase();
    if (baseInput.trim().toUpperCase() === correctAns) {
      setBaseScore(s => s + 1);
      generateBaseQ();
    } else {
      toast.error(`Incorrect! It was ${correctAns}`);
      setBaseScore(0);
      generateBaseQ();
    }
  };

  // --- BIG O GUESSER LOGIC ---
  const handleBigOGuess = (guess: string) => {
    const actual = BIG_O_SNIPPETS[bigOIndex].answer;
    if (guess === actual) {
      setBigOFeedback('Correct! 🎉');
      setBigOScore(s => s + 1);
    } else {
      setBigOFeedback(`Wrong. It was ${actual}.`);
      setBigOScore(0);
    }
    setTimeout(() => {
      setBigOFeedback(null);
      setBigOIndex((i) => (i + 1) % BIG_O_SNIPPETS.length);
    }, 1500);
  };

  // --- HELPERS ---
  const getDifficultyColor = (rating: number | string | null) => {
    if (!rating) return 'var(--text-muted)'; 
    if (rating === 'Easy' || Number(rating) < 1200) return '#4ade80';
    if (rating === 'Medium' || Number(rating) < 1600) return '#fbbf24'; 
    return '#f87171'; 
  };

  const filteredProblems = useMemo(() => {
    return problems.filter((p) => {
      const titleStr = p.title || '';
      const matchesSearch = titleStr.toLowerCase().includes(searchQuery.toLowerCase()) || p.tags?.some((t: string) => t.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesDiff = difficultyFilter === 'All' || p.difficulty === difficultyFilter;
      const matchesPlat = platformFilter === 'All' || (p.platform || 'DivineCode') === platformFilter;
      return matchesSearch && matchesDiff && matchesPlat;
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
      const data = await fetchApi('/api/v2/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message: text, history: payloadHistory, image: imageBase64 })
      });
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
      <Toaster position="top-center" toastOptions={{ style: { background: 'var(--bg-panel-solid)', color: 'var(--text-main)', border: '1px solid var(--border-color)' } }} />
      <section style={{ maxWidth: 1200, margin: '0 auto' }}>
        <nav style={nav}>
          <a href="/" style={brand}>
            <img src="/logo.png" alt="DivineCode Logo" style={{ width: 32, height: 32, objectFit: 'contain' }} />
            DivineCode Practice
          </a>
          <a href="/contests" style={pill}>Contests Arena</a>
        </nav>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} style={hero}>
          <div style={{ flex: 1 }}>
            <p style={eyebrow}>AI-Powered Workspace</p>
            <h1 style={{ fontSize: 'clamp(28px, 5vw, 48px)', margin: '10px 0', color: 'var(--text-main)' }}>Master Data Structures & Algorithms</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 'clamp(14px, 2vw, 16px)', maxWidth: 800 }}>
              Solve curated problems using our localized execution environment. 
              Stuck on a tricky graph problem? Launch the AI Avatar Explainer in the workspace for step-by-step guidance.
            </p>
          </div>
        </motion.div>

        {/* Master Tab Bar */}
        <div style={{ display: 'flex', gap: 15, marginBottom: 25, borderBottom: '1px solid var(--border-color)', paddingBottom: 15, overflowX: 'auto', whiteSpace: 'nowrap' }}>
          <button onClick={() => setActiveTab('coding')} style={activeTab === 'coding' ? activeTabStyle : inactiveTabStyle}>Terminal & Coding Problems</button>
          <button onClick={() => setActiveTab('logical')} style={activeTab === 'logical' ? activeTabStyle : inactiveTabStyle}>Logical & Reasoning Games</button>
          <button onClick={() => setActiveTab('community')} style={activeTab === 'community' ? activeTabStyle : inactiveTabStyle}>🌍 Community Hub</button>
        </div>

        {/* COMMUNITY HUB SECTION */}
        {activeTab === 'community' && (
          <section style={{ background: 'var(--bg-panel)', padding: 30, borderRadius: 16, border: '1px solid var(--border-color)' }}>
            <h2 style={{ color: 'var(--accent-primary)', marginTop: 0 }}>🌍 Community Hub</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>Problems contributed by the DivineCode community. Approved for practice.</p>
            
            {communityError ? (
              <div style={{ padding: 20, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: 12, color: '#ef4444' }}>
                <strong>Access Denied:</strong> {communityError}
              </div>
            ) : communityProblems.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>No approved community problems found.</p>
            ) : (
              <div style={{ display: 'grid', gap: 15 }}>
                {communityProblems.map(p => (
                  <div 
                    key={p.id} 
                    style={{ background: 'var(--bg-card)', padding: 20, borderRadius: 12, border: '1px solid var(--border-color)', cursor: 'pointer' }} 
                    onClick={() => window.location.href = `/practice/${p.id}`}
                  >
                    <strong style={{ color: 'var(--text-main)', fontSize: 18 }}>{p.title}</strong>
                    <p style={{ color: 'var(--text-muted)', margin: '8px 0' }}>{p.platform} Difficulty: {p.difficulty || 'N/A'}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* LOGICAL GAMES SECTION */}
        {activeTab === 'logical' && (
          <div style={{ background: 'var(--bg-panel)', padding: 30, borderRadius: 16, border: '1px solid var(--border-color)' }}>
            
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
              <button onClick={() => setLogicalMode('daily')} style={logicalMode === 'daily' ? activePill : inactivePill}>📝 Daily MCQs</button>
              <button onClick={() => setLogicalMode('chess')} style={logicalMode === 'chess' ? activePill : inactivePill}>♟️ Chess</button>
              <button onClick={() => setLogicalMode('mines')} style={logicalMode === 'mines' ? activePill : inactivePill}>💣 Minesweeper</button>
              <button onClick={() => setLogicalMode('memory')} style={logicalMode === 'memory' ? activePill : inactivePill}>🧠 Memory Matrix</button>
              <button onClick={() => setLogicalMode('base')} style={logicalMode === 'base' ? activePill : inactivePill}>🔢 Base Converter</button>
              <button onClick={() => setLogicalMode('bigo')} style={logicalMode === 'bigo' ? activePill : inactivePill}>⏱️ Big-O Guesser</button>
              <button onClick={() => setLogicalMode('sliding')} style={logicalMode === 'sliding' ? activePill : inactivePill}>🧩 Sliding Puzzle</button>
            </div>

            {logicalMode === 'chess' && (
              <div style={{ padding: '10px 0' }}>
                <h2 style={{ color: 'var(--text-main)', margin: '0 0 6px', textAlign: 'center' }}>Grandmaster Arena</h2>
                <p style={{ color: 'var(--text-muted)', margin: '0 0 10px', textAlign: 'center' }}>Full chess rules. Beat the engine or duel a friend on one screen.</p>
                <ChessGame />
              </div>
            )}

            {logicalMode === 'mines' && (
              <div style={{ padding: '10px 0' }}>
                <h2 style={{ color: 'var(--text-main)', margin: '0 0 6px', textAlign: 'center' }}>Minefield Protocol</h2>
                <p style={{ color: 'var(--text-muted)', margin: '0 0 10px', textAlign: 'center' }}>Pure deduction under pressure — clear the field without triggering a mine.</p>
                <Minesweeper />
              </div>
            )}

            {logicalMode === 'memory' && (
              <div style={{ padding: '10px 0' }}>
                <h2 style={{ color: 'var(--text-main)', margin: '0 0 6px', textAlign: 'center' }}>Memory Matrix</h2>
                <p style={{ color: 'var(--text-muted)', margin: '0 0 10px', textAlign: 'center' }}>Spatial-span training: the grid grows as your recall does.</p>
                <MemoryMatrix />
              </div>
            )}

            {logicalMode === 'daily' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30, flexWrap: 'wrap', gap: 20 }}>
                  <div>
                    <h2 style={{ margin: '0 0 5px', color: 'var(--text-main)' }}>Daily Logic Arena</h2>
                    <p style={{ margin: 0, color: 'var(--text-muted)' }}>Train your deductive reasoning. Problems reset every 24 hours.</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 15, background: 'var(--bg-card)', padding: '10px 20px', borderRadius: 12, border: '1px solid var(--border-color)' }}>
                    <span style={{ fontSize: 28, fontWeight: 'bold', color: 'var(--accent-primary)', fontFamily: 'monospace', width: 90 }}>{formatTime(stopwatchTime)}</span>
                    <button onClick={() => setIsStopwatchRunning(!isStopwatchRunning)} style={{ background: isStopwatchRunning ? '#ef4444' : '#10b981', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>
                      {isStopwatchRunning ? '⏸ Pause' : '▶ Start'}
                    </button>
                    <button onClick={() => { setStopwatchTime(0); setLogicalScore(null); setLogicalAnswers({}); setIsStopwatchRunning(false); }} style={{ background: 'var(--border-color)', color: 'var(--text-main)', border: 'none', padding: '8px 16px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>
                      🔄 Reset
                    </button>
                  </div>
                </div>

                {loading ? <ContextLoader context="practice" label="Initializing puzzle engine…" />
                : dailyLogicalGames.length === 0 ? <p style={{ color: '#f87171', textAlign: 'center', padding: 40 }}>Could not fetch today's puzzles from the server.</p>
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
                    {dailyLogicalGames.map((q, idx) => (
                      <div key={q.id} style={{ background: 'var(--bg-card)', padding: 20, borderRadius: 12, border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 15 }}>
                          <strong style={{ color: 'var(--accent-primary)' }}>Puzzle {idx + 1}</strong>
                          <span style={{ background: 'var(--accent-glow)', color: 'var(--accent-primary)', padding: '2px 8px', borderRadius: 6, fontSize: 12 }}>{q.concept}</span>
                        </div>
                        <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 20, color: 'var(--text-main)' }}>{q.question}</p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 10 }}>
                          {q.options.map((opt: string, optIdx: number) => {
                            const isSelected = logicalAnswers[q.id] === optIdx;
                            const showCorrect = logicalScore !== null && q.correctIndex === optIdx;
                            const showWrong = logicalScore !== null && isSelected && q.correctIndex !== optIdx;
                            return (
                              <button key={optIdx} disabled={logicalScore !== null} onClick={() => { setLogicalAnswers(prev => ({ ...prev, [q.id]: optIdx })); if (!isStopwatchRunning && stopwatchTime === 0) setIsStopwatchRunning(true); }} style={{ padding: '12px 16px', borderRadius: 8, textAlign: 'left', cursor: logicalScore !== null ? 'default' : 'pointer', transition: '0.2s', background: showCorrect ? 'rgba(74,222,128,0.2)' : showWrong ? 'rgba(248,113,113,0.2)' : isSelected ? 'var(--accent-glow)' : 'var(--bg-panel-solid)', border: `1px solid ${showCorrect ? '#4ade80' : showWrong ? '#f87171' : isSelected ? 'var(--accent-primary)' : 'var(--border-color)'}`, color: showCorrect ? '#4ade80' : showWrong ? '#f87171' : 'var(--text-main)' }}>
                                {String.fromCharCode(65 + optIdx)}. {opt}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    {logicalScore === null ? <button onClick={submitLogicalGames} style={{ background: 'var(--accent-primary)', color: '#000', padding: 16, borderRadius: 12, border: 'none', fontSize: 18, fontWeight: 'bold', cursor: 'pointer', marginTop: 10 }}>Submit Answers & Stop Clock</button>
                    : <div style={{ background: 'linear-gradient(135deg, rgba(74,222,128,0.2), var(--accent-glow))', padding: 25, borderRadius: 12, border: '1px solid var(--accent-primary)', textAlign: 'center' }}><h3 style={{ margin: '0 0 10px', fontSize: 24, color: 'var(--text-main)' }}>Session Complete!</h3><p style={{ margin: 0, fontSize: 18, color: 'var(--text-muted)' }}>You scored <strong style={{ color: '#4ade80' }}>{logicalScore} / {dailyLogicalGames.length}</strong> in <strong style={{ color: 'var(--accent-primary)' }}>{formatTime(stopwatchTime)}</strong>.</p></div>}
                  </div>
                )}
              </>
            )}

            {logicalMode === 'base' && (
              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <h2 style={{ color: 'var(--text-main)', margin: '0 0 10px' }}>Base Conversion Speed Drill</h2>
                <p style={{ color: 'var(--text-muted)', marginBottom: 30 }}>Convert numbers quickly between Binary, Decimal, and Hexadecimal.</p>
                <div style={{ background: 'var(--bg-card)', display: 'inline-block', padding: 30, borderRadius: 16, border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: 20, color: 'var(--text-main)', marginBottom: 20 }}>
                    Convert Base <strong style={{color:'#fbbf24'}}>{baseQuestion.from}</strong> <br/>
                    <span style={{ fontSize: 40, fontWeight: 'bold', display: 'block', margin: '15px 0', color: 'var(--accent-primary)' }}>{baseQuestion.val.toString(baseQuestion.from).toUpperCase()}</span>
                    to Base <strong style={{color:'#fbbf24'}}>{baseQuestion.to}</strong>
                  </div>
                  <form onSubmit={handleBaseSubmit} style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                    <input autoFocus value={baseInput} onChange={e => setBaseInput(e.target.value)} placeholder="Answer" style={{ padding: 12, borderRadius: 8, border: '1px solid var(--accent-primary)', background: 'var(--bg-panel-solid)', color: 'var(--text-main)', fontSize: 18, width: 150, textAlign: 'center', outline: 'none' }} />
                    <button type="submit" style={{ background: 'var(--accent-primary)', color: '#000', border: 'none', padding: '0 20px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>Enter</button>
                  </form>
                  <p style={{ marginTop: 20, color: '#4ade80', fontWeight: 'bold' }}>Streak: {baseScore} 🔥</p>
                </div>
              </div>
            )}

            {logicalMode === 'bigo' && (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <h2 style={{ color: 'var(--text-main)', margin: '0 0 10px' }}>Big-O Complexity Guesser</h2>
                <p style={{ color: 'var(--text-muted)', marginBottom: 30 }}>Estimate the time complexity of the following snippet.</p>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <pre style={{ background: 'var(--bg-panel-solid)', border: '1px solid var(--border-color)', padding: 20, borderRadius: 12, textAlign: 'left', minWidth: 300, color: 'var(--text-main)', fontSize: 16 }}>
                    {BIG_O_SNIPPETS[bigOIndex].code}
                  </pre>
                  
                  {bigOFeedback ? (
                     <div style={{ height: 120, display: 'flex', alignItems: 'center', fontSize: 24, color: bigOFeedback.includes('Correct') ? '#4ade80' : '#f87171' }}>
                       {bigOFeedback}
                     </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 12, marginTop: 30, minHeight: 120, width: '100%', maxWidth: 500 }}>
                      {BIG_O_OPTIONS.map(opt => (
                        <button key={opt} onClick={() => handleBigOGuess(opt)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', padding: '15px 20px', borderRadius: 8, color: 'var(--text-main)', cursor: 'pointer', fontSize: 18, fontWeight: 'bold' }}>
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                  <p style={{ marginTop: 20, color: '#4ade80', fontWeight: 'bold' }}>Score: {bigOScore}</p>
                </div>
              </div>
            )}

            {logicalMode === 'sliding' && (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                 <h2 style={{ color: 'var(--text-main)', margin: '0 0 10px' }}>System Interrupt: 15-Puzzle</h2>
                 <p style={{ color: 'var(--text-muted)', marginBottom: 30 }}>A classic grid logic puzzle. Rearrange tiles in numerical order.</p>
                 <div style={{ background: 'var(--bg-panel-solid)', padding: 20, borderRadius: 16, border: '1px solid var(--border-color)', display: 'inline-block' }}>
                   <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 70px)', gap: 8 }}>
                     {puzzleGrid.map((num, i) => (
                       <button 
                         key={i} 
                         onClick={() => handlePuzzleClick(i)}
                         style={{ 
                           width: 70, height: 70, fontSize: 24, fontWeight: 'bold', 
                           background: num === 0 ? 'transparent' : 'linear-gradient(135deg, #38bdf8, #818cf8)',
                           color: '#000', border: 'none', borderRadius: 8, cursor: num === 0 ? 'default' : 'pointer'
                         }}
                       >
                         {num !== 0 ? num : ''}
                       </button>
                     ))}
                   </div>
                 </div>
                 <div style={{ marginTop: 20 }}>
                   <span style={{ color: 'var(--text-muted)', marginRight: 20 }}>Moves: <strong style={{ color: 'var(--text-main)' }}>{puzzleMoves}</strong></span>
                   <button onClick={initPuzzle} style={{ background: 'transparent', color: '#f87171', border: '1px solid rgba(248,113,113,0.4)', padding: '5px 15px', borderRadius: 8, cursor: 'pointer' }}>Reset</button>
                 </div>
              </div>
            )}

          </div>
        )}

        {/* CODING PROBLEMS SECTION */}
        {activeTab === 'coding' && (
          <>
            {/* Dynamic QOTD Display */}
            {dailyChallenges.length > 0 && (
              <div style={{ marginBottom: 40 }}>
                <h2 style={{ color: 'var(--accent-primary)', margin: '0 0 16px', fontSize: 20, fontWeight: 800 }}>⚡ Dynamic Questions of the Day</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
                  {dailyChallenges.map((q) => (
                    <div key={q.id} onClick={() => window.location.href = `/practice/${q.id}`} style={{ background: 'var(--bg-panel)', padding: 24, borderRadius: 16, border: '1px solid var(--border-color)', cursor: 'pointer', transition: '0.2s' }} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-color)'}>
                      <div style={{ color: q.dColor, fontSize: 12, fontWeight: 800, textTransform: 'uppercase', marginBottom: 8 }}>{q.dayLabel}</div>
                      <h3 style={{ margin: '0 0 12px', color: 'var(--text-main)', fontSize: 18 }}>{q.title}</h3>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {q.tags?.slice(0, 2).map((t: string) => <span key={t} style={{ background: 'var(--bg-panel-solid)', border: '1px solid var(--border-color)', padding: '4px 10px', borderRadius: 6, fontSize: 11, color: 'var(--text-muted)' }}>{t}</span>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              <input placeholder="Search 5000+ questions or topics..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ ...filterInput, flex: 1, minWidth: 250 }} />
              <select value={difficultyFilter} onChange={(e) => setDifficultyFilter(e.target.value)} style={filterInput}>
                <option value="All">All Difficulties</option>
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </select>
              <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} style={filterInput}>
                <option value="All">All Platforms</option>
                <option value="Codeforces">Codeforces</option>
                <option value="LeetCode">LeetCode</option>
                <option value="AtCoder">AtCoder</option>
                <option value="CodeChef">CodeChef</option>
              </select>
            </div>

            <div style={tableContainer}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 600 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: 14, background: 'var(--bg-panel-solid)' }}>
                      <th style={{ padding: '16px 20px', width: '5%' }}>Status</th>
                      <th style={{ padding: '16px 20px', width: '40%' }}>Title</th>
                      <th style={{ padding: '16px 20px', width: '15%' }}>Platform</th>
                      <th style={{ padding: '16px 20px', width: '15%' }}>Difficulty</th>
                      <th style={{ padding: '16px 20px', width: '25%' }}>Topics</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5}>
                          <ContextLoader context="practice" label="Loading the question bank…" />
                        </td>
                      </tr>
                    ) : filteredProblems.length === 0 ? (
                      <tr><td colSpan={5} style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>No problems match your filters in the database.</td></tr>
                    ) : (
                      filteredProblems.map((p, idx) => {
                        const hasDescription = p.descriptionHtml && p.descriptionHtml.replace(/<[^>]*>/g, '').trim().length > 15;
                        return (
                          <motion.tr 
                            key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(idx * 0.02, 0.5) }}
                            style={{ borderBottom: '1px solid var(--border-color)', background: idx % 2 === 0 ? 'transparent' : 'var(--table-hover)', transition: 'background 0.2s', cursor: 'pointer' }}
                            onClick={() => window.location.href = `/practice/${p.id}`}
                            onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-card)'}
                            onMouseOut={(e) => e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'var(--table-hover)'}
                          >
                            <td style={{ padding: '16px 20px', verticalAlign: 'top' }}><div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--border-color)', marginTop: 4 }} /></td>
                            <td style={{ padding: '16px 20px', verticalAlign: 'top' }}>
                              <div style={{ fontWeight: 'bold', color: 'var(--text-main)', marginBottom: 8 }}>{p.title}</div>
                              <div style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
                                {hasDescription ? (
                                  <div dangerouslySetInnerHTML={{ __html: p.descriptionHtml.substring(0, 120) + '...' }} />
                                ) : (
                                  <div style={{ background: 'rgba(239,68,68,0.06)', padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)', fontSize: 13, color: '#f87171', display: 'inline-block' }}>
                                    <span>Problem text hidden. </span>
                                    {p.originalUrl && (
                                      <a href={p.originalUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--accent-primary)', fontWeight: 'bold', marginLeft: 6, textDecoration: 'underline' }}>
                                        Open External Platform ↗
                                      </a>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: '16px 20px', color: 'var(--text-muted)', verticalAlign: 'top' }}>{p.platform || 'DivineCode'}</td>
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
            </div>
          </>
        )}
      </section>

      {/* FLOATING AI CHATBOT — draggable & resizable */}
      <div style={floatingAiWrapper}>
        <AnimatePresence>
          {isChatOpen && (
            <FloatingWindow
              title={<><div style={avatarImg}>🤖</div><strong style={{ color: 'var(--text-main)' }}>Divine AI Guide</strong></>}
              onClose={() => setIsChatOpen(false)}
              defaultWidth={360}
              defaultHeight={500}
            >
              <div style={chatBody}>
                {chatMessages.map((msg, i) => (
                   <div key={i} style={{ ...chatBubble, alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', background: msg.role === 'user' ? 'var(--accent-primary)' : 'var(--bg-card)', color: msg.role === 'user' ? '#000' : 'var(--text-main)' }}>
                     {msg.text}
                     {msg.image && <img src={msg.image} alt="Uploaded" style={{ width: '100%', borderRadius: 8, marginTop: 10 }} />}
                   </div>
                ))}
                
                {chatMessages.length === 1 && !isAiTyping && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                    <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>Suggested Prompts:</p>
                    {SUGGESTED_QUESTIONS.map((q, i) => (
                      <button 
                        key={i} 
                        onClick={() => sendToAI(q)} 
                        style={{ background: 'var(--accent-glow)', color: 'var(--accent-primary)', border: '1px solid var(--accent-glow)', borderRadius: 8, padding: '8px 12px', textAlign: 'left', cursor: 'pointer', fontSize: 13, transition: '0.2s' }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}

                {isAiTyping && <div style={{ alignSelf: 'flex-start', background: 'var(--bg-card)', color: 'var(--text-muted)', padding: '10px 14px', borderRadius: 12, fontSize: 14, border: '1px solid var(--border-color)' }}>Thinking...</div>}
                <div ref={chatEndRef} />
              </div>
              <div style={chatFooter}>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 16 }}>
                  📷<input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
                </label>
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} placeholder="Ask me anything..." style={chatInputStyle} />
                <button onClick={handleSendMessage} style={sendBtn}>↑</button>
              </div>
            </FloatingWindow>
          )}
        </AnimatePresence>
        {!isChatOpen && <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setIsChatOpen(true)} style={floatingBtn}>🤖 AI Guide</motion.button>}
      </div>
    </main>
  );
}

// Styles
const page: CSSProperties = { minHeight: '100vh', padding: 'clamp(16px, 4vw, 30px) clamp(12px, 2vw, 20px)', fontFamily: 'Inter, Arial, sans-serif', color: 'var(--text-main)', background: 'var(--bg-main)', position: 'relative' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30, flexWrap: 'wrap', gap: 12 };
const brand: CSSProperties = { color: 'var(--text-main)', textDecoration: 'none', fontWeight: 900, fontSize: 'clamp(18px, 3vw, 22px)', display: 'flex', alignItems: 'center', gap: 12 };
const logoBadge: CSSProperties = { width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontSize: 16 };
const pill: CSSProperties = { color: 'var(--text-main)', textDecoration: 'none', padding: '10px 18px', borderRadius: 999, border: '1px solid var(--border-color)', background: 'var(--bg-panel)', fontWeight: 'bold' };
const hero: CSSProperties = { padding: 'clamp(20px, 4vw, 40px)', borderRadius: 24, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', marginBottom: 30, display: 'flex' };
const eyebrow: CSSProperties = { color: 'var(--accent-primary)', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 0 };

const activeTabStyle: CSSProperties = { background: 'transparent', color: 'var(--accent-primary)', border: 'none', borderBottom: '2px solid var(--accent-primary)', paddingBottom: 10, fontSize: 18, fontWeight: 'bold', cursor: 'pointer' };
const inactiveTabStyle: CSSProperties = { background: 'transparent', color: 'var(--text-muted)', border: 'none', borderBottom: '2px solid transparent', paddingBottom: 10, fontSize: 18, fontWeight: 'bold', cursor: 'pointer' };

const activePill: CSSProperties = { background: 'var(--accent-glow)', border: '1px solid var(--accent-primary)', color: 'var(--accent-primary)', padding: '8px 16px', borderRadius: 999, fontWeight: 'bold', cursor: 'pointer' };
const inactivePill: CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', padding: '8px 16px', borderRadius: 999, fontWeight: 'bold', cursor: 'pointer' };

const filterInput: CSSProperties = { padding: '12px 16px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-main)', outline: 'none' };
const tableContainer: CSSProperties = { background: 'var(--bg-panel)', borderRadius: 16, border: '1px solid var(--border-color)', overflow: 'hidden', paddingBottom: 50 };
const tagStyle: CSSProperties = { background: 'var(--accent-glow)', color: 'var(--accent-primary)', padding: '4px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: '1px solid var(--accent-glow)' };

const floatingAiWrapper: CSSProperties = { position: 'fixed', bottom: 30, right: 30, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' };
const floatingBtn: CSSProperties = { background: 'var(--accent-primary)', color: '#000', border: 'none', padding: '15px 25px', borderRadius: 999, fontSize: 16, fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 10px 25px var(--accent-glow)' };
const avatarImg: CSSProperties = { width: 30, height: 30, background: 'var(--bg-main)', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 18 };
const chatBody: CSSProperties = { flex: 1, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 };
const chatBubble: CSSProperties = { maxWidth: '85%', padding: '10px 14px', borderRadius: 12, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', border: '1px solid var(--border-color)' };
const chatFooter: CSSProperties = { padding: 12, background: 'var(--bg-panel)', borderTop: '1px solid var(--border-color)', display: 'flex', gap: 8, alignItems: 'center' };
const chatInputStyle: CSSProperties = { flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-main)', borderRadius: 8, padding: '8px 12px', outline: 'none' };
const sendBtn: CSSProperties = { background: 'var(--accent-primary)', color: '#000', border: 'none', width: 40, height: 36, borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' };