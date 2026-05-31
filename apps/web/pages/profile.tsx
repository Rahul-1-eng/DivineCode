import { CSSProperties, useEffect, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const [contests, setContests] = useState<any[]>([]);
  const [handle, setHandle] = useState('');
  
  useEffect(() => { 
    fetch(`${API_BASE_URL}/api/contests`)
      .then((r) => r.json())
      .then((d) => setContests(Array.isArray(d) ? d : []))
      .catch(() => setContests([])); 
  }, []);

  if (status === 'loading') return <main style={page}><div style={centerText}><h1 style={{color:'#67e8f9'}}>Loading profile...</h1></div></main>;
  
  if (!session) return (
    <main style={page}>
      <section style={{...card, maxWidth: 500, margin: '15vh auto', textAlign: 'center'}}>
        <h1 style={{margin: '0 0 10px 0'}}>Sign in required</h1>
        <p style={{ color: '#94a3b8', marginBottom: 20 }}>Your profile shows account, handle, contests, and submissions.</p>
        <a href="/signin" style={primary}>Sign in</a>
      </section>
    </main>
  );

  const name = session.user?.name || session.user?.email || 'DivineCode user';
  
  return (
    <main style={page}>
      <section style={{ maxWidth: 1120, margin: '0 auto', boxSizing: 'border-box' }}>
        
        <nav style={nav}>
          <a href="/" style={brand}>← DivineCode</a>
          <button onClick={() => signOut()} style={ghost}>Sign out</button>
        </nav>
        
        <section style={hero}>
          <div style={{ flex: '1 1 300px' }}>
            <p style={eyebrow}>Profile</p>
            <h1 style={{ fontSize: 'clamp(36px, 6vw, 54px)', margin: '10px 0', wordBreak: 'break-word' }}>{name}</h1>
            <p style={{ color: '#a8b3c7', margin: 0, wordBreak: 'break-all' }}>{session.user?.email}</p>
          </div>
          {session.user?.image && <img src={session.user.image} alt="Profile" style={avatar} />}
        </section>
        
        <div style={grid}>
          <section style={card}>
            <h2 style={{ margin: '0 0 10px 0' }}>Codeforces handle</h2>
            <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16 }}>Use this exact handle when creating contests. Your Google name is not used as the Codeforces handle.</p>
            <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="RKS_Rider" style={input} />
            <p style={{ color: '#67e8f9', fontSize: 13, marginTop: 12 }}>Saved per-contest currently. Global profile saving can be wired next.</p>
          </section>
          
          <section style={card}>
            <h2 style={{ margin: '0 0 16px 0' }}>Activity snapshot</h2>
            <p style={statRow}><span>Visible contests:</span> <b style={{color: '#eef2ff'}}>{contests.length}</b></p>
            <p style={statRow}><span>Account:</span> <b style={{color: '#eef2ff'}}>{session.user?.email ? 'Google connected' : 'Guest'}</b></p>
            <p style={statRow}><span>Judge mode:</span> <b style={{color: '#eef2ff'}}>Codeforces sync + Judge0-ready</b></p>
          </section>
        </div>
        
        <section style={{ ...card, marginTop: 18 }}>
          <h2 style={{ margin: '0 0 16px 0' }}>Your contest rooms</h2>
          {contests.length === 0 && <p style={{ color: '#94a3b8' }}>No contests visible yet.</p>}
          
          <div style={{ display: 'grid', gap: 12 }}>
            {contests.map((c) => (
              <a key={c.id} href={`/contests/${c.id}`} style={contestRow}>
                <strong style={{ fontSize: 16 }}>{c.title}</strong>
                <span style={{ fontSize: 13, color: '#94a3b8' }}>{c.membersCount} members · {c.problemsCount} problems · {c.durationMinutes}m</span>
              </a>
            ))}
          </div>
        </section>

      </section>
    </main>
  );
}

// RESTORED CSS WITH MOBILE FIXES
const page: CSSProperties = { minHeight: '100vh', padding: '4vw', fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.32), transparent 34rem), #070a16', boxSizing: 'border-box' };
const centerText: CSSProperties = { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 };
const brand: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 900, fontSize: 18 };
const ghost: CSSProperties = { padding: '11px 16px', borderRadius: 999, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(2,6,23,.55)', color: '#eef2ff', cursor: 'pointer', fontWeight: 'bold' };
const primary: CSSProperties = { display: 'inline-block', padding: '12px 24px', borderRadius: 999, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', textDecoration: 'none', fontWeight: 900 };

const hero: CSSProperties = { padding: 'clamp(20px, 4vw, 30px)', borderRadius: 30, background: 'rgba(15,23,42,.82)', border: '1px solid rgba(148,163,184,.22)', display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'center', flexWrap: 'wrap', boxSizing: 'border-box' };
const eyebrow: CSSProperties = { color: '#67e8f9', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase', margin: 0 };
const avatar: CSSProperties = { width: 'clamp(70px, 15vw, 96px)', height: 'clamp(70px, 15vw, 96px)', borderRadius: 999, border: '2px solid rgba(34,211,238,.5)', objectFit: 'cover' };

const grid: CSSProperties = { marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 18 };
const card: CSSProperties = { flex: '1 1 300px', padding: 'clamp(16px, 3vw, 24px)', borderRadius: 26, background: 'rgba(15,23,42,.82)', border: '1px solid rgba(148,163,184,.22)', boxShadow: '0 24px 70px rgba(0,0,0,.28)', boxSizing: 'border-box' };

const input: CSSProperties = { width: '100%', padding: 14, borderRadius: 14, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(2,6,23,.55)', color: '#eef2ff', outline: 'none', boxSizing: 'border-box' };
const statRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(148,163,184,.1)', paddingBottom: 10, marginBottom: 10, color: '#94a3b8' };
const contestRow: CSSProperties = { color: '#eef2ff', textDecoration: 'none', padding: 18, borderRadius: 18, background: 'rgba(2,6,23,.55)', border: '1px solid rgba(148,163,184,.16)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', transition: 'background 0.2s' };