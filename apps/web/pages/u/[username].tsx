import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import ActivityHeatmap from '../../components/ActivityHeatmap';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

interface ContributionDay {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

function getRatingColor(rating: number) {
  if (rating < 1200) return '#94a3b8'; // Newbie
  if (rating < 1400) return '#4ade80'; // Pupil
  if (rating < 1600) return '#22d3ee'; // Specialist
  if (rating < 1900) return '#3b82f6'; // Expert
  if (rating < 2200) return '#a855f7'; // Candidate Master
  return '#ef4444'; // Master
}

function getRatingTitle(rating: number) {
  if (rating < 1200) return 'Newbie';
  if (rating < 1400) return 'Pupil';
  if (rating < 1600) return 'Specialist';
  if (rating < 1900) return 'Expert';
  if (rating < 2200) return 'Candidate Master';
  return 'Master';
}

function transformSubmissionsToHeatmap(submissions: any[]): ContributionDay[] {
  if (!submissions || submissions.length === 0) return [];

  const submissionsByDate: Record<string, number> = {};
  submissions.forEach(submission => {
    const date = new Date(submission.timestamp || submission.createdAt || submission.date).toISOString().split('T')[0];
    submissionsByDate[date] = (submissionsByDate[date] || 0) + 1;
  });

  const counts = Object.values(submissionsByDate);
  const maxCount = Math.max(...counts, 1);
  
  return Object.entries(submissionsByDate).map(([date, count]) => ({
    date,
    count,
    level: Math.min(4, Math.floor((count / maxCount) * 4)) as 0 | 1 | 2 | 3 | 4
  }));
}

export default function PublicProfile() {
  const router = useRouter();
  const { username } = router.query;
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!router.isReady || !username) return;
    
