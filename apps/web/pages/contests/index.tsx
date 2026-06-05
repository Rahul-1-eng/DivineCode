import { useEffect, useState, CSSProperties } from 'react';
import { useSession } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

export default function ContestsPage() {
  const { data: session } = useSession();
  const [contests, setContests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now()); 

  // 👉 FIX: Separated the ticker so it runs independently
  useEffect(() => {
    setMounted(true);
    const ticker = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, []);

  // 👉 FIX: Added session dependency so it fetches AFTER you are logged in
  useEffect(() => {
    loadContests();
  }, [session]); 

  async function loadContests() {
    try { 
      setLoading(true);
      setError('');
      // 👉 FIX: Injected the mandatory security header
      const res = await fetch(`${API_V2_BASE_URL}/contests`, {
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': session?.user?.email || ''
        }
      }); 
      if (!res.ok) throw new Error('Failed to fetch contests from server');
      const data = await res.json(); 
      setContests(Array.isArray(data) ? data : []); 
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Network error occurred');
    } finally { 
      setLoading(false); 
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm('Are you sure you want to delete this contest? This cannot be undone.')) return;

    try {
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': session?.user?.email || '', 
        },
      });

      if (res.ok) {
        setContests((prev) => prev.filter((c) => c.id !== id));
      } else {
        const data = await res.json().catch(() => ({}));
        alert(`Error: ${data.error || 'You do not have permission to delete this contest'}`);
      }
    } catch (err) {
      alert('Network error while attempting to delete.');
    }
  }

  function formatCountdown(ms: number) {
    if (ms <= 0) return 'Starting...';
    const s = Math.floor((ms / 1000) % 60);
    const m = Math.floor((ms / 1000 / 60) % 60);
    const h = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const d = Math.floor(ms / (1000 * 60 * 60 * 24));
    
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0 || d > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  }

  if (!mounted) return null; 

  const userEmail = session?.user?.email;
  const userLabel = session?.user?.name || userEmail;
  const now = Date.now(); 

  const upcomingContests = contests
    .filter(c => new Date(c.startTime).getTime() > now)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
  const pastAndLiveContests = contests.filter(c => new Date(c.startTime).getTime() <= now);

  return (
    <main style={page}>
      <section style={{ maxWidth: 1180, margin: '0 auto', boxSizing: 'border-box' }}>
        
        <nav style={nav}>
          <a href="/" style={brand}>DivineCode</a>
          <div style={navLinks}>
            {userLabel ? <a href="/profile" style={pill}>{userLabel}</a> : <a href="/signin" style={pill}>Login</a>}
            <a href="/duel" style={pill}>Duel</a>
            <a href="/contests/create" style={primary}>Create Mashup</a>
          </div>
        </nav>
        
        <div style={hero}>
          <p style={eyebrow}>Gym dashboard</p>
          <h1 style={{ fontSize: 'clamp(32px, 6vw, 78px)', margin: '10px 0', letterSpacing: '-.05em', lineHeight: 1.1 }}>Contest rooms that feel alive.</h1>
          <p style={{ color: '#a8b3c7', maxWidth: 720, lineHeight: 1.6, fontSize: 'clamp(14px, 3vw, 16px)' }}>Create mashups, invite coders, submit from account, and track standings like a real competitive programming arena.</p>
        </div>

        {upcomingContests.length > 0 && (
          <div style={notificationBanner}>
            <h3 style={{ margin: '0 0 12px 0', color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 1.5, fontSize: 13 }}>Upcoming Contests</h3>
            <div style={{ display: 'grid', gap: 12 }}>
              {upcomingContests.map(contest => {
                const startTime = new Date(contest.startTime).getTime();
                const msRemaining = startTime - nowTick;
                
                return (
                  <a key={contest.id} href={`/contests/${contest.id}`} style={notificationRow}>
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <strong style={{ fontSize: 16, color: '#eef2ff' }}>📅 {contest.title}</strong>
                      <span style={{ fontSize: 13, color: '#94a3b8' }}>Starts at {new Date(contest.startTime).toLocaleString()}</span>
                    </div>
                    <div style={countdownPill}>
                      <span style={{ fontSize: 11, opacity: 0.8 }}>Before Start:</span>
                      <strong style={{ fontSize: 15, fontFamily: 'monospace' }}>{formatCountdown(msRemaining)}</strong>
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        )}
        
        {loading && <div style={panel}>Loading contests... (Please wait)</div>}
        {error && <div style={{...panel, borderColor: '#ef4444'}}><h2 style={{color: '#ef4444', margin: '0 0 10px 0'}}>Connection Error</h2><p style={{margin: 0}}>{error}</p></div>}
        
        {!loading && !error && contests.length === 0 && (
          <div style={panel}>
            <h2 style={{ margin: '0 0 10px 0' }}>No contests yet</h2>
            <p style={{ color: '#94a3b8', marginBottom: 20 }}>Create your first mashup room and add problems from Codeforces, LeetCode, AtCoder, or CodeChef.</p>
            <a href="/contests/create" style={primary}>Create Mashup</a>
          </div>
        )}

        <section style={grid}>
          {pastAndLiveContests.map((contest) => {
            const endTime = new Date(contest.startTime).getTime() + contest.durationMinutes * 60000;
            const isLive = now < endTime;
            const isOwner = userEmail && (contest.ownerEmail === userEmail || contest.createdById === (session?.user as any)?.id);

            return (
              <div key={contest.id} style={{ position: 'relative', display: 'flex', flex: '1 1 300px', maxWidth: '100%' }}>
                <a href={`/contests/${contest.id}`} style={{ ...card, flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                    <span style={isLive ? tagLive : tagCompleted}>{isLive ? 'LIVE GYM' : 'COMPLETED'}</span>
                    <span style={{ color: '#67e8f9', fontWeight: 'bold' }}>{contest.durationMinutes}m</span>
                  </div>
                  
                  <h2 style={{ margin: '0 0 10px 0', paddingRight: isOwner ? '70px' : '0', fontSize: '1.4rem' }}>{contest.title}</h2>
                  <p style={{ color: '#94a3b8', lineHeight: 1.5, margin: '0 0 16px 0', flex: 1 }}>{contest.description || 'Private group contest room'}</p>
                  
                  <div style={stats}>
                    <span>{contest.membersCount} members</span>
                    <span>{contest.problemsCount} problems</span>
                    <span>{contest.questionCount || 0} MCQs</span>
                  </div>
                </a>

                {isOwner && (
                  <button onClick={(e) => handleDelete(e, contest.id)} style={deleteBtn} title="Delete Contest">
                    Delete
                  </button>
                )}
              </div>
            );
          })}
        </section>
      </section>
    </main>
  );
}

// RESTORED CSS
const page: CSSProperties = { minHeight: '100vh', padding: '4vw', fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.32), transparent 34rem), radial-gradient(circle at bottom right, rgba(34,211,238,.18), transparent 30rem), #070a16', boxSizing: 'border-box' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 18, flexWrap: 'wrap', marginBottom: 'clamp(24px, 5vw, 42px)' };
const brand: CSSProperties = { color: '#eef2ff', textDecoration: 'none', fontWeight: 950, fontSize: 'clamp(20px, 4vw, 24px)' };
const navLinks: CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap' };
const pill: CSSProperties = { color: '#dbeafe', textDecoration: 'none', padding: '11px 16px', borderRadius: 999, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(15,23,42,.72)', fontSize: 14, textAlign: 'center' };
const primary: CSSProperties = { display: 'inline-block', color: '#020617', textDecoration: 'none', padding: '12px 17px', borderRadius: 999, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', fontWeight: 900, cursor: 'pointer', fontSize: 14, textAlign: 'center' };
const hero: CSSProperties = { padding: 'clamp(20px, 4vw, 32px)', borderRadius: 30, border: '1px solid rgba(148,163,184,.22)', background: 'rgba(15,23,42,.72)', boxShadow: '0 28px 90px rgba(0,0,0,.32)', marginBottom: 24, boxSizing: 'border-box' };
const eyebrow: CSSProperties = { color: '#67e8f9', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase', margin: 0 };
const grid: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 18 };
const panel: CSSProperties = { padding: 26, borderRadius: 26, border: '1px solid rgba(148,163,184,.22)', background: 'rgba(15,23,42,.82)', marginBottom: 18, boxSizing: 'border-box' };
const card: CSSProperties = { color: '#eef2ff', textDecoration: 'none', padding: 'clamp(16px, 3vw, 24px)', borderRadius: 26, border: '1px solid rgba(148,163,184,.22)', background: 'linear-gradient(180deg,rgba(15,23,42,.88),rgba(2,6,23,.68))', boxShadow: '0 20px 70px rgba(0,0,0,.28)', boxSizing: 'border-box' };
const tagLive: CSSProperties = { padding: '6px 10px', borderRadius: 999, color: '#020617', background: '#67e8f9', fontWeight: 900, fontSize: 12 };
const tagCompleted: CSSProperties = { ...tagLive, background: '#475569', color: '#f8fafc' }; 
const stats: CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap', color: '#cbd5e1', marginTop: 'auto', fontSize: 13 };
const deleteBtn: CSSProperties = { position: 'absolute', top: 20, right: 20, background: '#ef4444', color: 'white', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 'bold', cursor: 'pointer', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' };

const notificationBanner: CSSProperties = { padding: 20, borderRadius: 20, border: '1px solid rgba(251,191,36,.3)', background: 'linear-gradient(180deg,rgba(15,23,42,.9),rgba(251,191,36,.05))', marginBottom: 24, boxSizing: 'border-box' };
const notificationRow: CSSProperties = { textDecoration: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: 16, borderRadius: 12, background: 'rgba(2,6,23,.5)', border: '1px solid rgba(148,163,184,.15)', transition: 'background 0.2s' };
const countdownPill: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', background: 'rgba(251,191,36,.1)', color: '#fbbf24', padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(251,191,36,.2)' };