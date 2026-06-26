import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import { fetchApi } from '../lib/api';

function getRatingColor(rating: number) {
  if (rating < 1200) return '#94a3b8'; 
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
    <div style={{ minHeight: '100vh', background: '#020617', color: '#eef2ff', fontFamily: 'Inter, sans-serif', padding: '40px 20px' }}>
      <Head>
        <title>Global Leaderboard - DivineCode</title>
      </Head>

      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 30 }}>
          <div>
            <button onClick={() => router.push('/')} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', marginBottom: 10, fontSize: 14, padding: 0 }}>
              ← Back to Arena
            </button>
            <h1 style={{ margin: 0, fontSize: 36, letterSpacing: '-0.02em', background: 'linear-gradient(135deg, #a5b4fc, #22d3ee)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Global Leaderboard
            </h1>
            <p style={{ color: '#94a3b8', margin: '8px 0 0 0' }}>Top 100 competitive programmers ranked by Elo rating.</p>
          </div>
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
          
          {loading ? (
            <div style={{ padding: '60px', textAlign: 'center', color: '#64748b' }}>Calculating global standings...</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(2, 6, 23, 0.5)', borderBottom: '1px solid #1e293b' }}>
                  <th style={{ padding: '16px 24px', color: '#64748b', fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>#</th>
                  <th style={{ padding: '16px 24px', color: '#64748b', fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>Coder</th>
                  <th style={{ padding: '16px 24px', color: '#64748b', fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>Rating</th>
                  <th style={{ padding: '16px 24px', color: '#64748b', fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>Accepted</th>
                  <th style={{ padding: '16px 24px', color: '#64748b', fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>Matches</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user, index) => {
                  const ratingColor = getRatingColor(user.rating);
                  // 👉 FIXED: Ensure it handles users who have signed up but haven't chosen a username yet.
                  const hasUsername = Boolean(user.username && !user.username.startsWith('user_'));
                  
                  return (
                    <motion.tr 
                      key={user.id} 
                      whileHover={{ backgroundColor: hasUsername ? 'rgba(30, 41, 59, 0.8)' : 'transparent' }}
                      style={{ borderBottom: '1px solid #1e293b', transition: 'background-color 0.2s', cursor: hasUsername ? 'pointer' : 'default' }}
                      onClick={() => {
                        if (hasUsername) router.push(`/u/${user.username}`);
                      }}
                    >
                      <td style={{ padding: '16px 24px', color: '#94a3b8', fontWeight: 'bold' }}>
                        {index + 1}
                      </td>
                      <td style={{ padding: '16px 24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#020617', border: `2px solid ${ratingColor}`, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: 14, fontWeight: 'bold', color: ratingColor }}>
                            {user.name?.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ color: ratingColor, fontWeight: 600, fontSize: 15 }}>{user.name}</div>
                            <div style={{ color: '#64748b', fontSize: 13 }}>
                              {hasUsername ? `@${user.username}` : <span style={{ fontStyle: 'italic' }}>Handle not claimed</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '16px 24px', fontWeight: 'bold', color: ratingColor, fontSize: 18 }}>
                        {user.rating}
                      </td>
                      <td style={{ padding: '16px 24px', color: '#e2e8f0' }}>
                        {user._count.submissions} <span style={{ color: '#64748b', fontSize: 12 }}>solves</span>
                      </td>
                      <td style={{ padding: '16px 24px', color: '#e2e8f0' }}>
                        {user._count.contestParticipants}
                      </td>
                    </motion.tr>
                  );
                })}
                
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                      No coders have joined the arena yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </motion.div>
      </div>
    </div>
  );
}