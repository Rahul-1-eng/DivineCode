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
      <div style={{ minHeight: '100vh', background: '#020617', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#22d3ee' }}>
        <h2>Loading Profile...</h2>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div style={{ minHeight: '100vh', background: '#020617', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#f87171' }}>
        <h1 style={{ fontSize: 48, margin: 0 }}>404</h1>
        <p>User "{username}" does not exist.</p>
        <button onClick={() => router.push('/')} style={{ marginTop: 20, background: '#334155', color: '#fff', padding: '10px 20px', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          Return Home
        </button>
      </div>
    );
  }

  const ratingColor = getRatingColor(profile.rating || 0);
  const displayName = profile.name || profile.username || 'DivineCode User';

  return (
    <div style={{ minHeight: '100vh', background: '#020617', color: '#eef2ff', fontFamily: 'Inter, sans-serif', paddingBottom: 60 }}>
      <Head>
        <title>{displayName} (@{profile.username}) - DivineCode</title>
      </Head>

      <div style={{ width: '100%', height: 200, background: `linear-gradient(to right, #0f172a, ${ratingColor}40)` }} />
      
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 20px', marginTop: -60 }}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', marginBottom: 40 }}>
          {/* 👉 FIXED: Added structural fallback to prevent undefined string manipulation crashes */}
          <div style={{ width: 120, height: 120, borderRadius: '50%', background: '#1e293b', border: `4px solid ${ratingColor}`, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: 48, fontWeight: 'bold', color: ratingColor, boxShadow: `0 0 20px ${ratingColor}40` }}>
            {(profile.name || profile.username || 'D').charAt(0).toUpperCase()}
          </div>
          <div style={{ paddingBottom: 10 }}>
            <h1 style={{ margin: 0, fontSize: 36 }}>{displayName}</h1>
            <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 18 }}>@{profile.username}</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 30 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 24 }}>
              <div style={{ fontSize: 14, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Global Rating</div>
              <div style={{ fontSize: 42, fontWeight: 'bold', color: ratingColor, lineHeight: 1 }}>{profile.rating || 0}</div>
              <div style={{ color: ratingColor, fontWeight: 600, marginTop: 4 }}>{getRatingTitle(profile.rating || 0)}</div>
            </div>

            <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 24 }}>
              <h3 style={{ margin: '0 0 16px', color: '#e2e8f0', fontSize: 16 }}>Platform Stats</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ color: '#94a3b8' }}>Problems Solved</span>
                <strong style={{ color: '#fff' }}>{profile.stats?.totalAccepted || 0}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ color: '#94a3b8' }}>Total Submissions</span>
                <strong style={{ color: '#fff' }}>{profile.stats?.totalAttempts || 0}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8' }}>Accuracy</span>
                <strong style={{ color: '#4ade80' }}>{profile.stats?.accuracy || 0}%</strong>
              </div>
            </div>

            {profile.externalHandles && profile.externalHandles.length > 0 && (
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 24 }}>
                <h3 style={{ margin: '0 0 16px', color: '#e2e8f0', fontSize: 16 }}>External Handles</h3>
                {profile.externalHandles.map((handle: any) => (
                  <div key={handle.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ color: '#94a3b8' }}>{handle.platform}</span>
                    <strong style={{ color: '#38bdf8' }}>{handle.handle}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
            <ActivityHeatmap data={transformSubmissionsToHeatmap(profile.submissions || [])} />

            <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 24 }}>
              <h2 style={{ margin: '0 0 20px', fontSize: 20 }}>Contest History</h2>
              
              {profile.matchHistory && profile.matchHistory.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8', fontSize: 14 }}>
                      <th style={{ padding: '12px 8px' }}>Contest</th>
                      <th style={{ padding: '12px 8px' }}>Rank</th>
                      <th style={{ padding: '12px 8px' }}>Solved</th>
                      <th style={{ padding: '12px 8px' }}>Δ Rating</th>
                      <th style={{ padding: '12px 8px' }}>💰 Coins</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.matchHistory.map((match: any, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid #1e293b', cursor: 'pointer' }} onClick={() => window.location.href = `/contests/${match.contestId}`}>
                        <td style={{ padding: '16px 8px', color: '#e2e8f0' }}>{match.contestName}</td>
                        <td style={{ padding: '16px 8px', color: '#e2e8f0' }}>{match.rank}</td>
                        <td style={{ padding: '16px 8px', color: '#e2e8f0' }}>{match.solved}</td>
                        <td style={{ padding: '16px 8px', fontWeight: 'bold', color: match.ratingDelta > 0 ? '#4ade80' : match.ratingDelta < 0 ? '#f87171' : '#94a3b8' }}>
                          {match.ratingDelta > 0 ? '+' : ''}{match.ratingDelta}
                        </td>
                        <td style={{ padding: '16px 8px', fontWeight: 'bold', color: '#fbbf24' }}>
                          +{match.coinsEarned || 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b' }}>
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