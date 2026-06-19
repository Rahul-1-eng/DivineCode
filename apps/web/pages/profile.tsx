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

const EloGraph = ({ history }: { history: any[] }) => {
  if (!history || history.length < 1) {
    return <div style={{ color: '#64748b', padding: 40, textAlign: 'center', background: 'rgba(2,6,23,.5)', borderRadius: 16, border: '1px solid rgba(148,163,184,.1)' }}>No rated history yet. Compete to get your initial rating!</div>;
  }

  const points = history.map(h => h.newRating);
  if (points.length === 1) points.unshift(1200); 

  const min = Math.min(...points) - 50;
  const max = Math.max(...points) + 50;
  const range = max - min;
  const width = 800;
  const height = 250;
  const stepX = width / (points.length - 1);

  const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${i * stepX} ${height - ((p - min) / range) * height}`).join(' ');

  return (
    <div style={{ width: '100%', overflowX: 'auto', background: 'rgba(2,6,23,.5)', padding: '30px 20px', borderRadius: 16, border: '1px solid rgba(148,163,184,.16)' }}>
      <svg viewBox={`-20 -20 ${width + 40} ${height + 40}`} style={{ minWidth: 600, width: '100%', height: 'auto', display: 'block' }}>
        {[0, 0.25, 0.5, 0.75, 1].map(pct => (
          <line key={pct} x1="0" y1={height * pct} x2={width} y2={height * pct} stroke="rgba(148,163,184,.1)" strokeWidth="1" />
        ))}
        <path d={pathData} fill="none" stroke="#22d3ee" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 4px 6px rgba(34,211,238,0.4))' }} />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={i * stepX} cy={height - ((p - min) / range) * height} r="6" fill="#0f172a" stroke="#22d3ee" strokeWidth="3" />
            <text x={i * stepX} y={height - ((p - min) / range) * height - 16} fill="#e2e8f0" fontSize="13" fontWeight="bold" textAnchor="middle">{p}</text>
          </g>
        ))}
      </svg>
    </div>
  );
};

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  const [divineCodeUsername, setDivineCodeUsername] = useState('');
  const [cfHandle, setCfHandle] = useState('');
  const [lcHandle, setLcHandle] = useState('');

  const [savingUser, setSavingUser] = useState(false);
  const [savingHandles, setSavingHandles] = useState(false);

  // Password State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMessage, setPwMessage] = useState({ text: '', type: '' });

  useEffect(() => { 
    if (status !== 'authenticated' || !session?.user?.email) return;

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
    if (res.ok) alert("Username updated successfully!");
    else alert(data.error || "Failed to update username");
  }

  const handlePasswordUpdate = async (e: any) => {
    e.preventDefault();
    setPwMessage({ text: 'Updating...', type: 'info' });

    try {
      const res = await fetch(`${API_BASE_URL}/api/v2/profile/update-password`, {
        method: 'POST',
        headers: viewerHeaders(session),
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      
      if (!res.ok) {
        setPwMessage({ text: data.error || 'Failed to update', type: 'error' });
      } else {
        setPwMessage({ text: 'Password successfully updated!', type: 'success' });
        setCurrentPassword('');
        setNewPassword('');
      }
    } catch (err) {
      setPwMessage({ text: 'Network error', type: 'error' });
    }
  };

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
    
    if (res.ok) {
      alert("Handles verified and linked successfully!");
      window.location.reload();
    } else {
      alert(data.error || "Failed to save handles. Please ensure the handle is correct.");
    }
  }

  if (status === 'loading' || loading) return (
    <main style={page}>
      <div style={{ maxWidth: 1120, margin: '10vh auto', padding: '0 20px' }}>
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

  const name = session.user?.name || userData?.name || session.user?.email || 'DivineCode user';
  
  return (
    <main style={page}>
      <section style={{ maxWidth: 1120, margin: '0 auto', boxSizing: 'border-box' }}>
        
        <nav style={nav}>
          <a href="/" style={brand}>← DivineCode</a>
          <button onClick={() => signOut({ callbackUrl: '/signin' })} style={ghost}>Sign out</button>
        </nav>
        
        <section style={hero}>
          <div style={{ flex: '1 1 250px', minWidth: 0 }}>
            <p style={eyebrow}>Global Profile</p>
            <h1 style={{ fontSize: 'clamp(28px, 6vw, 48px)', margin: '10px 0', wordBreak: 'break-word', lineHeight: 1.1 }}>{name}</h1>
            <p style={{ color: '#a8b3c7', margin: 0, wordBreak: 'break-word' }}>{session.user?.email}</p>
          </div>
          {session.user?.image && <img src={session.user.image} alt="Profile" style={avatar} />}
        </section>

        {/* Aggregate Stats Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 15, marginTop: 18 }}>
          <div style={{ ...card, textAlign: 'center', padding: '24px 15px' }}>
            <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 8, fontWeight: 'bold', textTransform: 'uppercase' }}>Global Rating</div>
            <div style={{ color: '#22d3ee', fontSize: 38, fontWeight: 900 }}>{userData?.rating || 1200}</div>
          </div>
          <div style={{ ...card, textAlign: 'center', padding: '24px 15px' }}>
            <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 8, fontWeight: 'bold', textTransform: 'uppercase' }}>Problems Solved</div>
            <div style={{ color: '#4ade80', fontSize: 38, fontWeight: 900 }}>{userData?.stats?.totalAccepted || 0}</div>
          </div>
          <div style={{ ...card, textAlign: 'center', padding: '24px 15px' }}>
            <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 8, fontWeight: 'bold', textTransform: 'uppercase' }}>Accuracy</div>
            <div style={{ color: userData?.stats?.accuracy >= 50 ? '#4ade80' : '#fbbf24', fontSize: 38, fontWeight: 900 }}>{userData?.stats?.accuracy || 0}%</div>
          </div>
          <div style={{ ...card, textAlign: 'center', padding: '24px 15px' }}>
            <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 8, fontWeight: 'bold', textTransform: 'uppercase' }}>Total Coins</div>
            <div style={{ color: '#fcd34d', fontSize: 38, fontWeight: 900 }}>{userData?.coins || 0}</div>
          </div>
        </div>

        {/* The Elo Graph */}
        <section style={{ ...card, marginTop: 18 }}>
          <h2 style={{ margin: '0 0 16px 0', fontSize: 20 }}>Rating Trajectory</h2>
          <EloGraph history={userData?.ratingHistory || []} />
        </section>

        <div style={grid}>
          <section style={card}>
            <h2 style={{ margin: '0 0 10px 0', fontSize: 20 }}>DivineCode Identity</h2>
            <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16 }}>
              This is your primary identity on the platform. Group owners will use this to add you to contests.
            </p>
            <input 
              value={divineCodeUsername} 
              onChange={(e) => setDivineCodeUsername(e.target.value)} 
              placeholder="e.g., RKS_Rider" 
              style={input} 
            />
            <button onClick={handleClaimUsername} disabled={savingUser} style={{...primary, marginTop: 12, padding: '10px 20px', fontSize: 14, border: 'none', cursor: 'pointer', width: '100%'}}>
              {savingUser ? 'Updating...' : 'Update Username'}
            </button>
          </section>

          {/* NEW: SECURITY SETTINGS */}
          <section style={card}>
            <h2 style={{ margin: '0 0 10px 0', fontSize: 20 }}>Security Settings</h2>
            <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16 }}>
              Update your password here. Leave current password blank if you initially signed up using Google.
            </p>
            <form onSubmit={handlePasswordUpdate} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input type="password" placeholder="Current Password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} style={input} />
              <input type="password" placeholder="New Password" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={input} required minLength={6} />
              
              {pwMessage.text && (
                <div style={{ color: pwMessage.type === 'error' ? '#f87171' : pwMessage.type === 'success' ? '#4ade80' : '#38bdf8', fontSize: 13, marginTop: 5 }}>
                  {pwMessage.text}
                </div>
              )}

              <button type="submit" style={{...ghost, marginTop: 12, padding: '10px 20px', fontSize: 14, width: '100%', borderColor: '#6366f1', color: '#818cf8'}}>
                Update Password
              </button>
            </form>
          </section>

          <section style={card}>
            <h2 style={{ margin: '0 0 10px 0', fontSize: 20 }}>Linked External Handles</h2>
            <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16 }}>
              Link your competitive programming accounts. Handles are strictly verified against your email.
            </p>

            {userData?.externalHandles && userData.externalHandles.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                {userData.externalHandles.map((h: any) => (
                  <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(2,6,23,.5)', padding: 12, borderRadius: 8, border: '1px solid rgba(148,163,184,.1)' }}>
                    <span style={{ fontSize: 14 }}>{h.platform}: <b style={{ color: '#67e8f9' }}>{h.handle}</b></span>
                    <button onClick={() => unlinkHandle(h.platform, h.handle)} style={{ color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: 13 }}>Unlink</button>
                  </div>
                ))}
              </div>
            )}
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input value={cfHandle} onChange={(e) => setCfHandle(e.target.value)} placeholder="Codeforces Handle" style={input} />
              <input value={lcHandle} onChange={(e) => setLcHandle(e.target.value)} placeholder="LeetCode Handle" style={input} />
            </div>
            
            <button onClick={handleSaveLinks} disabled={savingHandles} style={{...ghost, marginTop: 12, padding: '10px 20px', fontSize: 14, width: '100%'}}>
              {savingHandles ? 'Verifying & Saving...' : 'Verify & Link Handles'}
            </button>
          </section>
        </div>
        
        {/* Unified Match History Feed */}
        <section style={{ ...card, marginTop: 18 }}>
          <h2 style={{ margin: '0 0 16px 0', fontSize: 20 }}>Match History</h2>
          {(!userData?.matchHistory || userData.matchHistory.length === 0) && (
            <p style={{ color: '#94a3b8' }}>No rated contest history found.</p>
          )}
          
          {userData?.matchHistory && userData.matchHistory.length > 0 && (
            <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid rgba(148,163,184,.16)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ background: 'rgba(2,6,23,.5)' }}>
                  <tr>
                    <th style={th}>Contest</th>
                    <th style={th}>Date</th>
                    <th style={th}>Rank</th>
                    <th style={th}>Solved</th>
                    <th style={th}>Score</th>
                    <th style={th}>Rating Update</th>
                  </tr>
                </thead>
                <tbody>
                  {userData.matchHistory.map((match: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(148,163,184,.12)', transition: 'background 0.2s', cursor: 'pointer' }} onClick={() => window.location.href = `/contests/${match.contestId}/final`}>
                      <td style={td}>
                        <div style={{ color: '#eef2ff', fontWeight: 'bold' }}>{match.contestName}</div>
                        {!match.isRated && <span style={{ fontSize: 11, color: '#94a3b8', background: '#1e293b', padding: '2px 6px', borderRadius: 4 }}>Unrated Practice</span>}
                      </td>
                      <td style={td}>{new Date(match.date).toLocaleDateString()}</td>
                      <td style={{...td, color: '#e2e8f0', fontWeight: 'bold' }}>{match.rank !== '-' ? `#${match.rank}` : '-'}</td>
                      <td style={td}>{match.solved}</td>
                      <td style={{...td, color: '#fbbf24', fontWeight: 'bold' }}>{match.score}</td>
                      <td style={td}>
                        <span style={{ fontWeight: 'bold', color: match.ratingDelta > 0 ? '#4ade80' : match.ratingDelta < 0 ? '#f87171' : '#94a3b8' }}>
                          {match.ratingDelta > 0 ? `+${match.ratingDelta}` : match.ratingDelta}
                        </span>
                        <span style={{ marginLeft: 8, color: '#64748b' }}>→ {match.ratingAfter}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </section>
    </main>
  );
}