    fetch(`${API_BASE_URL}/api/v2/profile/u/${username}`)
      .then(res => {
        if (!res.ok) throw new Error('Coder not found');
        return res.json();
      })
      .then(data => {
        setProfile(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [username, router.isReady]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-main)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--accent-primary)' }}>
        <h2>Loading Profile...</h2>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-main)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#f87171', padding: 20, textAlign: 'center' }}>
        <h1 style={{ fontSize: 'clamp(48px, 10vw, 72px)', margin: 0 }}>404</h1>
        <p style={{ color: 'var(--text-muted)' }}>User "{username}" does not exist in the system database.</p>
        <button onClick={() => router.push('/')} style={{ marginTop: 20, background: 'var(--button-ghost-bg)', border: '1px solid var(--button-ghost-border)', color: 'var(--text-main)', padding: '12px 24px', borderRadius: 999, fontWeight: 'bold', cursor: 'pointer' }}>
          Return Home
        </button>
      </div>
    );
  }

  const ratingColor = getRatingColor(profile.rating || 0);
  const displayName = profile.name || profile.username || 'DivineCode User';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-main-gradient)', backgroundColor: 'var(--bg-main)', color: 'var(--text-main)', fontFamily: 'Inter, sans-serif', paddingBottom: 60, boxSizing: 'border-box' }}>
      <Head>
        <title>{displayName} (@{profile.username}) - DivineCode</title>
      </Head>

      <div style={{ width: '100%', height: 200, background: `linear-gradient(to right, var(--bg-panel-solid), ${ratingColor}30)` }} />
      
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '0 max(16px, 4vw)', marginTop: -60 }}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', marginBottom: 40, flexWrap: 'wrap' }}>
          <div style={{ width: 120, height: 120, borderRadius: '50%', background: 'var(--bg-panel-solid)', border: `4px solid ${ratingColor}`, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: 48, fontWeight: 'bold', color: ratingColor, boxShadow: `0 0 20px ${ratingColor}40`, flexShrink: 0 }}>
            {(profile.name || profile.username || 'D').charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 200, flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 'clamp(24px, 5vw, 36px)', color: 'var(--text-main)', fontWeight: 900 }}>{displayName}</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 18 }}>@{profile.username}</p>
          </div>
          <button onClick={() => router.push('/')} style={{ background: 'var(--button-ghost-bg)', border: '1px solid var(--button-ghost-border)', color: 'var(--text-main)', padding: '10px 20px', borderRadius: 999, fontWeight: 'bold', cursor: 'pointer', height: 'fit-content' }}>
            ← Main Room
          </button>
        </div>

        {/* 👉 FIXED: Replaced rigid grid-template structure with fluid adaptive wrapping arrays */}
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 24 }}>
          
          {/* Left Column Section: Cards Meta block */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: '1 1 300px', minWidth: 280 }}>
            <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', backdropFilter: 'blur(12px)', borderRadius: 20, padding: 24 }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontWeight: 'bold' }}>Global Rating</div>
              <div style={{ fontSize: 42, fontWeight: 900, color: ratingColor, lineHeight: 1 }}>{profile.rating || 1200}</div>
              <div style={{ color: ratingColor, fontWeight: 700, marginTop: 6, fontSize: 15 }}>{getRatingTitle(profile.rating || 1200)}</div>
            </div>

            <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', backdropFilter: 'blur(12px)', borderRadius: 20, padding: 24 }}>
              <h3 style={{ margin: '0 0 16px', color: 'var(--text-main)', fontSize: 16, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>Platform Stats</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)' }}>Problems Solved</span>
                <strong style={{ color: 'var(--text-main)' }}>{profile.stats?.totalAccepted || 0}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)' }}>Total Submissions</span>
                <strong style={{ color: 'var(--text-main)' }}>{profile.stats?.totalAttempts || 0}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Accuracy</span>
                <strong style={{ color: '#4ade80' }}>{profile.stats?.accuracy || 0}%</strong>
              </div>
            </div>

            {profile.externalHandles && profile.externalHandles.length > 0 && (
              <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', backdropFilter: 'blur(12px)', borderRadius: 20, padding: 24 }}>
                <h3 style={{ margin: '0 0 16px', color: 'var(--text-main)', fontSize: 16, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>External Handles</h3>
                {profile.externalHandles.map((handle: any) => (
                  <div key={handle.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, borderBottom: '1px solid var(--border-color)', paddingBottom: 8 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{handle.platform}</span>
                    <strong style={{ color: 'var(--accent-primary)' }}>{handle.handle}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Column Section: Heatmap array and Interactive Standings list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, flex: '2 1 550px', minWidth: 320 }}>
            <ActivityHeatmap data={transformSubmissionsToHeatmap(profile.submissions || [])} />

            <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', backdropFilter: 'blur(12px)', borderRadius: 20, padding: 24, overflowX: 'auto' }}>
              <h2 style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 800, color: 'var(--text-main)' }}>Contest History</h2>
              
              {profile.matchHistory && profile.matchHistory.length > 0 ? (
                <div style={{ width: '100%', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 500 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        <th style={{ padding: '12px 8px' }}>Contest</th>
                        <th style={{ padding: '12px 8px' }}>Rank</th>
                        <th style={{ padding: '12px 8px' }}>Solved</th>
                        <th style={{ padding: '12px 8px' }}>Δ Rating</th>
                        <th style={{ padding: '12px 8px' }}>🪙 Coins</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.matchHistory.map((match: any, i: number) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer', transition: 'background 0.2s' }} onClick={() => router.push(`/contests/${match.contestId}`)} onMouseEnter={(e) => e.currentTarget.style.background = 'var(--table-hover)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                          <td style={{ padding: '16px 8px', color: 'var(--text-main)', fontWeight: 600 }}>{match.contestName}</td>
                          <td style={{ padding: '16px 8px', color: 'var(--text-main)' }}>#{match.rank}</td>
                          <td style={{ padding: '16px 8px', color: 'var(--text-main)' }}>{match.solved}</td>
                          <td style={{ padding: '16px 8px', fontWeight: 'bold', color: match.ratingDelta > 0 ? '#4ade80' : match.ratingDelta < 0 ? '#f87171' : 'var(--text-muted)' }}>
                            {match.ratingDelta > 0 ? '+' : ''}{match.ratingDelta}
                          </td>
                          <td style={{ padding: '16px 8px', fontWeight: 'bold', color: '#fbbf24' }}>
                            +{match.coinsEarned || 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                  This user hasn't participated in any rated contests yet.
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}