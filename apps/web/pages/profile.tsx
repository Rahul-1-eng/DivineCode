import { CSSProperties, useEffect, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

function viewerHeaders(session: any) {
  return {
    'Content-Type': 'application/json',
    'x-user-email': session?.user?.email || '',
    'x-user-name': session?.user?.name || ''
  };
}

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const [contests, setContests] = useState<any[]>([]);
  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // States for the inputs
  const [divineCodeUsername, setDivineCodeUsername] = useState('');
  const [cfHandle, setCfHandle] = useState('');
  const [lcHandle, setLcHandle] = useState('');

  const [savingUser, setSavingUser] = useState(false);
  const [savingHandles, setSavingHandles] = useState(false);

  useEffect(() => { 
    if (status !== 'authenticated' || !session?.user?.email) return;

    // Fetch user profile and existing handles
    fetch(`${API_BASE_URL}/api/v2/profile/me`, { headers: viewerHeaders(session) })
      .then(r => r.json())
      .then(data => {
        setUserData(data);
        if (data.username) setDivineCodeUsername(data.username);
        
        const cf = data.externalHandles?.find((h: any) => h.platform === 'CODEFORCES');
        const lc = data.externalHandles?.find((h: any) => h.platform === 'LEETCODE');
        if (cf) setCfHandle(cf.handle);
        if (lc) setLcHandle(lc.handle);
        setLoading(false);
      });

    // Fetch user's contests
    fetch(`${API_BASE_URL}/api/v2/contests`)
      .then((r) => r.json())
      .then((d) => setContests(Array.isArray(d) ? d : [])); 
  }, [status, session]);

  async function handleClaimUsername() {
    if (!divineCodeUsername.trim()) return alert("Username cannot be empty");
    setSavingUser(true);
    const res = await fetch(`${API_BASE_URL}/api/v2/profile/claim-username`, {
      method: 'POST',
      headers: viewerHeaders(session),
      body: JSON.stringify({ username: divineCodeUsername })
    });
    const data = await res.json();
    setSavingUser(false);
    if (res.ok) alert("Username claimed successfully!");
    else alert(data.error || "Failed to claim username");
  }

  async function unlinkHandle(platform: string, handle: string) {
    if (!confirm(`Are you sure you want to unlink ${handle}?`)) return;
    const res = await fetch(`${API_BASE_URL}/api/v2/profile/handles/${platform}/${handle}`, {
      method: 'DELETE',
      headers: { 'x-user-email': session?.user?.email || '' }
    });
    if (res.ok) {
      alert('Handle unlinked!');
      window.location.reload();
    } else {
      alert('Failed to unlink.');
    }
  }
  async function handleSaveLinks() {
    setSavingHandles(true);
    const res = await fetch(`${API_BASE_URL}/api/v2/profile/save-handles`, {
      method: 'POST',
      headers: viewerHeaders(session),
      body: JSON.stringify({ codeforcesHandle: cfHandle, leetcodeHandle: lcHandle })
    });
    const data = await res.json();
    setSavingHandles(false);
    if (res.ok) alert("Handles saved successfully!");
    else alert(data.error || "Failed to save handles");
  }

  if (status === 'loading' || loading) return (
    <main style={page}>
      <div style={{ maxWidth: 1120, margin: '10vh auto' }}>
        <div style={{ ...card, animation: 'pulse 1.5s infinite' }}>
          <div style={{ height: 40, width: '40%', background: 'rgba(255,255,255,0.05)', borderRadius: 8, marginBottom: 15 }} />
          <div style={{ height: 20, width: '70%', background: 'rgba(255,255,255,0.05)', borderRadius: 8 }} />
        </div>
      </div>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
    </main>
  );
  
  if (!session) return (
    <main style={page}>
      <section style={{...card, maxWidth: 500, margin: '15vh auto', textAlign: 'center'}}>
        <h1 style={{margin: '0 0 10px 0'}}>Sign in required</h1>
        <p style={{ color: '#94a3b8', marginBottom: 20 }}>Your profile shows your global username, linked handles, and submissions.</p>
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
            <p style={eyebrow}>Global Profile</p>
            <h1 style={{ fontSize: 'clamp(36px, 6vw, 54px)', margin: '10px 0', wordBreak: 'break-word' }}>{name}</h1>
            <p style={{ color: '#a8b3c7', margin: 0, wordBreak: 'break-all' }}>{session.user?.email}</p>
            {userData?.rating && (
              <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
                <span style={badge}>🏆 Rating: {userData.rating}</span>
                <span style={badge}>🪙 Coins: {userData.coins || 0}</span>
              </div>
            )}
          </div>
          {session.user?.image && <img src={session.user.image} alt="Profile" style={avatar} />}
        </section>
        
        <div style={grid}>
          <section style={card}>
            <h2 style={{ margin: '0 0 10px 0' }}>DivineCode Username</h2>
            <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16 }}>
              This is your primary identity on the platform. Group owners will use this to add you to contests.
            </p>
            <input 
              value={divineCodeUsername} 
              onChange={(e) => setDivineCodeUsername(e.target.value)} 
              placeholder="e.g., RKS_Rider" 
              style={input} 
            />
            <button onClick={handleClaimUsername} disabled={savingUser} style={{...primary, marginTop: 12, padding: '8px 16px', fontSize: 14, border: 'none', cursor: 'pointer'}}>
              {savingUser ? 'Saving...' : 'Claim Username'}
            </button>
          </section>

          <section style={card}>
            <h2 style={{ margin: '0 0 10px 0' }}><section style={card}>
    <h2 style={{ margin: '0 0 10px 0' }}>Linked External Handles</h2>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
      {userData?.externalHandles?.map((h: any) => (
        <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(2,6,23,.5)', padding: 10, borderRadius: 8 }}>
          <span>{h.platform}: <b>{h.handle}</b></span>
          <button onClick={() => unlinkHandle(h.platform, h.handle)} style={{ color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>Unlink</button>
        </div>
      ))}
    </div>
    
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input value={cfHandle} onChange={(e) => setCfHandle(e.target.value)} placeholder="Codeforces Handle" style={input} />
      <input value={lcHandle} onChange={(e) => setLcHandle(e.target.value)} placeholder="LeetCode Handle" style={input} />
    </div>
    <button onClick={handleSaveLinks} disabled={savingHandles} style={{...ghost, marginTop: 12, padding: '8px 16px', fontSize: 14}}>
      {savingHandles ? 'Saving...' : 'Save/Link Handles'}
    </button>
  </section></h2>
            <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16 }}>Link your competitive programming accounts for automated syncing.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input value={cfHandle} onChange={(e) => setCfHandle(e.target.value)} placeholder="Codeforces Handle" style={input} />
              <input value={lcHandle} onChange={(e) => setLcHandle(e.target.value)} placeholder="LeetCode Handle" style={input} />
            </div>
            <button onClick={handleSaveLinks} disabled={savingHandles} style={{...ghost, marginTop: 12, padding: '8px 16px', fontSize: 14}}>
              {savingHandles ? 'Saving...' : 'Save Links'}
            </button>
          </section>
        </div>
        
        <section style={{ ...card, marginTop: 18 }}>
          <h2 style={{ margin: '0 0 16px 0' }}>Your contest rooms</h2>
          {contests.length === 0 && <p style={{ color: '#94a3b8' }}>No contests visible yet.</p>}
          <div style={{ display: 'grid', gap: 12 }}>
            {contests.map((c) => (
              <a key={c.id} href={`/contests/${c.id}`} style={contestRow}>
                <strong style={{ fontSize: 16 }}>{c.title}</strong>
                <span style={{ fontSize: 13, color: '#94a3b8' }}>{c.membersCount} members · {c.problemsCount} problems</span>
              </a>
            ))}
          </div>
        </section>

      </section>
    </main>
  );
}

