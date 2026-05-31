import { useEffect, useMemo, useState } from 'react';
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
  
  // 👉 NEW: Global Sound Preference Toggle
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

  // 1. Loading Authentication State
  if (status === 'loading') {
    return <main className="min-h-screen flex items-center justify-center bg-slate-950 text-white"><h1 className="text-2xl animate-pulse text-cyan-400 font-bold">Verifying Identity...</h1></main>;
  }

  // 2. Unauthenticated State
  if (!session) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
        <section className="max-w-md w-full p-8 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl text-center">
          <h1 className="text-3xl font-black text-white mb-2">Access Denied</h1>
          <p className="text-slate-400 mb-8">You must be signed in to view this problem.</p>
          <a href="/signin" className="inline-block px-8 py-3 rounded-full bg-gradient-to-r from-indigo-300 to-cyan-400 text-slate-950 font-black hover:scale-105 transition-transform">Sign In</a>
        </section>
      </main>
    );
  }

  // 3. Error State
  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
        <section className="max-w-md w-full p-8 rounded-3xl bg-slate-900 border border-red-900/50 shadow-2xl text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-6">{error}</h1>
          <a href="/contests" className="inline-block px-6 py-2 rounded-full border border-slate-700 text-white hover:bg-slate-800 transition-colors">← Back to Contests</a>
        </section>
      </main>
    );
  }

  // 👉 4. THE SKELETON LOADER (While fetching Codeforces/DB data)
  if (!contest || !problem) {
    return (
      <main className="min-h-screen p-4 md:p-8 bg-slate-950 text-white">
        <section className="max-w-4xl mx-auto">
          {/* Skeleton Nav */}
          <div className="flex justify-between items-center mb-8 animate-pulse">
            <div className="w-32 h-6 bg-slate-800 rounded"></div>
            <div className="w-40 h-10 bg-slate-800 rounded-full"></div>
          </div>
          {/* Skeleton Main Panel */}
          <div className="p-6 md:p-8 rounded-3xl border border-slate-800 bg-slate-900/50 mb-6 animate-pulse">
            <div className="w-24 h-4 bg-slate-800 rounded mb-4"></div>
            <div className="w-3/4 h-10 bg-slate-700 rounded mb-4"></div>
            <div className="w-1/2 h-4 bg-slate-800 rounded mb-8"></div>
            <div className="flex gap-4">
              <div className="w-32 h-12 bg-slate-700 rounded-full"></div>
              <div className="w-32 h-12 bg-slate-700 rounded-full"></div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  // Variables for rendering
  const actualTitle = problem.titleSnapshot || problem.problem?.title || `Problem ${label}`;
  const actualUrl = problem.externalUrl || problem.problem?.url;
  const actualRating = problem.problem?.rating || problem.rating || 'Practice';
  const tags = problem.problem?.tags || [];

  return (
    <main className="min-h-screen p-4 md:p-8 font-sans text-indigo-50 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,.15),transparent_36rem),#070a16]">
      <section className="max-w-5xl mx-auto">
        
        {/* Navigation & Settings */}
        <nav className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <a href={`/contests/${id}`} className="text-cyan-400 font-black hover:text-cyan-300 transition-colors flex items-center gap-2">
            <span>←</span> Back to Standings
          </a>
          
          <div className="flex items-center gap-4 self-end md:self-auto">
            {/* Sound Toggle Button */}
            <button 
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-slate-700 bg-slate-900 hover:bg-slate-800 transition-colors text-sm"
            >
              {soundEnabled ? '🔊 Sound On' : '🔇 Muted'}
            </button>
            <div className="px-4 py-2 rounded-full bg-slate-900 border border-slate-700 text-sm font-bold">
              {session.user?.name || session.user?.email}
            </div>
          </div>
        </nav>
        
        {/* Problem Header Panel */}
        <section className="p-6 md:p-10 rounded-3xl border border-slate-800 bg-slate-900/80 shadow-2xl backdrop-blur-sm mb-6">
          <p className="text-cyan-400 font-black tracking-widest uppercase text-sm mb-2">Problem {label}</p>
          <h1 className="text-3xl md:text-5xl font-black mb-4 leading-tight">{canSeeMeta ? actualTitle : `Problem ${label}`}</h1>
          
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400 mb-8">
            <span className="px-3 py-1 bg-slate-950 rounded border border-slate-800">{problem.platform}</span>
            {canSeeMeta ? (
              <>
                <span className="px-3 py-1 bg-indigo-950/50 text-indigo-300 rounded border border-indigo-900/50">Rating {actualRating}</span>
                {tags.map((tag: string) => (
                  <span key={tag} className="px-3 py-1 bg-slate-800/50 rounded">{tag}</span>
                ))}
              </>
            ) : (
              <span className="px-3 py-1 bg-slate-800/50 rounded">Metadata hidden</span>
            )}
          </div>
          
          {/* Solved State UI */}
          {isSolvedByTeam && (
            <div className="mb-8 p-4 md:p-6 rounded-2xl bg-emerald-950/30 border border-emerald-900/50 text-emerald-400 flex items-start gap-4">
              <span className="text-2xl">🎉</span>
              <div>
                <strong className="block text-lg mb-1">Awesome work!</strong>
                <span className="opacity-90">Someone in your group has already solved this problem.</span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col md:flex-row gap-4">
            {actualUrl && (
              <a href={actualUrl} target="_blank" rel="noreferrer" className="text-center px-8 py-4 rounded-full border border-cyan-800 bg-cyan-950/30 hover:bg-cyan-900 text-cyan-100 font-bold transition-colors">
                Open Statement ↗
              </a>
            )}
            
            {/* If player hasn't solved it, show primary submit button */}
            {isPlayer && !isSolvedByTeam && (
              <a href={`/submit?contestId=${id}&problemId=${problem.id}`} className="text-center px-8 py-4 rounded-full bg-gradient-to-r from-indigo-400 to-cyan-400 text-slate-950 font-black hover:scale-105 transition-transform shadow-lg shadow-cyan-900/20">
                Code & Submit ⚡
              </a>
            )}
          </div>
        </section>
        
        {/* Match Details Panel */}
        <section className="p-6 md:p-8 rounded-3xl border border-slate-800 bg-slate-900/60">
          <h2 className="text-xl font-bold mb-6 text-white">Contest Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8 text-sm">
            <div className="flex flex-col border-b border-slate-800 md:border-none pb-2 md:pb-0">
              <span className="text-slate-500 mb-1">Contest Name</span>
              <strong className="text-indigo-100">{contest.title}</strong>
            </div>
            <div className="flex flex-col border-b border-slate-800 md:border-none pb-2 md:pb-0">
              <span className="text-slate-500 mb-1">Player Status</span>
              <strong className="text-indigo-100">{contest.viewerMember?.name || 'Observer (Not registered)'}</strong>
            </div>
            <div className="flex flex-col border-b border-slate-800 md:border-none pb-2 md:pb-0">
              <span className="text-slate-500 mb-1">Team Affiliation</span>
              <strong className="text-indigo-100">{contest.viewerMember?.team || 'Individuals'}</strong>
            </div>
            <div className="flex flex-col">
              <span className="text-slate-500 mb-1">Problem Meta</span>
              <strong className="text-indigo-100">{canSeeMeta ? 'Visible' : 'Hidden for fairness'}</strong>
            </div>
          </div>
        </section>

      </section>
    </main>
  );
}