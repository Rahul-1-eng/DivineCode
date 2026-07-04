/**
 * @file final.tsx
 * @author Rahul Kumar Sahoo
 * @description Page-level experience and view logic.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { fetchApi } from '../../../lib/api';

// --- Structural Interfaces ---
interface ContestResultPayload {
  contestId: string;
  contestName: string;
  date: string;
  isRated: boolean;
  rank: number | string;
  solved: number;
  score: number;
  ratingDelta: number;
  ratingAfter: number;
}

export default function ContestResolutionDashboard() {
  const router = useRouter();
  const { id } = router.query;
  const { data: session, status } = useSession();
  
  const [result, setResult] = useState<ContestResultPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState(false);

  useEffect(() => {
    if (!id || status !== 'authenticated') {
      if (status === 'unauthenticated') router.push('/signin');
      return;
    }

    let isMounted = true;
    
    // Leverage the existing unified profile endpoint we created in the backend
    // to locate the precise structural rating snapshot for this specific contest.
    fetchApi('/api/v2/profile/me')
      .then(data => {
        if (!isMounted) return;
        const historyStream = data.matchHistory || [];
        const specificMatch = historyStream.find((m: ContestResultPayload) => m.contestId === id);
        
        if (specificMatch) {
          setResult(specificMatch);
        } else {
          setErrorState(true);
        }
      })
      .catch(() => {
        if (isMounted) setErrorState(true);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, [id, status, router]);

  if (loading) {
    return (
      <main style={STYLES.loaderPane}>
        <div style={STYLES.spinner} />
        <div style={{ marginTop: 20, color: '#64748b', fontSize: 14 }}>Aggregating Evaluation Matrix...</div>
        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </main>
    );
  }

  if (errorState || !result) {
    return (
      <main style={STYLES.loaderPane}>
        <div style={STYLES.errorCard}>
          <h2 style={{ margin: '0 0 10px', color: '#f87171' }}>Evaluation Incomplete</h2>
          <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 20 }}>
            The resolution engine has not finalized the ratings for this matrix yet, or you did not participate officially.
          </p>
          <button onClick={() => router.push(`/contests/${id}`)} style={STYLES.primaryBtn}>Return to Contest Hub</button>
        </div>
      </main>
    );
  }

  const isPositiveShift = result.ratingDelta > 0;
  const isNeutralShift = result.ratingDelta === 0;

  return (
    <main style={STYLES.page}>
      <div style={STYLES.container}>
        
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={STYLES.statusBadge}>Evaluation Matrix Finalized</div>
          <h1 style={{ fontSize: 'clamp(28px, 5vw, 42px)', margin: '15px 0 5px' }}>{result.contestName}</h1>
          <p style={{ color: '#94a3b8', fontSize: 16 }}>Performance Summary generated on {new Date(result.date).toLocaleDateString()}</p>
        </div>

        {/* Global Elo Shift Card */}
        <section style={STYLES.heroCard}>
          <div style={{ fontSize: 14, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 15 }}>Global Rating Shift</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 30, flexWrap: 'wrap' }}>
            
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 48, fontWeight: 900, color: '#e2e8f0' }}>{result.ratingAfter - result.ratingDelta}</div>
              <div style={{ color: '#64748b', fontSize: 13 }}>Old Rating</div>
            </div>

            <div style={{ fontSize: 32, color: '#334155' }}>→</div>

            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 48, fontWeight: 900, color: isPositiveShift ? '#4ade80' : isNeutralShift ? '#e2e8f0' : '#f87171' }}>
                {result.ratingAfter}
              </div>
              <div style={{ color: '#64748b', fontSize: 13 }}>New Rating</div>
            </div>
            
          </div>
          
          <div style={{ ...STYLES.deltaChip, background: isPositiveShift ? 'rgba(74,222,128,0.15)' : isNeutralShift ? 'rgba(148,163,184,0.1)' : 'rgba(248,113,113,0.15)', color: isPositiveShift ? '#4ade80' : isNeutralShift ? '#cbd5e1' : '#f87171', border: `1px solid ${isPositiveShift ? 'rgba(74,222,128,0.3)' : isNeutralShift ? 'rgba(148,163,184,0.3)' : 'rgba(248,113,113,0.3)'}` }}>
            {isPositiveShift ? `+${result.ratingDelta}` : result.ratingDelta}
          </div>
        </section>

        {/* Gamification & Execution Metrics */}
        <div style={STYLES.metricsGrid}>
          <div style={STYLES.metricCard}>
            <div style={STYLES.metricLabel}>Global Rank</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: '#22d3ee' }}>
              {result.rank !== '-' ? `#${result.rank}` : 'Unranked'}
            </div>
          </div>
          <div style={STYLES.metricCard}>
            <div style={STYLES.metricLabel}>Vectors Solved</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: '#a5b4fc' }}>
              {result.solved}
            </div>
          </div>
          <div style={STYLES.metricCard}>
            <div style={STYLES.metricLabel}>Platform Coins Granted</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: '#fbbf24' }}>
              +{result.score}
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <button onClick={() => router.push('/profile')} style={STYLES.secondaryBtn}>View Global Trajectory</button>
        </div>

      </div>
    </main>
  );
}

// -----------------------------------------------------------------------------
// Component Styles Dictionary
// -----------------------------------------------------------------------------
const STYLES: Record<string, React.CSSProperties> = {
  loaderPane: { height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#070a16' },
  spinner: { width: 50, height: 50, borderTop: '3px solid #22d3ee', borderRadius: '50%', animation: 'spin 1s linear infinite' },
  errorCard: { background: '#0f172a', padding: 40, borderRadius: 24, border: '1px solid #1e293b', textAlign: 'center', maxWidth: 450 },
  page: { minHeight: '100vh', padding: 'clamp(20px, 5vw, 60px)', background: 'radial-gradient(circle at top, rgba(99,102,241,0.15), transparent 40rem), #070a16', color: '#eef2ff', fontFamily: 'Inter, sans-serif' },
  container: { maxWidth: 800, margin: '0 auto' },
  statusBadge: { display: 'inline-block', background: 'rgba(34,211,238,0.1)', color: '#22d3ee', padding: '6px 14px', borderRadius: 99, fontSize: 13, fontWeight: 'bold', border: '1px solid rgba(34,211,238,0.2)' },
  heroCard: { background: 'rgba(15,23,42,0.8)', padding: 40, borderRadius: 30, border: '1px solid rgba(148,163,184,0.15)', textAlign: 'center', position: 'relative', overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.3)' },
  deltaChip: { display: 'inline-block', marginTop: 30, padding: '8px 20px', borderRadius: 99, fontSize: 20, fontWeight: 900 },
  metricsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginTop: 20 },
  metricCard: { background: 'rgba(15,23,42,0.6)', padding: 30, borderRadius: 24, border: '1px solid rgba(148,163,184,0.1)', textAlign: 'center' },
  metricLabel: { fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, fontWeight: 'bold' },
  primaryBtn: { background: '#22d3ee', color: '#020617', padding: '12px 24px', borderRadius: 99, fontWeight: 900, border: 'none', cursor: 'pointer', fontSize: 14 },
  secondaryBtn: { background: 'transparent', border: '1px solid #334155', color: '#94a3b8', padding: '12px 24px', borderRadius: 99, fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s' }
};