// RESTORED CSS
const page: CSSProperties = { minHeight: '100vh', padding: '4vw', fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.32), transparent 34rem), #070a16', boxSizing: 'border-box' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 };
const brand: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 900, fontSize: 18 };
const ghost: CSSProperties = { padding: '11px 16px', borderRadius: 999, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(2,6,23,.55)', color: '#eef2ff', cursor: 'pointer', fontWeight: 'bold' };
const primary: CSSProperties = { display: 'inline-block', padding: '12px 24px', borderRadius: 999, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', textDecoration: 'none', fontWeight: 900, border: 'none' };
const hero: CSSProperties = { padding: 'clamp(20px, 4vw, 30px)', borderRadius: 30, background: 'rgba(15,23,42,.82)', border: '1px solid rgba(148,163,184,.22)', display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'center', flexWrap: 'wrap', boxSizing: 'border-box' };
const eyebrow: CSSProperties = { color: '#67e8f9', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase', margin: 0 };
const avatar: CSSProperties = { width: 'clamp(70px, 15vw, 96px)', height: 'clamp(70px, 15vw, 96px)', borderRadius: 999, border: '2px solid rgba(34,211,238,.5)', objectFit: 'cover' };
const grid: CSSProperties = { marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 18 };
const card: CSSProperties = { flex: '1 1 300px', padding: 'clamp(16px, 3vw, 24px)', borderRadius: 26, background: 'rgba(15,23,42,.82)', border: '1px solid rgba(148,163,184,.22)', boxShadow: '0 24px 70px rgba(0,0,0,.28)', boxSizing: 'border-box' };
const input: CSSProperties = { width: '100%', padding: 14, borderRadius: 14, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(2,6,23,.55)', color: '#eef2ff', outline: 'none', boxSizing: 'border-box' };
const contestRow: CSSProperties = { color: '#eef2ff', textDecoration: 'none', padding: 18, borderRadius: 18, background: 'rgba(2,6,23,.55)', border: '1px solid rgba(148,163,184,.16)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', transition: 'background 0.2s' };
const badge: CSSProperties = { padding: '6px 12px', background: 'rgba(34,211,238,.1)', color: '#67e8f9', borderRadius: 12, fontSize: 14, fontWeight: 'bold' };