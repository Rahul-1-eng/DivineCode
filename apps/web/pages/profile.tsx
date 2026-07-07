/**
 * @file profile.tsx
 * @author Rahul
 * @description Dynamic user profile aggregating global performance rating trajectories and topic mastery matrices.
 */
import { CSSProperties, useEffect, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import toast from 'react-hot-toast'; // Add this import
import { fetchApi } from '../lib/api';

const EloGraph = ({ history }: { history: any[] }) => {
  if (!history || history.length < 1) {
    return <div style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center', background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-color)' }}>No rated history yet. Compete to get your initial rating!</div>;
  }
  
  const points = history.map(h => h.newRating || h.ratingAfter || h.rating || 1200);
  if (points.length === 1) points.unshift(1200); // Anchor single points to standard entry rating
  
  const min = Math.min(...points) - 50;
  const max = Math.max(...points) + 50;
  // Fallback to 100 range if the user flatlines (max - min === 0) to prevent division by zero in SVG rendering
  const range = (max - min) === 0 ? 100 : (max - min); 
  
  const width = 1000;
  const height = 250;
  const stepX = width / (points.length - 1);
  const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${i * stepX} ${height - ((p - min) / range) * height}`).join(' ');

  return (
    <div style={{ width: '100%', overflowX: 'auto', background: 'var(--bg-card)', padding: '30px 20px', borderRadius: 16, border: '1px solid var(--border-color)' }}>
      <svg viewBox={`-20 -20 ${width + 40} ${height + 40}`} style={{ minWidth: 600, width: '100%', height: 'auto', display: 'block' }}>
        {/* Render clean structural chart grid guidelines natively without heavy external charting engine frameworks */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => (
          <line key={pct} x1="0" y1={height * pct} x2={width} y2={height * pct} stroke="var(--border-color)" strokeWidth="1" />
        ))}
        <path d={pathData} fill="none" stroke="var(--accent-primary)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 4px 6px var(--accent-glow))' }} />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={i * stepX} cy={height - ((p - min) / range) * height} r="6" fill="var(--bg-panel-solid)" stroke="var(--accent-primary)" strokeWidth="3" />
            <text x={i * stepX} y={height - ((p - min) / range) * height - 16} fill="var(--text-main)" fontSize="13" fontWeight="bold" textAnchor="middle">{p}</text>
          </g>
        ))}
      </svg>
    </div>
  );
};

const TopicRadarChart = ({ data }: { data: { subject: string, score: number }[] }) => {
  const size = 300;
  const center = size / 2;
  const radius = size / 2.5;
  const levels = 4;

  const points = data.map((d, i) => {
    const angle = (Math.PI * 2 * i) / data.length - Math.PI / 2;
    const value = Math.max(0, Math.min(100, d.score)) / 100;
    return {
      x: center + radius * value * Math.cos(angle),
      y: center + radius * value * Math.sin(angle),
      labelX: center + (radius + 25) * Math.cos(angle),
      labelY: center + (radius + 20) * Math.sin(angle),
    };
  });

  const polygonPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', padding: '20px 0' }}>
      <svg width={size + 100} height={size + 60} viewBox={`0 0 ${size + 100} ${size + 60}`}>
        {[...Array(levels)].map((_, levelIndex) => {
          const levelRadius = (radius / levels) * (levelIndex + 1);
          const levelPoints = data.map((_, i) => {
            const angle = (Math.PI * 2 * i) / data.length - Math.PI / 2;
            return `${center + levelRadius * Math.cos(angle)},${center + levelRadius * Math.sin(angle)}`;
          }).join(' ');
          return <polygon key={levelIndex} points={levelPoints} fill="none" stroke="var(--border-color)" strokeWidth="1" />;
        })}
        {data.map((_, i) => {
          const angle = (Math.PI * 2 * i) / data.length - Math.PI / 2;
          return (
            <line key={`axis-${i}`} x1={center} y1={center} x2={center + radius * Math.cos(angle)} y2={center + radius * Math.sin(angle)} stroke="var(--border-color)" strokeWidth="1" />
          );
        })}
        <path d={polygonPath} fill="var(--accent-glow)" stroke="var(--accent-primary)" strokeWidth="2" style={{ filter: 'drop-shadow(0 0 8px var(--accent-glow))' }} />
        {points.map((p, i) => (
          <g key={`point-${i}`}>
            <circle cx={p.x} cy={p.y} r="4" fill="var(--bg-panel-solid)" stroke="var(--accent-primary)" strokeWidth="2" />
            <text x={p.labelX} y={p.labelY} fill="var(--text-main)" fontSize="12" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">
              {data[i].subject}
            </text>
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
  const [syncingStats, setSyncingStats] = useState(false);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiAnalysisResult, setAiAnalysisResult] = useState<any>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMessage, setPwMessage] = useState({ text: '', type: '' });

  useEffect(() => { 
    if (status === 'loading') return;
    if (status !== 'authenticated' || !session?.user?.email) {
      setLoading(false);
      return;
    }

    fetchApi('/api/v2/profile/me')
      .then(data => {
        setUserData(data);
        if (data.username) setDivineCodeUsername(data.username);
        
        const cf = data.externalHandles?.find((h: any) => h.platform === 'CODEFORCES');
        const lc = data.externalHandles?.find((h: any) => h.platform === 'LEETCODE');
        if (cf) setCfHandle(cf.handle);
        if (lc) setLcHandle(lc.handle);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch profile", err);
        setLoading(false);
      });
  }, [status, session]);

 async function handleAnalyzeWeaknesses() {
  setIsAnalyzing(true);
  try {
    const res = await fetchApi('/api/v2/ai/analyze-weaknesses', { method: 'POST' });
    if (res.success && res.analysis) {
        setAiAnalysisResult(res.analysis);
        toast.success("AI Analysis Complete!");
    }
  } catch (err: any) {
     toast.error("Analysis failed.");
  } finally {
    setIsAnalyzing(false);
  }
}

  async function handleClaimUsername() {
    if (!divineCodeUsername.trim()) return alert("Username cannot be empty");
    setSavingUser(true);
    try {
      await fetchApi('/api/v2/profile/claim-username', { method: 'POST', body: JSON.stringify({ username: divineCodeUsername }) });
      alert("Username updated successfully!");
    } catch (err: any) { alert(err.message || "Failed to update username"); } 
    finally { setSavingUser(false); }
  }

  const handlePasswordUpdate = async (e: any) => {
    e.preventDefault();
    setPwMessage({ text: 'Updating...', type: 'info' });
    try {
      await fetchApi('/api/v2/profile/update-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      setPwMessage({ text: 'Password successfully updated!', type: 'success' });
      setCurrentPassword(''); setNewPassword('');
    } catch (err: any) { setPwMessage({ text: err.message || 'Failed to update', type: 'error' }); }
  };

  async function unlinkHandle(platform: string, handle: string) {
    if (!confirm(`Are you sure you want to unlink ${handle}?`)) return;
    try {
      await fetchApi(`/api/v2/profile/handles/${platform}/${handle}`, { method: 'DELETE' });
      alert('Handle unlinked!'); window.location.reload();
    } catch (err: any) { alert('Failed to unlink.'); }
  }

  async function handleSaveLinks() {
    setSavingHandles(true);
    try {
      await fetchApi('/api/v2/profile/save-handles', { method: 'POST', body: JSON.stringify({ codeforcesHandle: cfHandle, leetcodeHandle: lcHandle }) });
      alert("Handles verified and linked successfully!"); window.location.reload();
    } catch (err: any) { alert(err.message || "Failed to save handles."); }
    finally { setSavingHandles(false); }
  }

  async function refreshPlatformStats() {
    setSyncingStats(true);
    try {
      await fetchApi('/api/v2/profile/sync-ratings', { method: 'POST' });
      alert('Platform stats refreshed!'); window.location.reload();
    } catch (err: any) { alert(err.message || 'Failed to refresh stats.'); }
    finally { setSyncingStats(false); }
  }

  if (status === 'loading' || loading) return (
    <main style={page}>
      <div style={{ maxWidth: 1120, margin: '10vh auto', padding: '0 20px' }}>
        <div style={{ ...card, animation: 'pulse 1.5s infinite' }}>
          <div style={{ height: 40, width: '40%', background: 'var(--border-color)', borderRadius: 8, marginBottom: 15 }} />
          <div style={{ height: 20, width: '70%', background: 'var(--border-color)', borderRadius: 8 }} />
        </div>
      </div>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
    </main>
  );
  
  if (!session) return (
    <main style={page}>
      <section style={{...card, maxWidth: 500, margin: '15vh auto', textAlign: 'center'}}>
        <h1 style={{margin: '0 0 10px 0'}}>Sign in required</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>Your profile shows your global username, linked handles, and submissions.</p>
        <a href="/signin" style={primary}>Sign in</a>
      </section>
    </main>
  );

 const name = session.user?.name || userData?.name || session.user?.email || 'DivineCode user';
  const hasTopicData = userData?.topicMastery && userData.topicMastery.length > 0;
  
  // Generate a default visual matrix so the UI never looks broken for new users
  const defaultMastery = [
    { subject: 'Dynamic Programming', score: 10 },
    { subject: 'Graph Theory', score: 10 },
    { subject: 'Data Structures', score: 10 },
    { subject: 'Math', score: 10 },
    { subject: 'Greedy', score: 10 }
  ];
  const activeTopicData = hasTopicData ? userData.topicMastery : defaultMastery;
  
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
            <p style={{ color: 'var(--text-muted)', margin: 0, wordBreak: 'break-word' }}>{session.user?.email}</p>
          </div>
          {/* Google photos 403 without no-referrer; password accounts fall back
              to the DB avatar, then to an initial-letter badge. */}
          {(session.user?.image || userData?.avatarUrl) ? (
            <img
              src={session.user?.image || userData?.avatarUrl}
              alt="Profile"
              referrerPolicy="no-referrer"
              onError={(e) => {
                const el = e.currentTarget;
                if (userData?.avatarUrl && el.src !== userData.avatarUrl) el.src = userData.avatarUrl;
                else el.style.display = 'none';
              }}
              style={avatar}
            />
          ) : (
            <div style={{ ...avatar, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #6366f1, #22d3ee)', color: '#020617', fontSize: 'clamp(32px, 8vw, 44px)', fontWeight: 900 }}>
              {(name || session.user?.email || '?').charAt(0).toUpperCase()}
            </div>
          )}
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 15, marginTop: 18 }}>
          <div style={{ ...card, textAlign: 'center', padding: '24px 15px' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 8, fontWeight: 'bold', textTransform: 'uppercase' }}>Global Rating</div>
            <div style={{ color: 'var(--accent-primary)', fontSize: 38, fontWeight: 900 }}>{userData?.rating || 1200}</div>
          </div>
          <div style={{ ...card, textAlign: 'center', padding: '24px 15px' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 8, fontWeight: 'bold', textTransform: 'uppercase' }}>Problems Solved</div>
            <div style={{ color: '#4ade80', fontSize: 38, fontWeight: 900 }}>{userData?.stats?.totalAccepted || 0}</div>
          </div>
          <div style={{ ...card, textAlign: 'center', padding: '24px 15px' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 8, fontWeight: 'bold', textTransform: 'uppercase' }}>Accuracy</div>
            <div style={{ color: userData?.stats?.accuracy >= 50 ? '#4ade80' : '#fbbf24', fontSize: 38, fontWeight: 900 }}>{userData?.stats?.accuracy || 0}%</div>
          </div>
          <div style={{ ...card, textAlign: 'center', padding: '24px 15px', cursor: 'pointer' }} onClick={() => { window.location.href = '/coins'; }} title="Open the coin wallet">
            <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 8, fontWeight: 'bold', textTransform: 'uppercase' }}>Total Coins</div>
            <div style={{ color: '#fcd34d', fontSize: 38, fontWeight: 900 }}>{userData?.coins || 0}</div>
            <div style={{ color: '#22d3ee', fontSize: 12, fontWeight: 700, marginTop: 6 }}>Buy more — 50 for ₹10 →</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 18, marginTop: 18 }}>
          
          <section style={{ ...card }}>
            <h2 style={{ margin: '0 0 16px 0', fontSize: 20 }}>Rating Trajectory</h2>
            {/* Reverses the match history so the graph reads chronologically left-to-right */}
            <EloGraph history={userData?.matchHistory?.length > 0 ? [...userData.matchHistory].reverse() : userData?.ratingHistory || []} />
          </section>

          <section style={{ ...card, display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ margin: '0 0 16px 0', fontSize: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Topic Mastery Tracker
              <button 
                 onClick={handleAnalyzeWeaknesses} 
                 disabled={isAnalyzing}
                 style={{ fontSize: 12, background: 'var(--accent-glow)', color: 'var(--accent-primary)', padding: '6px 12px', borderRadius: 8, fontWeight: 'bold', border: '1px solid var(--accent-glow)', cursor: isAnalyzing ? 'not-allowed' : 'pointer' }}
              >
                {isAnalyzing ? 'Analyzing...' : '🤖 Analyze Weaknesses'}
              </button>
            </h2>
            
           <div style={{ flex: 1, background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '10px 0' }}>
               <TopicRadarChart data={activeTopicData} />
               {!hasTopicData && (
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 10, fontStyle: 'italic', textAlign: 'center', padding: '0 20px' }}>
                    Complete algorithmic battles to activate your live neural matrix.
                  </p>
               )}
            </div>

            {aiAnalysisResult && (
               <div style={{ marginTop: 15, padding: 15, background: 'rgba(168, 85, 247, 0.1)', borderRadius: 12, border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                  <h3 style={{ margin: '0 0 10px', color: '#a855f7', fontSize: 16 }}>🎯 AI Recommendations</h3>
                  <div style={{ fontSize: 13, color: 'var(--text-main)', marginBottom: 10 }}>
                    <strong>Weakness Identified:</strong> {aiAnalysisResult.analysis?.weaknesses?.[0]?.topic || 'General Problem Solving'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                     {aiAnalysisResult.recommendedProblems?.map((p: any, i: number) => (
                        <a key={i} href={`/practice?tags=${p.tags?.[0] || ''}`} style={{ padding: '10px 12px', background: 'var(--bg-panel-solid)', borderRadius: 8, color: 'var(--accent-primary)', textDecoration: 'none', display: 'flex', justifyContent: 'space-between', border: '1px solid var(--border-color)' }}>
                           <span>{p.title}</span>
                           <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>Elo {p.rating}</span>
                        </a>
                     ))}
                  </div>
               </div>
            )}
          </section>

        </div>

        <div style={grid}>
          <section style={card}>
            <h2 style={{ margin: '0 0 10px 0', fontSize: 20 }}>DivineCode Identity</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}>
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

          <section style={card}>
            <h2 style={{ margin: '0 0 10px 0', fontSize: 20 }}>Security Settings</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}>
              Update your password here. Leave current password blank if you initially signed up using Google.
            </p>
            <form onSubmit={handlePasswordUpdate} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input type="password" placeholder="Current Password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} style={input} />
              <input type="password" placeholder="New Password" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={input} required minLength={6} />
              
              {pwMessage.text && (
                <div style={{ color: pwMessage.type === 'error' ? '#f87171' : pwMessage.type === 'success' ? '#4ade80' : 'var(--accent-primary)', fontSize: 13, marginTop: 5 }}>
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
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}>
              Link your competitive programming accounts. Handles are strictly verified against your email.
            </p>

            {userData?.externalHandles && userData.externalHandles.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                {userData.externalHandles.map((h: any) => (
                  <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-card)', padding: 12, borderRadius: 8, border: '1px solid var(--border-color)' }}>
                    <span style={{ fontSize: 14 }}>
                      {h.platform}: <b style={{ color: 'var(--accent-primary)' }}>{h.handle}</b>
                      {h.rating != null && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>· {h.rating}{h.maxRating != null ? ` (max ${h.maxRating})` : ''}</span>}
                    </span>
                    <button onClick={() => unlinkHandle(h.platform, h.handle)} style={{ color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: 13 }}>Unlink</button>
                  </div>
                ))}
                <button onClick={refreshPlatformStats} disabled={syncingStats} style={{...ghost, padding: '10px 20px', fontSize: 14, width: '100%'}}>
                  {syncingStats ? 'Syncing with platforms...' : '🔄 Refresh Platform Stats'}
                </button>
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
        
        <section style={{ ...card, marginTop: 18 }}>
          <h2 style={{ margin: '0 0 16px 0', fontSize: 20 }}>Transaction & Rating Logs</h2>
          
          <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid var(--border-color)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ background: 'var(--bg-card)' }}>
                <tr>
                  <th style={th}>Date</th>
                  <th style={th}>Event</th>
                  <th style={th}>Rating Change</th>
                  <th style={th}>Coin Change</th>
                </tr>
              </thead>
              <tbody>
                {userData?.activityLog?.length > 0 ? (
                  userData.activityLog.map((act: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={td}>{new Date(act.date).toLocaleDateString()}</td>
                      <td style={td}>{act.eventDescription}</td>
                      <td style={{ ...td, color: act.ratingDelta >= 0 ? '#4ade80' : '#f87171' }}>
                        {act.ratingDelta > 0 ? '+' : ''}{act.ratingDelta}
                      </td>
                      <td style={{ ...td, color: '#fcd34d' }}>
                        {act.coinDelta > 0 ? '+' : ''}{act.coinDelta} 🪙
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} style={{ ...td, textAlign: 'center', color: 'var(--text-muted)' }}>No transactions or rating changes yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

      </section>
    </main>
  );
}

// 📱 CSS
const page: CSSProperties = { minHeight: '100vh', width: '100%', maxWidth: '100vw', overflowX: 'hidden', padding: 'clamp(16px, 4vw, 32px)', fontFamily: 'Inter, Arial, sans-serif', color: 'var(--text-main)', background: 'transparent', boxSizing: 'border-box' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 };
const brand: CSSProperties = { color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 900, fontSize: 18 };
const ghost: CSSProperties = { padding: '11px 16px', borderRadius: 999, border: '1px solid var(--button-ghost-border)', background: 'var(--button-ghost-bg)', color: 'var(--text-main)', cursor: 'pointer', fontWeight: 'bold' };
const primary: CSSProperties = { display: 'inline-block', padding: '12px 24px', borderRadius: 999, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', textDecoration: 'none', fontWeight: 900, border: 'none', textAlign: 'center' };
const hero: CSSProperties = { padding: 'clamp(20px, 4vw, 30px)', borderRadius: 30, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'center', flexWrap: 'wrap-reverse', boxSizing: 'border-box', overflow: 'hidden' };
const eyebrow: CSSProperties = { color: 'var(--accent-primary)', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase', margin: 0 };
const avatar: CSSProperties = { width: 'clamp(80px, 20vw, 110px)', height: 'clamp(80px, 20vw, 110px)', borderRadius: 999, border: '3px solid var(--accent-glow)', objectFit: 'cover' };
const grid: CSSProperties = { marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 18 };
const card: CSSProperties = { flex: '1 1 300px', minWidth: 0, padding: 'clamp(16px, 4vw, 24px)', borderRadius: 26, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', boxShadow: '0 24px 70px rgba(0,0,0,.1)', boxSizing: 'border-box', overflow: 'hidden' };
const input: CSSProperties = { width: '100%', padding: 14, borderRadius: 14, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-main)', outline: 'none', boxSizing: 'border-box' };
const th: CSSProperties = { padding: '16px 20px', color: 'var(--text-muted)', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 };
const td: CSSProperties = { padding: '16px 20px', fontSize: 14 };