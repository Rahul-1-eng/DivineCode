import { useEffect, useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';

// Dynamically import the 3D background so it doesn't break Server-Side Rendering
const AnimatedBackground = dynamic(() => import('../components/AnimatedBackground'), { ssr: false });

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

export default function Home() {
  const { data: session, status } = useSession();
  const [profile, setProfile] = useState<any>(null);
  const router = useRouter();

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const [chatHistory, setChatHistory] = useState<{role: string, text: string, image?: string}[]>([
    { role: 'ai', text: 'Welcome to DivineCode Pro. I am configured to handle algorithmic breakdowns, testcase overrides, and platform navigation. How can I assist you today?' }
  ]);

  const navLinks = [
    ['Practice Hub', '/practice'], 
    ['Duel Arena', '/duel'], 
    ['Contests', '/contests'], 
    ['Leaderboard', '/leaderboard'], 
    ['Create Room', '/contests/create']
  ];

  useEffect(() => {
    if (session?.user?.email) {
      fetch(`${API_BASE_URL}/api/v2/profile/me`, { headers: { 'x-user-email': session.user.email } })
      .then(r => r.json())
      .then(data => { if (!data.error) setProfile(data); }).catch(() => null);
    }
  }, [session]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatHistory, isAiTyping]);

  const sendToAI = async (text: string, imageBase64: string | null = null) => {
    const userMsg = { role: 'user', text: text + (imageBase64 ? '\n[Image Attached]' : ''), image: imageBase64 || undefined };
    setChatHistory(prev => [...prev, userMsg]);
    setIsAiTyping(true);
    
    const systemPrompt = "System Framework instruction: You are the senior DivineCode AI Guide. Provide deep algorithmic insights, help users navigate the competitive programming platform, and handle complex logic blocks up to extreme competitive difficulties. Keep answers highly concise, friendly, and use markdown.";
    
    const payloadHistory = [
      { role: 'user', text: systemPrompt },
      { role: 'model', text: 'Understood. I will act as the guide.' },
      ...chatHistory.slice(1).map(m => ({ role: m.role === 'ai' ? 'model' : 'user', text: m.text }))
    ];

    try {
      const res = await fetch(`${API_BASE_URL}/api/v2/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: payloadHistory, image: imageBase64 })
      });
      const data = await res.json();
      setChatHistory(prev => [...prev, { role: 'ai', text: data.reply }]);
    } catch (err) {
      setChatHistory(prev => [...prev, { role: 'ai', text: 'Neural network timeout. Verify server deployment state.' }]);
    } finally { setIsAiTyping(false); }
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
      {/* 3D Animated Data Vortex Background */}
      <AnimatedBackground />

      <style>{`
        .glass-panel {
          background: rgba(8, 13, 32, 0.65) !important;
          backdrop-filter: blur(16px) saturate(180%) !important;
          -webkit-backdrop-filter: blur(16px) saturate(180%) !important;
          border: 1px solid rgba(255, 255, 255, 0.07) !important;
        }
        .hero-glow {
          text-shadow: 0 0 40px rgba(34, 211, 238, 0.3), 0 0 80px rgba(129, 140, 248, 0.2);
        }
        .footer-link:hover { color: #38bdf8 !important; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } } 
        .skeleton-pulse { animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
      `}</style>

      {/* Main layout wrapper, sitting above the absolute background */}
      <motion.main initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} style={{ minHeight: '100vh', padding: '32px 24px', fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'transparent', position: 'relative', zIndex: 1 }}>
        
        <motion.nav initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} style={{ maxWidth: 1200, margin: '0 auto 56px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 14, color: '#fff', textDecoration: 'none', fontWeight: 900, fontSize: 26, letterSpacing: '-0.03em' }}>
            <span style={{ width: 46, height: 44, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#6366f1,#22d3ee)', color: '#000', fontWeight: 'bold', boxShadow: '0 0 30px rgba(34,211,238,0.4)' }}>DC</span>
            DivineCode
          </a>
          
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {navLinks.map(([item, href]) => (
              <a key={item} href={href} style={{ color: '#cbd5e1', textDecoration: 'none', padding: '10px 18px', borderRadius: 999, transition: '0.2s', fontSize: 14, fontWeight: 500, background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(255,255,255,0.05)' }} onMouseEnter={e => e.currentTarget.style.borderColor = '#22d3ee'} onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}>{item}</a>
            ))}

            {status === 'loading' ? <div className="skeleton-pulse" style={{ width: 140, height: 38, borderRadius: 999, background: 'rgba(255,255,255,0.05)' }} /> : session ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 10 }}>
                {profile ? (
                  <><span style={{ padding: '8px 14px', borderRadius: 999, background: 'rgba(251,191,36,.1)', color: '#fbbf24', fontWeight: 700, fontSize: 13, border: '1px solid rgba(251,191,36,0.2)' }}>🏆 {profile.rating || 1200}</span><span style={{ padding: '8px 14px', borderRadius: 999, background: 'rgba(34,211,238,.1)', color: '#22d3ee', fontWeight: 700, fontSize: 13, border: '1px solid rgba(34,211,238,0.2)' }}>🪙 {profile.coins || 0}</span></>
                ) : <div className="skeleton-pulse" style={{ width: 120, height: 36, borderRadius: 999, background: 'rgba(255,255,255,0.05)' }} />}
                <a href="/profile" style={{ color: '#020617', textDecoration: 'none', padding: '10px 20px', borderRadius: 999, fontWeight: 800, fontSize: 14, background: 'linear-gradient(135deg,#818cf8,#22d3ee)' }}>{profile?.username || session.user?.name?.split(' ')[0] || 'Dashboard'}</a>
              </div>
            ) : <a href="/signin" style={{ color: '#020617', padding: '10px 22px', borderRadius: 999, fontWeight: 800, background: '#fff', textDecoration: 'none' }}>Authenticate</a>}
          </div>
        </motion.nav>

        <motion.section initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }} style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 32, alignItems: 'center' }}>
          <div className="glass-panel" style={{ padding: 48, borderRadius: 32, boxShadow: '0 40px 120px rgba(0,0,0,0.5)' }}>
            <p style={{ color: '#22d3ee', fontWeight: 800, letterSpacing: '.15em', textTransform: 'uppercase', fontSize: 12, marginBottom: 16 }}>Verified Execution Architecture</p>
            <h1 className="hero-glow" style={{ fontSize: 'clamp(44px,5vw,82px)', lineHeight: 0.95, fontWeight: 900, letterSpacing: '-0.05em', margin: '0 0 24px', color: '#fff' }}>Code. Sync.<br />Duel. Interview.</h1>
            <p style={{ color: '#94a3b8', fontSize: 18, lineHeight: 1.7, margin: '0 0 36px', maxWidth: 640 }}>
              The high-performance workspace designed specifically for elite competitive coders. 
              Deploy native group rooms, optimize complex logic streams with deep AI diagnostics, and participate in verified real-time ladders.
            </p>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <motion.a whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }} href="/contests/create" style={{ display: 'inline-block', color: '#020617', textDecoration: 'none', padding: '14px 28px', borderRadius: 999, fontWeight: 800, background: 'linear-gradient(135deg,#818cf8,#22d3ee)', boxShadow: '0 10px 30px rgba(34,211,238,0.3)' }}>Deploy Mashup Room</motion.a>
              <motion.a whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }} href="/practice" style={{ display: 'inline-block', color: '#fff', textDecoration: 'none', padding: '14px 28px', borderRadius: 999, fontWeight: 800, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.03)' }}>Open AI Core Workspace</motion.a>
            </div>
          </div>
          
          <div className="glass-panel" style={{ padding: 32, borderRadius: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ margin: '0 0 12px', color: '#fff', fontSize: 18, fontWeight: 800 }}>System Verification Status</h3>
            {['Codeforces API Engine (Bypass Enabled)', 'Distributed Judge0 Parallel Architecture', 'Multi-Tier Neural Error Analyzer', 'Live Standings WebGL Data Stream'].map((statusText) => (
              <div key={statusText} style={{ padding: '14px 18px', borderRadius: 16, background: 'rgba(2,6,23,0.4)', border: '1px solid rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', gap: 12, color: '#e2e8f0', fontSize: 14 }}>
                <span style={{ color: '#22d3ee' }}>⚡</span> {statusText}
              </div>
            ))}
          </div>
        </motion.section>

        <motion.section initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} style={{ maxWidth: 1200, margin: '48px auto 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 20 }}>
          {features.map((f) => (
            <div key={f.title} className="glass-panel" style={{ padding: 32, borderRadius: 24, cursor: 'pointer', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }} onClick={() => router.push(f.href)} onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.borderColor = '#22d3ee'; }} onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; }}>
              <div style={{ fontSize: 36, marginBottom: 16 }}>{f.icon}</div>
              <h3 style={{ margin: '0 0 8px', fontSize: 20, color: '#fff', fontWeight: 700 }}>{f.title}</h3>
              <p style={{ margin: 0, color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>{f.text}</p>
            </div>
          ))}
        </motion.section>

        <div style={{ position: 'fixed', bottom: 30, right: 30, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <AnimatePresence>
            {isChatOpen && (
              <motion.div initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.95 }} className="glass-panel" style={{ width: 350, height: 480, border: '1px solid rgba(56,189,248,0.5)', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', marginBottom: 15 }}>
                <div style={{ background: 'rgba(30,41,59,0.5)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 30, height: 30, background: '#020617', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 18 }}>🤖</div>
                    <strong style={{ color: '#fff' }}>Divine AI Guide</strong>
                  </div>
                  <button onClick={() => setIsChatOpen(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 24, cursor: 'pointer' }}>×</button>
                </div>
                
                <div style={{ flex: 1, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {chatHistory.map((msg, i) => (
                      <div key={i} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', background: msg.role === 'user' ? '#38bdf8' : 'rgba(30,41,59,0.7)', color: msg.role === 'user' ? '#000' : '#e2e8f0', maxWidth: '85%', padding: '10px 14px', borderRadius: 12, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', border: '1px solid rgba(255,255,255,0.05)' }}>
                        {msg.text}
                        {msg.image && <img src={msg.image} alt="Uploaded" style={{ width: '100%', borderRadius: 8, marginTop: 10 }} />}
                      </div>
                  ))}
                  
                  {chatHistory.length === 1 && !isAiTyping && (
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

                  {isAiTyping && <div style={{ alignSelf: 'flex-start', background: 'rgba(30,41,59,0.7)', color: '#94a3b8', padding: '10px 14px', borderRadius: 12, fontSize: 14, border: '1px solid rgba(255,255,255,0.05)' }}>Thinking...</div>}
                  <div ref={chatEndRef} />
                </div>
                
                <div style={{ padding: 12, background: 'rgba(30,41,59,0.5)', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, background: 'rgba(2,6,23,0.5)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', fontSize: 16 }}>
                    📷<input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
                  </label>
                  <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendSupportMessage()} placeholder="Ask me anything..." style={{ flex: 1, background: 'rgba(2,6,23,0.5)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, padding: '8px 12px', outline: 'none' }} />
                  <button onClick={handleSendSupportMessage} style={{ background: '#38bdf8', color: '#000', border: 'none', width: 40, height: 36, borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' }}>↑</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          
          {!isChatOpen && (
             <motion.div animate={{ y: [0, -10, 0] }} transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }} style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
               <div className="glass-panel" style={{ padding: '10px 15px', borderRadius: '16px 16px 0 16px', color: '#e2e8f0', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', fontSize: 13, border: '1px solid rgba(56,189,248,0.3)' }}>
                 Hi! I'm the AI Guide. Ask me anything or upload an image!
               </div>
               <button onClick={() => setIsChatOpen(true)} style={{ width: 60, height: 60, borderRadius: '50%', background: 'linear-gradient(135deg, #38bdf8, #818cf8)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: 32, boxShadow: '0 10px 25px rgba(56,189,248,0.4)', border: '2px solid rgba(15,23,42,0.8)', cursor: 'pointer' }}>
                 🤖
               </button>
             </motion.div>
          )}
        </div>
      </motion.main>

      <footer style={{ background: 'rgba(2, 6, 23, 0.8)', borderTop: '1px solid rgba(255, 255, 255, 0.05)', padding: '60px 20px', marginTop: '40px', backdropFilter: 'blur(10px)', position: 'relative', zIndex: 10 }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 40 }}>
          
          <div>
            <h3 style={{ color: '#fff', fontSize: 20, marginBottom: 15, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg, #a5b4fc, #22d3ee)', color: '#000', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 'bold' }}>DC</span> 
              DivineCode
            </h3>
            <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6 }}>The ultimate operating system for competitive programmers. Code, duel, and practice with intelligent AI guidance.</p>
          </div>

          <div>
            <h4 style={{ color: '#e2e8f0', marginBottom: 20 }}>Features</h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <li><a href="/contests" className="footer-link" style={{ color: '#94a3b8', textDecoration: 'none', transition: '0.2s' }}>Mashup Arena</a></li>
              <li><a href="/duel" className="footer-link" style={{ color: '#94a3b8', textDecoration: 'none', transition: '0.2s' }}>1v1 Duels</a></li>
              <li><a href="/practice" className="footer-link" style={{ color: '#94a3b8', textDecoration: 'none', transition: '0.2s' }}>AI Workspace</a></li>
              <li><a href="/interview" className="footer-link" style={{ color: '#94a3b8', textDecoration: 'none', transition: '0.2s' }}>Interview Prep</a></li>
            </ul>
          </div>

          <div>
            <h4 style={{ color: '#e2e8f0', marginBottom: 20 }}>Resources</h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <li><a href="#" className="footer-link" style={{ color: '#94a3b8', textDecoration: 'none', transition: '0.2s' }}>Documentation</a></li>
              <li><a href="#" className="footer-link" style={{ color: '#94a3b8', textDecoration: 'none', transition: '0.2s' }}>API Reference</a></li>
              <li><a href="#" className="footer-link" style={{ color: '#94a3b8', textDecoration: 'none', transition: '0.2s' }}>System Status</a></li>
            </ul>
          </div>

        </div>
        <div style={{ maxWidth: 1180, margin: '40px auto 0', paddingTop: 20, borderTop: '1px solid rgba(255, 255, 255, 0.05)', textAlign: 'center', color: '#64748b', fontSize: 14 }}>
          &copy; {new Date().getFullYear()} DivineCode. All rights reserved.
        </div>
      </footer>
    </>
  );
}