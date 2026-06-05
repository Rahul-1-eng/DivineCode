import { useEffect, useState, CSSProperties } from 'react';
import { useSession } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

export default function ContestsPage() {
  const { data: session, status } = useSession();
  const [contests, setContests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now()); 

  useEffect(() => {
    setMounted(true);
    const ticker = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, []);

  // Fetch contests only when session is loaded or changes
  useEffect(() => {
    if (status !== 'loading') {
      loadContests();
    }
  }, [session, status]);

  async function loadContests() {
    try { 
      setLoading(true);
      setError('');
      
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (session?.user?.email) {
        headers['x-user-email'] = session.user.email;
      }

      const res = await fetch(`${API_V2_BASE_URL}/contests`, { headers }); 
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to fetch contests');
      }
      
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
        alert(`Error: ${data.error || 'Permission denied'}`);
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
    return `${d}d ${h}h ${m}m ${s}s`;
  }

  if (!mounted) return null; 

  const userLabel = session?.user?.name || session?.user?.email;
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
        </div>

        {upcomingContests.map(contest => (
          <a key={contest.id} href={`/contests/${contest.id}`} style={notificationRow}>
            <strong>📅 {contest.title}</strong>
            <span style={{ fontFamily: 'monospace' }}>{formatCountdown(new Date(contest.startTime).getTime() - nowTick)}</span>
          </a>
        ))}
        
        {loading && <div style={panel}>Loading contests...</div>}
        {error && <div style={{...panel, borderColor: '#ef4444'}}><h2 style={{color: '#ef4444'}}>Connection Error</h2><p>{error}</p></div>}
        
        <section style={grid}>
          {pastAndLiveContests.map((contest) => (
            <div key={contest.id} style={{ position: 'relative', display: 'flex' }}>
              <a href={`/contests/${contest.id}`} style={{ ...card, flex: 1 }}>
                <h2>{contest.title}</h2>
                <p>{contest.description}</p>
              </a>
            </div>
          ))}
        </section>
      </section>
    </main>
  );
}

const page: CSSProperties = { minHeight: '100vh', padding: '4vw', fontFamily: 'Inter, sans-serif', color: '#eef2ff', background: '#070a16' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', marginBottom: 40 };
const brand: CSSProperties = { color: '#fff', textDecoration: 'none', fontWeight: 950, fontSize: 24 };
const navLinks: CSSProperties = { display: 'flex', gap: 10 };
const pill: CSSProperties = { padding: '10px 16px', borderRadius: 999, border: '1px solid #334155', color: '#eef2ff', textDecoration: 'none' };
const primary: CSSProperties = { ...pill, background: '#38bdf8', color: '#000', fontWeight: 'bold' };
const hero: CSSProperties = { padding: 40, border: '1px solid #1e293b', borderRadius: 20, marginBottom: 20 };
const eyebrow: CSSProperties = { color: '#67e8f9', fontWeight: 900, textTransform: 'uppercase', fontSize: 12 };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 };
const card: CSSProperties = { padding: 20, border: '1px solid #1e293b', borderRadius: 16, background: '#0f172a', textDecoration: 'none', color: '#fff' };
const panel: CSSProperties = { padding: 20, border: '1px solid #1e293b', borderRadius: 16, background: '#0f172a' };
const notificationRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: 15, background: '#1e293b', marginBottom: 10, borderRadius: 8, color: '#fff', textDecoration: 'none' };