// 📱 CSS
const page: CSSProperties = { minHeight: '100vh', width: '100%', maxWidth: '100vw', overflowX: 'hidden', padding: 'clamp(16px, 4vw, 32px)', fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.32), transparent 34rem), #070a16', boxSizing: 'border-box' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 };
const brand: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 900, fontSize: 18 };
const ghost: CSSProperties = { padding: '11px 16px', borderRadius: 999, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(2,6,23,.55)', color: '#eef2ff', cursor: 'pointer', fontWeight: 'bold' };
const primary: CSSProperties = { display: 'inline-block', padding: '12px 24px', borderRadius: 999, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', textDecoration: 'none', fontWeight: 900, border: 'none', textAlign: 'center' };
const hero: CSSProperties = { padding: 'clamp(20px, 4vw, 30px)', borderRadius: 30, background: 'rgba(15,23,42,.82)', border: '1px solid rgba(148,163,184,.22)', display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'center', flexWrap: 'wrap-reverse', boxSizing: 'border-box', overflow: 'hidden' };
const eyebrow: CSSProperties = { color: '#67e8f9', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase', margin: 0 };
const avatar: CSSProperties = { width: 'clamp(80px, 20vw, 110px)', height: 'clamp(80px, 20vw, 110px)', borderRadius: 999, border: '3px solid rgba(34,211,238,.5)', objectFit: 'cover' };
const grid: CSSProperties = { marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 18 };
const card: CSSProperties = { flex: '1 1 300px', minWidth: 0, padding: 'clamp(16px, 4vw, 24px)', borderRadius: 26, background: 'rgba(15,23,42,.82)', border: '1px solid rgba(148,163,184,.22)', boxShadow: '0 24px 70px rgba(0,0,0,.28)', boxSizing: 'border-box', overflow: 'hidden' };
const input: CSSProperties = { width: '100%', padding: 14, borderRadius: 14, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(2,6,23,.55)', color: '#eef2ff', outline: 'none', boxSizing: 'border-box' };
const th: CSSProperties = { padding: '16px 20px', color: '#94a3b8', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 };
const td: CSSProperties = { padding: '16px 20px', fontSize: 14 };