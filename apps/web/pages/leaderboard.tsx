import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import { fetchApi } from '../lib/api';

function getRatingColor(rating: number) {
  if (rating < 1200) return 'var(--text-muted)'; 
  if (rating < 1400) return '#4ade80'; 
  if (rating < 1600) return '#22d3ee'; 
  if (rating < 1900) return '#3b82f6'; 
  if (rating < 2200) return '#a855f7'; 
  return '#ef4444';    
}

export default function Leaderboard() {
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApi('/api/v2/leaderboard', { requireAuth: false })
      .then(data => {
        setUsers(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to load leaderboard", err);
        setLoading(false);
      });
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-main-gradient)', backgroundColor: 'var(--bg-main)', color: 'var(--text-main)', fontFamily: 'Inter, sans-serif', padding: 'clamp(20px, 5vw, 40px) clamp(16px, 4vw, 20px)' }}>
      <Head>
        <title>Global Leaderboard - DivineCode</title>
      </Head>

      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 30, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <button onClick={() => router.push('/')} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginBottom: 10, fontSize: 14, padding: 0, fontWeight: 'bold' }}>
              ← Back to Arena
            </button>
            <h1 style={{ margin: 0, fontSize: 'clamp(28px, 6vw, 36px)', letterSpacing: '-0.02em', background: 'linear-gradient(135deg, var(--accent-primary), #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 900 }}>
              Global Leaderboard
            </h1>
            <p style={{ color: 'var(--text-muted)', margin: '8px 0 0 0' }}>Top 100 competitive programmers ranked by Elo rating.</p>
          </div>
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ background: 'var(--bg-panel)', backdropFilter: 'blur(12px)', border: '1px solid var(--border-color)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.2)' }}>
          
          {loading ? (
            <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>Calculating global standings...</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 600 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-panel-solid)', borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '16px 24px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>#</th>
                    <th style={{ padding: '16px 24px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>Coder</th>
                    <th style={{ padding: '16px 24px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>Rating</th>
                    <th style={{ padding: '16px 24px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>Accepted</th>
                    <th style={{ padding: '16px 24px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>Matches</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user, index) => {
                    const ratingColor = getRatingColor(user.rating);
                    const hasUsername = Boolean(user.username && !user.username.startsWith('user_'));
                    
                    return (
                      <motion.tr 
                        key={user.id} 
                        whileHover={{ backgroundColor: hasUsername ? 'var(--table-hover)' : 'transparent' }}
                        style={{ borderBottom: '1px solid var(--border-color)', transition: 'background-color 0.2s', cursor: hasUsername ? 'pointer' : 'default' }}
                        onClick={() => {
                          if (hasUsername) router.push(`/u/${user.username}`);
                        }}
                      >
                        <td style={{ padding: '16px 24px', color: 'var(--text-muted)', fontWeight: 'bold' }}>
                          {index + 1}
                        </td>
                        <td style={{ padding: '16px 24px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-panel-solid)', border: `2px solid ${ratingColor}`, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: 14, fontWeight: 'bold', color: ratingColor }}>
                              {user.name?.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div style={{ color: ratingColor, fontWeight: 600, fontSize: 15 }}>{user.name}</div>
                              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                                {hasUsername ? `@${user.username}` : <span style={{ fontStyle: 'italic' }}>Handle not claimed</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '16px 24px', fontWeight: 'bold', color: ratingColor, fontSize: 18 }}>
                          {user.rating}
                        </td>
                        <td style={{ padding: '16px 24px', color: 'var(--text-main)' }}>
                          {user._count.submissions} <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>solves</span>
                        </td>
                        <td style={{ padding: '16px 24px', color: 'var(--text-main)' }}>
                          {user._count.contestParticipants}
                        </td>
                      </motion.tr>
                    );
                  })}
                  
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No coders have joined the arena yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}