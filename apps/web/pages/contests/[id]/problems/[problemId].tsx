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

  if (status === 'loading') return <main style={page}>Checking account...</main>;
  if (!session) return <main style={page}><section style={panel}><h1>Sign in required</h1><a href="/signin" style={primary}>Sign in</a></section></main>;
  if (error) return <main style={page}><section style={panel}><h1>{error}</h1><a href="/contests" style={primary}>Back</a></section></main>;
  if (!contest || !problem) return <main style={page}>Loading problem...</main>;

  // 👉 FIX: Properly read the nested snapshot and URL fields for rendering!
  const actualTitle = problem.titleSnapshot || problem.problem?.title || `Problem ${label}`;
  const actualUrl = problem.externalUrl || problem.problem?.url;
  const actualRating = problem.problem?.rating || problem.rating || 'Practice';
  const tags = problem.problem?.tags || [];

  return (
    <main style={page}>
      <section style={{ maxWidth: 980, margin: '0 auto' }}>
        <nav style={nav}>
          <a href={`/contests/${id}`} style={link}>Back to contest</a>
          <div style={pill}>{session.user?.name || session.user?.email}</div>
        </nav>
        
        <section style={panel}>
          <p style={eyebrow}>Problem {label}</p>
          <h1>{canSeeMeta ? actualTitle : `Problem ${label}`}</h1>
          <p style={{ color: '#94a3b8' }}>
            {problem.platform}
            {canSeeMeta ? ` - Rating ${actualRating}${tags.length ? ` - ${tags.join(', ')}` : ''}` : ' - rating hidden'}
          </p>
          
          {isSolvedByTeam && (
            <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: 'rgba(74, 222, 128, 0.15)', border: '1px solid rgba(74, 222, 128, 0.3)', color: '#4ade80' }}>
              <strong>🎉 Awesome!</strong><br />
              Someone in your group has already solved this problem! 
            </div>
          )}

          <div style={actions}>
            {/* 👉 FIX: Use actualUrl derived from the database shape */}
            {actualUrl && <a href={actualUrl} target="_blank" rel="noreferrer" style={primary}>Open statement</a>}
            {isPlayer && !isSolvedByTeam && <a href={`/submit?contestId=${id}&problemId=${problem.id}`} style={primary}>Submit</a>}
          </div>
        </section>
        
        <section style={panel}>
          <h2>Visible contest details</h2>
          <div style={grid}>
            <span>Contest</span><strong>{contest.title}</strong>
            <span>Player</span><strong>{contest.viewerMember?.name || 'Not registered as player'}</strong>
            <span>Team</span><strong>{contest.viewerMember?.team || 'None'}</strong>
            <span>Metadata</span><strong>{canSeeMeta ? 'Visible' : 'Hidden during contest'}</strong>
          </div>
        </section>
      </section>
    </main>
  );
}

const page: CSSProperties = { minHeight: '100vh', padding: 28, fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.32), transparent 34rem), #070a16' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 24 };
const panel: CSSProperties = { padding: 26, borderRadius: 26, border: '1px solid rgba(148,163,184,.22)', background: 'rgba(15,23,42,.82)', marginBottom: 18 };
const link: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 900 };
const pill: CSSProperties = { padding: '10px 14px', borderRadius: 999, background: 'rgba(15,23,42,.82)', border: '1px solid rgba(148,163,184,.22)' };
const eyebrow: CSSProperties = { color: '#67e8f9', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase' };
const primary: CSSProperties = { display: 'inline-block', padding: '12px 17px', borderRadius: 999, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', textDecoration: 'none', fontWeight: 900 };
const actions: CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 20 };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12, color: '#cbd5e1' };