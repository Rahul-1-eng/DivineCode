import { useEffect, useState, useRef, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { io } from 'socket.io-client';
import { useTheme } from 'next-themes';
import NotificationBell from '../components/NotificationBell';
import { fetchApi } from '../lib/api';

const AnimatedBackground = dynamic(() => import('../components/AnimatedBackground'), { ssr: false });
const ActivityHeatmap = dynamic(() => import('../components/ActivityHeatmap'), { ssr: false });

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

const features = [
  { title: 'Verified Contests', href: '/contests', icon: '🏆', text: 'Codeforces-style gym rooms with live sync, cross-checks, and automatic Elo tracking.' },
  { title: 'Interview Tracks', href: '/interview', icon: '💼', text: 'Practice curated multi-format technical tracks with visual assessment metrics.' },
  { title: 'Create Mashups', href: '/contests/create', icon: '⚡', text: 'Instant problem pool lookup, handles aggregation, and cheat protection filters.' },
  { title: 'Duel Arena', href: '/duel', icon: '⚔️', text: 'Engage in real-time 1v1 speed debugging and MCQ battles on a live global clock.' },
  { title: 'AI Avatar Practice', href: '/practice', icon: '🤖', text: 'IDE environment equipped with interactive multi-tier hint engines and complexity analyzers.' },
  { title: 'Execution Judge', href: '/judge', icon: '⚙️', text: 'Sandboxed distributed multi-language compiler with native Codeforces platform telemetry.' }
];

const SUGGESTED_QUESTIONS = [
  "How do I create a Codeforces mashup contest?",
  "How do the Elo ratings and Coins work here?",
  "How do I use the live team voice chat?"
];

const DAILY_QUOTES = [
  "Every top-tier coder was once a beginner who just refused to quit. Put in the reps today.",
  "Stop staring at the editorial. Start writing code. The best way to learn is to break things and fix them.",
  "A failed testcase isn't a defeat—it's just an edge case you haven't conquered yet.",
  "Consistency beats intensity. Solve one problem today, and you're already ahead of who you were yesterday.",
  "The hardest bug you fix today becomes the intuition you use tomorrow. Keep pushing.",
  "Make it work, make it right, make it fast. Don't worry about elegant code on your first try.",
  "It's not about how fast you type. It's about how deeply you understand the problem before you touch the keyboard."
];

const transformSubmissionsToHeatmap = (submissions: any[]): any[] => {
  if (!submissions || submissions.length === 0) {
    return [];
  }

  const submissionsByDate: { [date: string]: number } = {};

  submissions.forEach((submission: any) => {
    if (submission.createdAt) {
      const dateStr = new Date(submission.createdAt).toISOString().split('T')[0];
      submissionsByDate[dateStr] = (submissionsByDate[dateStr] || 0) + 1;
    }
  });

  const heatmapData = Object.entries(submissionsByDate).map(([date, count]) => ({
    date,
    count,
    level: count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 5 ? 3 : 4
  }));

  return heatmapData;
};

export default function Home() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  
  const { data: session, status } = useSession();
  const [profile, setProfile] = useState<any>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [heatmapData, setHeatmapData] = useState<any[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [topUsers, setTopUsers] = useState<any[]>([]);
  const router = useRouter();

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [aiRetryCount, setAiRetryCount] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const [chatHistory, setChatHistory] = useState<{role: string, text: string, image?: string}[]>([
    { role: 'ai', text: 'Welcome to DivineCode Pro. I am configured to handle algorithmic breakdowns, testcase overrides, and platform navigation. How can I assist you today?' }
  ]);

  const [liveEvents, setLiveEvents] = useState<string[]>([
    "⚡ System: Fetching global contest schedules..."
  ]);

  const navLinks = [
    ['Practice Hub', '/practice'], 
    ['Duel Arena', '/duel'], 
    ['Contests', '/contests'], 
    ['Community', '/community'], 
    ['Create Room', '/contests/create']
  ];

  const quoteOfTheDay = useMemo(() => {
    const dayOfYear = Math.floor(Date.now() / 86400000);
    return DAILY_QUOTES[dayOfYear % DAILY_QUOTES.length];
  }, []);

  useEffect(() => {
    setMounted(true);
    fetch(`${API_BASE_URL}/api/v2/proxy/live-contests`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.contests && data.contests.length > 0) {
          const formattedContests = data.contests.map((c: any) => {
            const date = new Date(c.startTimeSeconds * 1000).toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            return `🚀 Upcoming Codeforces: ${c.name} — Scheduled for ${date}`;
          });
          setLiveEvents(formattedContests);
        } else {
          setLiveEvents(["🌐 System: Live contest sync temporarily unavailable. Check back later."]);
        }
      })
      .catch((err) => {
        console.error('❌ Live contests fetch error:', err);
        setLiveEvents(["🌐 System: Operating in standalone mode."]);
      });

    const socket = io(API_BASE_URL, { transports: ['websocket'] });
    socket.on('global_ticker', (newEvent: string) => {
      setLiveEvents(prev => [newEvent, ...prev].slice(0, 10));
    });
    return () => { socket.disconnect(); };
  }, []);

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.email) {
      fetchApi('/api/v2/leaderboard/global', { requireAuth: false })
        .then(data => { 
          if (Array.isArray(data)) {
            setTopUsers(data.slice(0, 5));
          }
        })
        .catch(err => console.error('❌ Leaderboard fetch error:', err));

      setHeatmapLoading(true);
      
      fetchApi('/api/v2/profile/me')
        .then(data => {
          setProfile(data);
          setProfileError(null);
          const transformed = data.submissions ? transformSubmissionsToHeatmap(data.submissions) : [];
          setHeatmapData(transformed);
        })
        .catch(err => {
          console.error('❌ Profile fetch error:', err);
          setProfileError(err.message || 'Error');
          setProfile(null); 
        })
        .finally(() => {
          setHeatmapLoading(false);
        });
    }
  }, [session, status]);

  useEffect(() => { 
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); 
  }, [chatHistory, isAiTyping]);

  const sendToAI = async (text: string, imageBase64: string | null = null, retryCount = 0) => {
    const MAX_RETRIES = 2;
    
    const userMsg = { role: 'user', text: text + (imageBase64 ? '\n[Image Attached]' : ''), image: imageBase64 || undefined };
    setChatHistory(prev => [...prev, userMsg]);
    setIsAiTyping(true);
    setAiRetryCount(retryCount);
    
    const payloadHistory = chatHistory.slice(1).map(m => ({ 
      role: m.role === 'ai' ? 'model' : 'user', 
      text: m.text 
    }));

    try {
      const res = await fetch(`${API_BASE_URL}/api/v2/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: payloadHistory, image: imageBase64 }),
        signal: AbortSignal.timeout(30000) 
      });

      if (!res.ok) throw new Error(`API returned ${res.status}: ${res.statusText}`);

      const data = await res.json();
      
      if (data.error) throw new Error(data.error);

      if (data.reply) {
        setChatHistory(prev => [...prev, { role: 'ai', text: data.reply }]);
        setAiRetryCount(0);
      } else {
        throw new Error('No reply from AI');
      }
    } catch (err) {
      let errorMsg = '';
      const errorString = String(err);
      
      if (errorString.includes('429') || errorString.includes('rate')) {
        errorMsg = '⚠️ Google Gemini API rate limited (60 requests/min on free tier). Try again in a moment.';
        
        if (retryCount < MAX_RETRIES) {
          setTimeout(() => {
            sendToAI(text, imageBase64, retryCount + 1);
          }, 3000);
          errorMsg += ` Retrying... (${retryCount + 1}/${MAX_RETRIES})`;
        } else {
          errorMsg += ' 💡 Fix: Upgrade Gemini API to paid tier or ask admin to switch to Claude API.';
        }
      } else if (errorString.includes('timeout')) {
        errorMsg = '⏱️ Request timeout. Backend service may be slow. Try again.';
      } else if (errorString.includes('401') || errorString.includes('403')) {
        errorMsg = '🔐 API authentication failed. Check backend configuration (AI_API_KEY).';
      } else {
        errorMsg = `❌ AI Service Error: ${errorString.substring(0, 100)}. Try again later.`;
      }
      
      setChatHistory(prev => [...prev, { role: 'ai', text: errorMsg }]);
    } finally { 
      setIsAiTyping(false); 
    }
  };

  const handleSendSupportMessage = () => {
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
       sendToAI(chatInput || "Please analyze this uploaded image.", base64);
       setChatInput('');
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <AnimatedBackground />

      <style>{`
        .glass-panel {
          background: var(--bg-panel) !important;
          backdrop-filter: blur(16px) saturate(180%) !important;
          -webkit-backdrop-filter: blur(16px) saturate(180%) !important;
          border: 1px solid var(--border-color) !important;
        }
        .hero-glow { text-shadow: 0 0 40px var(--accent-glow); }
        .footer-link:hover { color: var(--accent-primary) !important; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } } 
        .skeleton-pulse { animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
        
        @keyframes ticker-scroll { 0% { transform: translateX(100%); } 100% { transform: translateX(-100%); } }
        .live-ticker { display: flex; white-space: nowrap; animation: ticker-scroll 35s linear infinite; }
        .live-ticker:hover { animation-play-state: paused; }

        @media (max-width: 768px) {
          .nav-items { gap: 8px !important; }
          .nav-link { display: none; }
          .nav-link:nth-child(-n+2) { display: inline-block; }
          .hero-container { flex-direction: column !important; gap: 24px !important; }
          .hero-left { width: 100% !important; }
          .hero-right { width: 100% !important; }
          .button-group { flex-direction: column !important; width: 100% !important; }
          .button-group a { width: 100% !important; text-align: center !important; }
        }

        @media (max-width: 480px) {
          main { padding: 16px 12px !important; }
          .nav-link { padding: 6px 8px !important; font-size: 11px !important; }
          .button-group a { padding: 10px 16px !important; font-size: 13px !important; }
          .feature-card { padding: 20px !important; }
        }
      `}</style>

      <motion.main initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} style={{ minHeight: '100vh', padding: 'clamp(16px, 4vw, 32px)', fontFamily: 'Inter, Arial, sans-serif', color: 'var(--text-main)', background: 'transparent', position: 'relative', zIndex: 1 }}>
        
        <motion.nav initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} style={{ maxWidth: 1200, margin: '0 auto 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-main)', textDecoration: 'none', fontWeight: 900, fontSize: 'clamp(14px, 4vw, 24px)', letterSpacing: '-0.03em', flexShrink: 0 }}>
            <span style={{ width: 'clamp(32px, 8vw, 46px)', height: 'clamp(32px, 8vw, 44px)', borderRadius: 'clamp(6px, 2vw, 14px)', display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#6366f1,#22d3ee)', color: '#000', fontWeight: 'bold', boxShadow: '0 0 30px var(--accent-glow)', fontSize: 'clamp(10px, 2vw, 12px)' }}>DC</span>
            <span>DivineCode</span>
          </a>
          
          <div className="nav-items" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
            {navLinks.map(([item, href]) => (
              <a key={item} href={href} className="nav-link" style={{ color: 'var(--text-muted)', textDecoration: 'none', padding: '8px 14px', borderRadius: 999, transition: '0.2s', fontSize: 'clamp(11px, 2vw, 14px)', fontWeight: 500, background: 'var(--button-ghost-bg)', border: '1px solid var(--button-ghost-border)' }} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--button-ghost-border)'}>{item}</a>
            ))}

            <NotificationBell />

            {/* LIGHT/DARK THEME TOGGLE ADDED HERE */}
            {mounted && (
              <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} style={{ background: 'var(--button-ghost-bg)', border: '1px solid var(--button-ghost-border)', borderRadius: '50%', width: 36, height: 36, cursor: 'pointer', display: 'grid', placeItems: 'center', fontSize: 16 }}>
                {theme === 'dark' ? '☀️' : '🌙'}
              </button>
            )}

            {status === 'loading' ? (
              <div className="skeleton-pulse" style={{ width: 120, height: 36, borderRadius: 999, background: 'var(--button-ghost-bg)' }} />
            ) : session ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                {profile ? (
                  <>
                    <span style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(251,191,36,.1)', color: '#fbbf24', fontWeight: 700, fontSize: 'clamp(10px, 2vw, 12px)', border: '1px solid rgba(251,191,36,0.2)' }}>🏆 {profile.rating || 1200}</span>
                    <span style={{ padding: '6px 12px', borderRadius: 999, background: 'var(--accent-glow)', color: 'var(--accent-primary)', fontWeight: 700, fontSize: 'clamp(10px, 2vw, 12px)', border: '1px solid var(--accent-glow)' }}>🪙 {profile.coins || 0}</span>
                  </>
                ) : profileError ? (
                  <span style={{ fontSize: '11px', color: '#ef4444', padding: '6px 12px' }}>⚠️ {profileError}</span>
                ) : (
                  <div className="skeleton-pulse" style={{ width: 100, height: 32, borderRadius: 999, background: 'var(--button-ghost-bg)' }} />
                )}
                <a href="/profile" style={{ color: '#000', textDecoration: 'none', padding: '8px 16px', borderRadius: 999, fontWeight: 800, fontSize: 'clamp(11px, 2vw, 13px)', background: 'linear-gradient(135deg,#818cf8,#22d3ee)' }}>{profile?.username || session.user?.name?.split(' ')[0] || 'Dashboard'}</a>
              </div>
            ) : (
              <a href="/signin" style={{ color: '#000', padding: '8px 16px', borderRadius: 999, fontWeight: 800, fontSize: 'clamp(11px, 2vw, 13px)', background: 'var(--text-main)', textDecoration: 'none' }}>Authenticate</a>
            )}
          </div>
        </motion.nav>

        <div style={{ maxWidth: 1200, margin: '0 auto 24px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
          <div style={{ padding: 'clamp(8px, 2vw, 10px) clamp(12px, 3vw, 16px)', background: 'var(--bg-panel-solid)', fontWeight: 'bold', color: 'var(--accent-primary)', fontSize: 'clamp(11px, 2vw, 13px)', zIndex: 2, borderRight: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <motion.div animate={{ opacity: [1, 0.4, 1] }} transition={{ repeat: Infinity, duration: 1.5 }} style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 10px #ef4444' }} />
            LIVE
          </div>
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            <div className="live-ticker">
              {liveEvents.map((event, i) => (
                <span key={i} style={{ display: 'inline-block', padding: '10px 24px', color: 'var(--text-main)', fontSize: 'clamp(11px, 2vw, 13px)', fontWeight: 500 }}>
                  {event}
                </span>
              ))}
            </div>
          </div>
        </div>

        <motion.section initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }} style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div className="glass-panel" style={{ padding: 'clamp(20px, 5vw, 48px)', borderRadius: 32, boxShadow: '0 40px 120px rgba(0,0,0,0.1)' }}>
            
            <div className="hero-container" style={{ display: 'flex', gap: 'clamp(20px, 4vw, 40px)', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              
              <div className="hero-left" style={{ flex: '1 1 100%', minWidth: 0 }}>
                <p style={{ color: 'var(--accent-primary)', fontWeight: 800, letterSpacing: '.15em', textTransform: 'uppercase', fontSize: 'clamp(10px, 2.5vw, 12px)', marginBottom: 16 }}>The Developer Arena</p>
                <h1 className="hero-glow" style={{ fontSize: 'clamp(24px, 7vw, 64px)', lineHeight: 1, fontWeight: 900, letterSpacing: '-0.05em', margin: '0 0 20px', color: 'var(--text-main)' }}>Code. Sync.<br />Duel. Interview.</h1>
                
                <div style={{ background: 'var(--bg-card)', padding: 'clamp(14px, 3vw, 24px)', borderRadius: 16, borderLeft: '4px solid var(--accent-primary)', margin: '0 0 24px' }}>
                  <p style={{ color: 'var(--text-main)', fontSize: 'clamp(13px, 2.5vw, 16px)', lineHeight: 1.6, margin: 0, fontStyle: 'italic' }}>"{quoteOfTheDay}"</p>
                  <p style={{ color: 'var(--text-muted)', fontSize: 'clamp(10px, 2vw, 12px)', margin: '10px 0 0', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>— Daily Grind</p>
                </div>

                <div className="button-group" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <motion.a whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }} href="/contests/create" style={{ display: 'inline-block', color: '#000', textDecoration: 'none', padding: 'clamp(10px, 2vw, 14px) clamp(16px, 3vw, 28px)', borderRadius: 999, fontWeight: 800, background: 'linear-gradient(135deg,#818cf8,#22d3ee)', boxShadow: '0 10px 30px var(--accent-glow)', fontSize: 'clamp(12px, 2vw, 14px)' }}>Deploy Mashup Room</motion.a>
                  <motion.a whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }} href="/duel" style={{ display: 'inline-block', color: 'var(--text-main)', textDecoration: 'none', padding: 'clamp(10px, 2vw, 14px) clamp(16px, 3vw, 28px)', borderRadius: 999, fontWeight: 800, border: '1px solid var(--border-color)', background: 'var(--bg-card)', fontSize: 'clamp(12px, 2vw, 14px)' }}>Enter Duel Arena ⚔️</motion.a>
                </div>
              </div>

              <div className="hero-right" style={{ flex: '1 1 100%', width: '100%' }}>
                {session && profile ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <ActivityHeatmap data={heatmapData} loading={heatmapLoading} />
                    
                    <div style={{ background: 'var(--bg-panel)', borderRadius: 24, padding: 'clamp(16px, 3vw, 24px)', border: '1px solid var(--border-color)', position: 'relative', overflow: 'hidden', width: '100%' }}>
                      <h3 style={{ margin: '0 0 16px', color: 'var(--text-main)', fontSize: 'clamp(13px, 2vw, 16px)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: '#fbbf24' }}>★</span> Global Hall of Fame
                      </h3>
                      
                      {topUsers.length === 0 ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: 'clamp(12px, 2vw, 14px)' }}>Loading leaderboard...</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {topUsers.map((u, i) => {
                            const hasUsername = Boolean(u.username && !u.username.startsWith('user_'));

                            return (
                              <motion.div 
                                key={i} 
                                whileHover={{ scale: 1.02, backgroundColor: hasUsername ? 'var(--table-hover)' : 'transparent' }}
                                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-color)', cursor: hasUsername ? 'pointer' : 'default', transition: '0.2s' }}
                                onClick={() => {
                                  if (hasUsername) router.push(`/u/${u.username}`);
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                  <strong style={{ color: i === 0 ? '#fbbf24' : i === 1 ? 'var(--text-muted)' : i === 2 ? '#b45309' : 'var(--text-muted)', fontSize: 'clamp(11px, 2vw, 13px)' }}>#{i + 1}</strong>
                                  <span style={{ color: 'var(--text-main)', fontWeight: 600, fontSize: 'clamp(11px, 2vw, 13px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {hasUsername ? u.username : u.name}
                                  </span>
                                </div>
                                <span style={{ color: 'var(--accent-primary)', fontWeight: 800, fontSize: 'clamp(11px, 2vw, 13px)', flexShrink: 0 }}>{u.rating || 1200}</span>
                              </motion.div>
                            );
                          })}
                        </div>
                      )}
                      
                      <div style={{ marginTop: 16, textAlign: 'center' }}>
                        <a href="/leaderboard" style={{ color: 'var(--text-muted)', fontSize: 'clamp(11px, 2vw, 12px)', textDecoration: 'none', fontWeight: 'bold' }}>View Full Leaderboard →</a>
                      </div>
                    </div>
                  </div>
                ) : session ? (
                  <div style={{ background: 'var(--bg-panel)', borderRadius: 24, padding: 'clamp(20px, 4vw, 32px)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                    {profileError ? (
                      <p style={{ color: '#ef4444', fontSize: 'clamp(12px, 2vw, 14px)', margin: 0 }}>❌ Failed to load profile: {profileError}</p>
                    ) : (
                      <p style={{ color: 'var(--text-muted)', fontSize: 'clamp(12px, 2vw, 14px)', margin: 0 }}>⏳ Loading your profile data...</p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </motion.section>

        <motion.section initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} style={{ maxWidth: 1200, margin: '48px auto 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(clamp(250px, 100%, 360px), 1fr))', gap: 'clamp(16px, 2vw, 24px)' }}>
          {features.map((f) => (
            <div key={f.title} className="feature-card glass-panel" style={{ padding: 'clamp(16px, 4vw, 32px)', borderRadius: 24, cursor: 'pointer', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }} onClick={() => router.push(f.href)} onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.borderColor = 'var(--accent-primary)'; }} onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}>
              <div style={{ fontSize: 'clamp(24px, 5vw, 36px)', marginBottom: 16 }}>{f.icon}</div>
              <h3 style={{ margin: '0 0 8px', fontSize: 'clamp(14px, 2.5vw, 18px)', color: 'var(--text-main)', fontWeight: 700 }}>{f.title}</h3>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'clamp(12px, 2vw, 14px)', lineHeight: 1.5 }}>{f.text}</p>
            </div>
          ))}
        </motion.section>
      </motion.main>

      <div style={{ position: 'fixed', bottom: 'clamp(12px, 4vw, 30px)', right: 'clamp(12px, 4vw, 30px)', zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <AnimatePresence>
          {isChatOpen && (
            <motion.div initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.95 }} className="glass-panel" style={{ width: 'clamp(280px, 90vw, 350px)', height: 'clamp(300px, 80vh, 500px)', border: '1px solid var(--accent-primary)', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', marginBottom: 12 }}>
              <div style={{ background: 'var(--bg-panel-solid)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 28, height: 28, background: 'var(--bg-main)', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 16 }}>🤖</div>
                  <strong style={{ color: 'var(--text-main)', fontSize: 'clamp(12px, 2vw, 14px)' }}>Divine AI Guide</strong>
                </div>
                <button onClick={() => setIsChatOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', padding: 0 }}>×</button>
              </div>
              
              <div style={{ flex: 1, padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {chatHistory.map((msg, i) => (
                    <div key={i} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', background: msg.role === 'user' ? 'var(--accent-primary)' : 'var(--bg-card)', color: msg.role === 'user' ? '#000' : 'var(--text-main)', maxWidth: '85%', padding: '8px 12px', borderRadius: 10, fontSize: 'clamp(12px, 2vw, 13px)', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', border: '1px solid var(--border-color)' }}>
                      {msg.text}
                      {msg.image && <img src={msg.image} alt="Uploaded" style={{ width: '100%', borderRadius: 6, marginTop: 8, maxHeight: 200 }} />}
                    </div>
                ))}
                
                {chatHistory.length === 1 && !isAiTyping && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0, marginBottom: 4 }}>Quick prompts:</p>
                    {SUGGESTED_QUESTIONS.map((q, i) => (
                      <button 
                        key={i} 
                        onClick={() => sendToAI(q)} 
                        style={{ background: 'var(--accent-glow)', color: 'var(--accent-primary)', border: '1px solid var(--accent-glow)', borderRadius: 6, padding: '6px 10px', textAlign: 'left', cursor: 'pointer', fontSize: '11px', transition: '0.2s' }}
                      >
                        {q.substring(0, 30)}...
                      </button>
                    ))}
                  </div>
                )}

                {isAiTyping && <div style={{ alignSelf: 'flex-start', background: 'var(--bg-card)', color: 'var(--text-muted)', padding: '8px 12px', borderRadius: 10, fontSize: '12px', border: '1px solid var(--border-color)' }}>⏳ Thinking{aiRetryCount > 0 ? ` (retry ${aiRetryCount})` : ''}...</div>}
                <div ref={chatEndRef} />
              </div>
              
              <div style={{ padding: 10, background: 'var(--bg-panel-solid)', borderTop: '1px solid var(--border-color)', display: 'flex', gap: 6, alignItems: 'center' }}>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, background: 'var(--bg-card)', borderRadius: 6, border: '1px solid var(--border-color)', fontSize: 14 }}>
                  📷<input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
                </label>
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendSupportMessage()} placeholder="Ask..." style={{ flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-main)', borderRadius: 6, padding: '6px 10px', outline: 'none', fontSize: 'clamp(11px, 2vw, 12px)' }} />
                <button onClick={handleSendSupportMessage} style={{ background: 'var(--accent-primary)', color: '#000', border: 'none', width: 32, height: 32, borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 16 }}>↑</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        {!isChatOpen && (
           <motion.div animate={{ y: [0, -10, 0] }} transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }} style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
             <div className="glass-panel" style={{ padding: '8px 12px', borderRadius: '12px 12px 0 12px', color: 'var(--text-main)', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', fontSize: 'clamp(10px, 2vw, 12px)', border: '1px solid var(--accent-glow)', maxWidth: '120px' }}>
               Hi! Ask me anything!
             </div>
             <button onClick={() => setIsChatOpen(true)} style={{ width: 54, height: 54, borderRadius: '50%', background: 'linear-gradient(135deg, #38bdf8, #818cf8)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: 28, boxShadow: '0 10px 25px var(--accent-glow)', border: '2px solid var(--bg-panel-solid)', cursor: 'pointer', flexShrink: 0, padding: 0 }}>
               🤖
             </button>
           </motion.div>
        )}
      </div>

      <footer style={{ background: 'var(--bg-panel)', borderTop: '1px solid var(--border-color)', padding: 'clamp(24px, 5vw, 60px) clamp(12px, 3vw, 20px)', marginTop: '40px', backdropFilter: 'blur(10px)', position: 'relative', zIndex: 10 }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'clamp(24px, 4vw, 40px)' }}>
          <div>
            <h3 style={{ color: 'var(--text-main)', fontSize: 'clamp(14px, 2.5vw, 18px)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg, #a5b4fc, #22d3ee)', color: '#000', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 'bold' }}>DC</span> 
              DivineCode
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 'clamp(12px, 2vw, 13px)', lineHeight: 1.6 }}>The ultimate OS for competitive programmers.</p>
          </div>

          <div>
            <h4 style={{ color: 'var(--text-main)', marginBottom: 12, fontSize: 'clamp(12px, 2vw, 14px)' }}>Features</h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[['Mashup Arena', '/contests'], ['1v1 Duels', '/duel'], ['AI Workspace', '/practice'], ['Interview Prep', '/interview']].map(([label, href]) => (
                <li key={href}><a href={href} className="footer-link" style={{ color: 'var(--text-muted)', textDecoration: 'none', transition: '0.2s', fontSize: 'clamp(11px, 2vw, 12px)' }}>{label}</a></li>
              ))}
            </ul>
          </div>

          <div>
            <h4 style={{ color: 'var(--text-main)', marginBottom: 12, fontSize: 'clamp(12px, 2vw, 14px)' }}>Resources</h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[['Documentation', '#'], ['API Reference', '#'], ['System Status', '#']].map(([label, href]) => (
                <li key={href}><a href={href} className="footer-link" style={{ color: 'var(--text-muted)', textDecoration: 'none', transition: '0.2s', fontSize: 'clamp(11px, 2vw, 12px)' }}>{label}</a></li>
              ))}
            </ul>
          </div>
        </div>
        <div style={{ maxWidth: 1180, margin: '24px auto 0', paddingTop: 16, borderTop: '1px solid var(--border-color)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'clamp(10px, 2vw, 12px)' }}>
          &copy; {new Date().getFullYear()} DivineCode. All rights reserved.
        </div>
      </footer>
    </>
  );
}