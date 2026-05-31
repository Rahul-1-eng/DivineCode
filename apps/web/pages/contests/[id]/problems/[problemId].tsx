import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';

export async function getServerSideProps() { return { props: {} }; }

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

function viewerQuery(session: any) {
  const query = new URLSearchParams();
  if (session?.user?.email) query.set('viewerEmail', session.user.email);
  if (session?.user?.name) query.set('viewerName', session.user.name);
  const value = query.toString();
  return value ? `?${value}` : '';
}

export default function ContestProblemPage() {
  const router = useRouter();
  const { id, problemId } = router.query;
  const { data: session, status } = useSession();
  
  const [contest, setContest] = useState<any>(null);
  const [error, setError] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);

  useEffect(() => {
    if (!id || status === 'loading') return;
    fetch(`${API_V2_BASE_URL}/contests/${id}${viewerQuery(session)}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) { setError(data.error || 'Contest not found'); return; }
        setContest(data);
      })
      .catch(() => setError('Could not load contest'));
  }, [id, session?.user?.email, session?.user?.name, status]);

  const problemIndex = useMemo(() => (contest?.problems || []).findIndex((p: any) => p.id === problemId), [contest, problemId]);
  const problem = problemIndex >= 0 ? contest.problems[problemIndex] : null;
  const label = problemIndex >= 0 ? String.fromCharCode(65 + problemIndex) : '';
  const canSeeMeta = Boolean(contest?.visibility?.canSeeProblemMeta);
  const isPlayer = Boolean(contest?.viewerMember || contest?.canManage);

  const isSolvedByTeam = useMemo(() => {
    if (!contest || !contest.standings || !contest.viewerMember || !problemId) return false;
    const myTeam = contest.viewerMember.team;
    return contest.standings.some((row: any) => {
      const member = (contest.members || []).find((m: any) => m.id === row.memberId);
      const isMe = row.memberId === contest.viewerMember.id;
      const isMyTeam = myTeam && myTeam !== 'Individuals' && member?.team === myTeam;
      return (isMe || isMyTeam) && (row.solvedProblems || []).includes(problemId);
    });
  }, [contest, problemId]);

  if (status === 'loading') return <main style={page}><div style={centerText}><h1 style={{color: '#67e8f9'}}>Verifying Identity...</h1></div></main>;
  if (!session) return <main style={page}><section style={gate}><h1>Access Denied</h1><p style={{ color: '#a8b3c7' }}>You must be signed in to view this problem.</p><a href="/signin" style={primaryBtn}>Sign In</a></section></main>;
  if (error) return <main style={page}><section style={gate}><h1 style={{ color: '#f87171' }}>{error}</h1><a href="/contests" style={ghostBtn}>← Back to Contests</a></section></main>;
  
  // 👉 THE SKELETON LOADER
  if (!contest || !problem) return (
    <main style={page}>
      <section style={{ maxWidth: 980, margin: '0 auto' }}>
        <div style={{ ...panel, opacity: 0.6 }}>
          <h2 style={{ color: '#67e8f9', margin: '0 0 10px 0' }}>Fetching problem data...</h2>
          <div style={{ height: 40, background: 'rgba(255,255,255,0.05)', borderRadius: 8, marginBottom: 15 }}></div>
          <div style={{ height: 20, width: '50%', background: 'rgba(255,255,255,0.05)', borderRadius: 8 }}></div>
        </div>
      </section>
    </main>
  );

  const actualTitle = problem.titleSnapshot || problem.problem?.title || `Problem ${label}`;
  const actualUrl = problem.externalUrl || problem.problem?.url;
  const actualRating = problem.problem?.rating || problem.rating || 'Practice';
  const tags = problem.problem?.tags || [];

  return (
    <main style={page}>
      <section style={{ maxWidth: 980, margin: '0 auto' }}>
        
        <nav style={nav}>
          <a href={`/contests/${id}`} style={link}>← Back to Standings</a>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button onClick={() => setSoundEnabled(!soundEnabled)} style={soundBtn}>
              {soundEnabled ? '🔊 Sound On' : '🔇 Muted'}
            </button>
            <div style={pill}>{session.user?.name || session.user?.email}</div>
          </div>
        </nav>
        
        <section style={panel}>
          <p style={eyebrow}>Problem {label}</p>
          <h1 style={{ fontSize: 'clamp(24px, 5vw, 36px)', margin: '10px 0' }}>{canSeeMeta ? actualTitle : `Problem ${label}`}</h1>
          
          <div style={tagContainer}>
            <span style={tagStyle}>{problem.platform}</span>
            {canSeeMeta ? (
              <>
                <span style={{ ...tagStyle, background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', borderColor: 'rgba(99,102,241,0.5)' }}>Rating {actualRating}</span>
                {tags.map((tag: string) => <span key={tag} style={tagStyle}>{tag}</span>)}
              </>
            ) : <span style={tagStyle}>Metadata hidden</span>}
          </div>
          
          {isSolvedByTeam && (
            <div style={successBox}>
              <strong style={{ display: 'block', fontSize: 18, marginBottom: 4 }}>🎉 Awesome work!</strong>
              Someone in your group has already solved this problem. 
            </div>
          )}

          <div style={actions}>
            {actualUrl && <a href={actualUrl} target="_blank" rel="noreferrer" style={primaryOutlined}>Open Statement ↗</a>}
            {isPlayer && !isSolvedByTeam && <a href={`/submit?contestId=${id}&problemId=${problem.id}`} style={primaryBtn}>Code & Submit ⚡</a>}
          </div>
        </section>
        
        <section style={{ ...panel, background: 'rgba(15,23,42,0.6)' }}>
          <h2 style={{ marginTop: 0, fontSize: 20 }}>Contest Details</h2>
          <div style={grid}>
            <div style={gridItem}><span style={gridLabel}>Contest Name</span><strong style={{ color: '#eef2ff' }}>{contest.title}</strong></div>
            <div style={gridItem}><span style={gridLabel}>Player Status</span><strong style={{ color: '#eef2ff' }}>{contest.viewerMember?.name || 'Observer (Not registered)'}</strong></div>
            <div style={gridItem}><span style={gridLabel}>Team Affiliation</span><strong style={{ color: '#eef2ff' }}>{contest.viewerMember?.team || 'Individuals'}</strong></div>
            <div style={gridItem}><span style={gridLabel}>Problem Meta</span><strong style={{ color: '#eef2ff' }}>{canSeeMeta ? 'Visible' : 'Hidden for fairness'}</strong></div>
          </div>
        </section>
      </section>
    </main>
  );
}

// RESTORED STYLES (Mobile Responsive)
const page: CSSProperties = { minHeight: '100vh', padding: '4vw', fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.32), transparent 34rem), #070a16', boxSizing: 'border-box' };
const centerText: CSSProperties = { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' };
const nav: CSSProperties = { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 24 };
const panel: CSSProperties = { padding: 'clamp(20px, 4vw, 32px)', borderRadius: 26, border: '1px solid rgba(148,163,184,.22)', background: 'rgba(15,23,42,.82)', marginBottom: 18, boxSizing: 'border-box', boxShadow: '0 24px 70px rgba(0,0,0,.3)' };
const gate: CSSProperties = { maxWidth: 620, margin: '15vh auto', padding: 34, borderRadius: 28, border: '1px solid rgba(148,163,184,.22)', background: 'rgba(15,23,42,.82)', textAlign: 'center' };
const link: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 900 };
const pill: CSSProperties = { padding: '10px 14px', borderRadius: 999, background: 'rgba(15,23,42,.82)', border: '1px solid rgba(148,163,184,.22)' };
const soundBtn: CSSProperties = { ...pill, background: '#0f172a', color: '#fff', cursor: 'pointer', fontSize: 14 };
const eyebrow: CSSProperties = { color: '#67e8f9', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', margin: 0 };
const tagContainer: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24 };
const tagStyle: CSSProperties = { padding: '6px 12px', background: 'rgba(2,6,23,0.5)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 6, fontSize: 13, color: '#94a3b8' };
const successBox: CSSProperties = { marginBottom: 24, padding: 16, borderRadius: 12, background: 'rgba(74, 222, 128, 0.15)', border: '1px solid rgba(74, 222, 128, 0.3)', color: '#4ade80' };
const actions: CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 20 };
const primaryBtn: CSSProperties = { display: 'inline-block', padding: '14px 22px', borderRadius: 999, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', textDecoration: 'none', fontWeight: 900, textAlign: 'center', flex: '1 1 auto', maxWidth: 300, cursor: 'pointer', border: 0 };
const primaryOutlined: CSSProperties = { ...primaryBtn, background: 'rgba(34,211,238,.1)', color: '#67e8f9', border: '1px solid rgba(34,211,238,.4)' };
const ghostBtn: CSSProperties = { padding: '10px 18px', borderRadius: 999, border: '1px solid rgba(148,163,184,.28)', background: 'transparent', color: '#dbeafe', cursor: 'pointer', textDecoration: 'none' };

// 👉 MOBILE FIX: FlexWrap instead of rigid columns
const grid: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 24, color: '#cbd5e1' };
const gridItem: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' };
const gridLabel: CSSProperties = { fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8' };