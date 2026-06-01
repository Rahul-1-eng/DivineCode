import { CSSProperties, Fragment, useEffect, useMemo, useRef, useState } from 'react';
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

function viewerHeaders(session: any) {
  return {
    'Content-Type': 'application/json',
    'x-user-email': session?.user?.email || '',
    'x-user-name': session?.user?.name || ''
  };
}

export default function ContestRoomPage() {
  const router = useRouter();
  const { id } = router.query;
  const isFinal = router.pathname.includes('/final');
  const { data: session, status } = useSession();
  
  const [contest, setContest] = useState<any>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<any>(null);
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState('Not synced yet');
  
  const [newProblemCode, setNewProblemCode] = useState('');
  const [newProblemPlatform, setNewProblemPlatform] = useState('Codeforces');
  const [reportReason, setReportReason] = useState('');
  const [overridePoints, setOverridePoints] = useState<number | ''>('');
  
  const syncingRef = useRef(false);

  const isOwner = Boolean(contest?.canManage);
  const viewerMember = contest?.viewerMember || null;
  const canSeeProblemMeta = Boolean(contest?.visibility?.canSeeProblemMeta);

  async function loadContest() {
    if (!id) return;
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}${viewerQuery(session)}`);
    const data = await res.json();
    if (!res.ok) { setError(data.error || 'Contest not found'); return; }
    
    if (!data.viewerMember && session?.user && (data.participants || data.members)) {
      const arr = data.participants || data.members || [];
      data.viewerMember = arr.find((p: any) => 
        (session.user?.email && p.user?.email === session.user?.email) || 
        (session.user?.name && p.displayName === session.user?.name) ||
        (session.user?.name && p.name === session.user?.name)
      );
    }
    
    setContest(data);
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(data.startTime).getTime()) / 1000));
    setTimeLeft(Math.max(0, data.durationMinutes * 60 - elapsed));
  }

  async function loadSubmissions() {
    if (!id) return;
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/submissions${viewerQuery(session)}`, { headers: viewerHeaders(session) });
    const data = await res.json();
    setSubmissions(Array.isArray(data) ? data : []);
  }

  async function syncCodeforces(silent = false) {
    if (!id || syncingRef.current || isFinal) return;
    syncingRef.current = true;
    if (!silent) setSyncing(true);
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/sync/codeforces`, { method: 'POST', headers: viewerHeaders(session) });
    const data = await res.json();
    syncingRef.current = false;
    setSyncing(false);
    if (!res.ok) { if (!silent) alert(data.error || 'Sync failed'); return; }
    await loadContest();
    await loadSubmissions();
    setLastSync(data.queued ? `${new Date().toLocaleTimeString()} - sync queued` : `${new Date().toLocaleTimeString()} - ${data.synced?.length || 0} accepted`);
    if (!silent) alert(data.queued ? 'Codeforces sync queued.' : `Synced ${data.synced?.length || 0} accepted submission(s).`);
  }

  async function extendTime(minutes: number) {
    if (!id || !session) return;
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/extend`, { method: 'POST', headers: viewerHeaders(session), body: JSON.stringify({ minutes }) });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Could not extend');
    setContest(data);
  }

  async function deleteContest() {
    if (!id || !session || !confirm('Delete this live mashup and its submissions?')) return;
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}`, { method: 'DELETE', headers: viewerHeaders(session) });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Could not delete contest');
    router.push('/contests');
  }

  async function lookupProblem(platform: string, code: string) {
    const res = await fetch(`${API_BASE_URL}/api/problems/lookup?platform=${encodeURIComponent(platform)}&code=${encodeURIComponent(code)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lookup failed');
    return data;
  }

  async function addProblem() {
    if (!id || !session || !newProblemCode.trim()) return alert('Enter a problem code.');
    try {
      const p = await lookupProblem(newProblemPlatform, newProblemCode);
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems`, { method: 'POST', headers: viewerHeaders(session), body: JSON.stringify(p) });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Could not add problem');
      setContest(data);
      setNewProblemCode('');
    } catch (e: any) { alert(e.message || 'Could not add problem'); }
  }

  async function removeProblem(problemId: string) {
    if (!id || !session || !confirm('Remove this problem from the live contest?')) return;
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems/${problemId}`, { method: 'DELETE', headers: viewerHeaders(session) });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Could not remove problem');
    setContest(data);
  }

  async function replaceProblem(problemId: string) {
    if (!id || !session) return;
    const code = prompt('Enter replacement Codeforces problem code, e.g. 1805A');
    if (!code) return;
    try {
      const p = await lookupProblem('Codeforces', code);
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems/${problemId}`, { method: 'PUT', headers: viewerHeaders(session), body: JSON.stringify(p) });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Could not replace problem');
      setContest(data);
    } catch (e: any) { alert(e.message || 'Could not replace problem'); }
  }

  async function submitReport() {
    if (!selectedSubmission || !reportReason.trim()) return;
    const res = await fetch(`${API_BASE_URL}/api/submissions/${selectedSubmission.id}/report`, {
      method: 'POST', headers: viewerHeaders(session), body: JSON.stringify({ reason: reportReason })
    });
    if (res.ok) { alert('Report submitted successfully to the contest owner.'); setReportReason(''); } 
    else { const data = await res.json(); alert(data.error || 'Failed to report submission'); }
  }
  
  async function finalizeContest() {
    if (!id || !session || !confirm('End this contest immediately and calculate final ratings/coins? This cannot be undone.')) return;
    setSyncing(true); 
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/finalize`, { method: 'POST', headers: viewerHeaders(session) });
    const data = await res.json();
    setSyncing(false);
    if (!res.ok) return alert(data.error || 'Could not finalize contest');
    alert(data.message);
    router.push(`/contests/${id}/final`);
  }

  async function submitOverride() {
    if (!selectedSubmission || overridePoints === '') return;
    const res = await fetch(`${API_BASE_URL}/api/submissions/${selectedSubmission.id}/override`, {
      method: 'POST', headers: viewerHeaders(session), body: JSON.stringify({ manualPoints: Number(overridePoints) })
    });
    if (res.ok) {
      alert('Points overridden successfully. Standings will recalculate instantly.');
      setSelectedSubmission(null);
      await loadSubmissions();
      await loadContest(); 
    } else {
      const data = await res.json(); alert(data.error || 'Failed to override points');
    }
  }

  useEffect(() => { loadContest(); loadSubmissions(); }, [id, session?.user?.email, session?.user?.name]);
  useEffect(() => { const timer = setInterval(() => setTimeLeft((prev) => Math.max(0, prev - 1)), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!id || !session || isFinal) return; const live = setInterval(() => { loadContest(); loadSubmissions(); syncCodeforces(true); }, 30000); return () => clearInterval(live); }, [id, session?.user?.email, session?.user?.name, isFinal]);
  useEffect(() => { if (!id || !contest || isFinal) return; if (timeLeft === 0) router.push(`/contests/${id}/final`); }, [timeLeft, id, contest, isFinal]);

  const problemById = useMemo(() => Object.fromEntries((contest?.problems || []).map((p: any, i: number) => [p.id, { ...p, label: String.fromCharCode(65 + i) }])), [contest]);
  
  const memberById = useMemo(() => Object.fromEntries(
    (contest?.members || contest?.participants || []).map((m: any) => [m.id, m])
  ), [contest]);
  
  const teamSolvedProblemIds = useMemo(() => {
    const solvedSet = new Set<string>();
    const myMemberInfo = contest?.viewerMember;
    if (!myMemberInfo) return solvedSet;
    const myTeam = myMemberInfo.team || myMemberInfo.teamName || 'Individuals';

    submissions.forEach((sub) => {
      const verdict = String(sub.verdict).toUpperCase();
      if (verdict === 'OK' || verdict === 'ACCEPTED') {
        const rowMemberId = sub.memberId || sub.participantId;
        const member = memberById[rowMemberId] || {};
        const subTeam = member.team || member.teamName || 'Individuals';
        if (rowMemberId === myMemberInfo.id || (myTeam !== 'Individuals' && subTeam === myTeam)) {
          solvedSet.add(sub.problemId);
        }
      }
    });
    return solvedSet;
  }, [contest, submissions, memberById]);

  const canInspectMember = (memberId: string) => {
    if (isOwner || isFinal || timeLeft === 0) return true;
    const member = memberById[memberId];
    return Boolean(viewerMember && (viewerMember.id === memberId || (viewerMember.team && viewerMember.team !== 'Individuals' && member?.team === viewerMember.team)));
  };

  // 👉 FIXED: Standings now securely calculate total scores dynamically from the problem points
  const teamStandings = useMemo(() => {
    const grouped: Record<string, any> = {};
    (contest?.standings || []).forEach((standing: any) => {
      const member = memberById[standing.memberId] || {};
      const team = member.teamName || member.team || 'Individuals';
      if (!grouped[team]) grouped[team] = { team, solved: 0, penalty: 0, score: 0, players: [] };
   
      // Ensure score calculates if backend falls back to 0
      let safeScore = standing.score || 0;
      if (safeScore === 0 && standing.solvedProblems) {
        safeScore = standing.solvedProblems.reduce((sum: number, pId: string) => sum + (problemById[pId]?.points || 1000), 0);
      }
      // Add this below your existing teamStandings useMemo
const individualStandings = useMemo(() => {
  return (contest?.standings || [])
    .sort((a: any, b: any) => a.rank - b.rank)
    .map((s: any) => ({
      ...s,
      name: memberById[s.memberId]?.name || 'Unknown',
      team: memberById[s.memberId]?.teamName || 'Individuals'
    }));
}, [contest, memberById]);
      grouped[team].solved += standing.solved || 0;
      grouped[team].penalty += standing.penalty || 0;
      grouped[team].score += safeScore;
      grouped[team].players.push({ ...standing, codeforcesHandle: member.codeforcesHandle, team, score: safeScore });
    });
    return Object.values(grouped).map((team: any) => ({ ...team, players: team.players.sort((a: any, b: any) => b.solved - a.solved || a.penalty - b.penalty) })).sort((a: any, b: any) => b.solved - a.solved || a.penalty - b.penalty || a.team.localeCompare(b.team));
  }, [contest, memberById, problemById]);

  const memberSubmissions = selectedMember ? submissions.filter((submission) => submission.memberId === selectedMember.memberId || submission.participantId === selectedMember.memberId) : [];

  if (status === 'loading') return <main style={page}><h1>Checking account...</h1></main>;
  if (!session) return <main style={page}><section style={gate}><h1>Sign in required</h1><p style={{ color: '#a8b3c7' }}>Sign in first.</p><a href="/signin" style={primaryLink}>Sign in with Google</a></section></main>;
  if (error) return <main style={page}><h1>{error}</h1><a href="/contests" style={link}>Back to contests</a></main>;
  if (!contest) return <main style={page}><h1>Loading contest...</h1></main>;

  return (
    <main style={page}>
      
      {/* 👉 NEW: Pop-Up Modal to view specific Player Submissions */}
      {selectedMember && (
        <div style={overlay}>
          <div style={{...overlayModal, width: '90%', maxWidth: 900, maxHeight: '85vh', display: 'flex', flexDirection: 'column'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20}}>
              <h2 style={{margin: 0, color: '#fff'}}>{selectedMember.name}'s Submissions</h2>
              <button onClick={() => setSelectedMember(null)} style={{background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 24, fontWeight: 'bold'}}>✖</button>
            </div>
            <div style={{overflowY: 'auto', flex: 1}}>
               {memberSubmissions.length === 0 ? <p style={{color: '#94a3b8'}}>No visible submissions found.</p> : (
                 <table style={table}>
                   <thead><tr><th style={th}>Time</th><th style={th}>Problem</th><th style={th}>Verdict</th><th style={th}>Language</th></tr></thead>
                   <tbody>
                     {memberSubmissions.map(sub => (
                       // Inside your submissions table (in apps/web/pages/contests/[id].tsx)
// Replace the onClick on the <tr> with a button wrapper inside the <td>:

<tr key={sub.id} style={clickRow}>
  <td style={td}>{new Date(sub.createdAt).toLocaleString()}</td>
  <td style={td}>{sub.userId}</td>
  <td style={td}>
    {problemById[sub.problemId]?.label || ''} 
    {canSeeProblemMeta ? problemById[sub.problemId]?.titleSnapshot : ''}
  </td>
  <td style={{...td, color: sub.verdict.includes('ACCEPT') ? '#4ade80' : '#f87171'}}>{sub.verdict}</td>
  <td style={td}>
    {/* 👉 FIX: Use an explicit button for the modal trigger */}
    <button 
      onClick={(e) => { 
        e.stopPropagation(); 
        setSelectedSubmission(sub); 
      }} 
      style={ghostButton}
    >
      View Details
    </button>
  </td>
</tr>
                     ))}
                   </tbody>
                 </table>
               )}
            </div>
          </div>
        </div>
      )}

      <section style={{ maxWidth: 1240, margin: '0 auto' }}>
        <nav style={nav}>
          <a href="/" style={link}>DivineCode</a>
          <div style={userPill}>{session.user?.name || session.user?.email}</div>
        </nav>

        <div style={hero}>
          <div>
            <p style={eyebrow}>{isFinal ? 'Final standings' : isOwner ? 'Owner control room' : 'Player contest room'}</p>
            <h1 style={{ fontSize: 46, margin: 0 }}>{contest.title}</h1>
            <p style={{ color: '#a8b3c7' }}>{isOwner ? 'You can edit, sync, extend, and delete this mashup.' : 'Problem ratings, tutorials, and other-team submissions stay hidden during the contest.'}</p>
            <p style={{ color: '#67e8f9' }}>{isFinal ? 'Read-only final board' : `Last sync: ${lastSync}`}</p>
          </div>
          <div style={timerCard}>
            <strong>{isFinal ? 'FINAL' : `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}`}</strong>
            <span>{isFinal ? 'standings' : 'remaining'}</span>
          </div>
        </div>

        <div style={grid}>
          {isOwner && !isFinal && <section style={panel}>
            <h2>Owner controls</h2>
            <a href={`/contests/${contest.id}/edit`} style={primaryButton}>Open editing page</a>
            <button onClick={() => syncCodeforces(false)} disabled={syncing} style={primaryButton}>{syncing ? 'Syncing...' : 'Sync Codeforces now'}</button>
            <button onClick={() => extendTime(15)} style={ghostButton}>+15 min</button>
            <button onClick={() => extendTime(30)} style={ghostButton}>+30 min</button>
            <button onClick={finalizeContest} style={{...primaryButton, background: 'linear-gradient(135deg, #f59e0b, #fbbf24)', color: '#000'}}>
              End Contest & Calculate Ratings
            </button>
            <button onClick={deleteContest} style={dangerButton}>Delete mashup</button>
            <h3>Add live problem</h3>
            <select value={newProblemPlatform} onChange={(e) => setNewProblemPlatform(e.target.value)} style={smallInput}><option>Codeforces</option><option>LeetCode</option><option>AtCoder</option><option>CodeChef</option></select>
            <input value={newProblemCode} onChange={(e) => setNewProblemCode(e.target.value)} placeholder="1805A" style={smallInput} />
            <button onClick={addProblem} style={primaryButton}>Add Problem</button>
            <h2>Players</h2>
            {contest.members.map((m: any) => <p key={m.id} style={{ color: '#cbd5e1' }}>{m.name}<br/><span style={{ color: '#67e8f9' }}>{m.team || 'Individuals'} - CF: {m.codeforcesHandle || m.handle || 'missing'}</span></p>)}
          </section>}

          <section style={isOwner && !isFinal ? panelWide : { ...panelWide, gridColumn: '1 / -1' }}>
            <h2>Problems</h2>
            <div style={{ display: 'grid', gap: 12 }}>
              {contest.problems.map((p: any, index: number) => {
                const label = String.fromCharCode(65 + index);
                const actualTitle = p.titleSnapshot || p.problem?.title || `Problem ${label}`;
                const visibleTitle = canSeeProblemMeta ? actualTitle : `Problem ${label}`;
                const safeProblemHref = `/submit?contestId=${contest.id}&problemId=${p.id}`; // DIRECTS TO SUBMIT PAGE
                const isSolvedByTeam = teamSolvedProblemIds.has(p.id);

                return <div key={p.id} style={{
                  ...problemRow, 
                  borderColor: isSolvedByTeam ? 'rgba(74, 222, 128, 0.4)' : 'rgba(148,163,184,.16)'
                }}>
                  <strong style={{ color: '#67e8f9', fontSize: 22 }}>{label}</strong>
                  <div>
                    <a href={safeProblemHref} style={{ color: '#eef2ff', fontWeight: 900, textDecoration: 'none' }}>{visibleTitle}</a>
                    <p style={{ margin: '6px 0 0', color: '#94a3b8' }}>
                      {canSeeProblemMeta 
                        ? `${p.platform} - Rating ${p.problem?.rating || p.rating || p.difficulty || 'Practice'} · ${p.points || 1000} pts` 
                        : `${p.platform} - rating hidden during contest`}
                    </p>
                  </div>
                  
                  {isSolvedByTeam && (
                    <div style={{ display: 'flex', alignItems: 'center', color: '#4ade80', fontWeight: 'bold' }}>
                      <svg style={{ width: 20, height: 20, marginRight: 4 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                      </svg>
                      Solved
                    </div>
                  )}

                  {!isFinal && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <a href={safeProblemHref} style={primaryLink}>
                      {isSolvedByTeam ? 'Review problem' : 'Open problem'}
                    </a>
                    {isOwner && <><button onClick={() => replaceProblem(p.id)} style={ghostButton}>Replace</button><button onClick={() => removeProblem(p.id)} style={ghostButton}>Remove</button></>}
                  </div>}
                </div>;
              })}
            </div>
          </section>
        </div>

        <section style={{ ...panel, marginTop: 18 }}>
          <h2>Team Standings</h2>
          <div style={{ overflowX: 'auto' }}><table style={table}><thead><tr><th style={th}>Rank</th><th style={th}>Group</th><th style={th}>Solved</th><th style={th}>Penalty</th><th style={th}>Score</th></tr></thead><tbody>{teamStandings.map((team: any, i: number) => <Fragment key={team.team}><tr onClick={() => setOpenTeam(openTeam === team.team ? null : team.team)} style={clickRow}><td style={td}>#{i + 1}</td><td style={td}>{team.team}</td><td style={td}>{team.solved}</td><td style={td}>{team.penalty}</td><td style={{...td, color: '#fbbf24', fontWeight: 'bold'}}>{team.score}</td></tr>{openTeam === team.team && team.players.map((player: any, pi: number) => <tr key={player.memberId} onClick={() => canInspectMember(player.memberId) && setSelectedMember(player)} style={canInspectMember(player.memberId) ? subRow : mutedRow}><td style={td}>#{pi + 1}</td><td style={td}>{player.name}</td><td style={td}>{player.solved}</td><td style={td}>{player.penalty}</td><td style={td}>{player.score}</td></tr>)}</Fragment>)}</tbody></table></div>
       
       
        </section>
        
        <section style={{ ...panel, marginTop: 18 }}>
          <h2>{isFinal || timeLeft === 0 ? 'All submissions' : isOwner ? 'All submissions' : contest.visibility?.submissionScope === 'team' ? 'Team submissions' : 'Your submissions'}</h2>
          {submissions.length === 0 && <p style={{ color: '#94a3b8' }}>No visible submissions yet.</p>}
          <div style={{ overflowX: 'auto' }}><table style={table}><thead><tr><th style={th}>Time</th><th style={th}>User</th><th style={th}>Problem</th><th style={th}>Verdict</th><th style={th}>Source</th></tr></thead>// Find this table in apps/web/pages/contests/[id].tsx
<tbody>
  {submissions.map((submission) => (
    <tr key={submission.id} style={clickRow}>
      <td style={td}>{new Date(submission.createdAt).toLocaleString()}</td>
      <td style={td}>{submission.userId}</td>
      <td style={td}>
        {problemById[submission.problemId]?.label || ''} 
        {canSeeProblemMeta ? problemById[submission.problemId]?.titleSnapshot : ''}
      </td>
      <td style={{...td, color: submission.verdict.includes('ACCEPT') ? '#4ade80' : '#f87171'}}>
        {submission.verdict}
      </td>
      <td style={td}>
        {/* 👉 ADD THIS BUTTON WRAPPER TO FIX MODAL CLICK */}
        <button 
          onClick={(e) => { 
            e.stopPropagation(); 
            setSelectedSubmission(submission); 
          }} 
          style={ghostButton}
        >
          View Details
        </button>
      </td>
    </tr>
  ))}
</tbody></table></div>
        </section>

        {selectedSubmission && <section style={{ ...panel, marginTop: 18 }}>
          <h2>Submission detail</h2>
          <button onClick={() => setSelectedSubmission(null)} style={ghostButton}>Close Panel</button>
          <div style={detailCard}>
            <p><b>User:</b> {selectedSubmission.userId}</p>
            <p><b>Problem:</b> {canSeeProblemMeta ? problemById[selectedSubmission.problemId]?.titleSnapshot || selectedSubmission.problemId : problemById[selectedSubmission.problemId]?.label || selectedSubmission.problemId}</p>
            <p><b>Verdict:</b> {selectedSubmission.verdict}</p>
            <p><b>Language:</b> {selectedSubmission.language || 'Unknown'}</p>
            
            {/* 👉 NEW: Show the Code if the backend returned it! */}
            {selectedSubmission.code && (
              <div style={{marginTop: 12}}>
                <strong style={{color: '#cbd5e1'}}>Source Code:</strong>
                <pre style={{background: '#020617', padding: 12, borderRadius: 8, maxHeight: 300, overflow: 'auto', marginTop: 8, color: '#e2e8f0', fontFamily: 'monospace'}}>
                  {selectedSubmission.code}
                </pre>
              </div>
            )}
            
            {selectedSubmission.manualPoints !== null && selectedSubmission.manualPoints !== undefined && (
              <p style={{ color: '#fbbf24', marginTop: 10 }}><b>Manual Override Points:</b> {selectedSubmission.manualPoints}</p>
            )}
            
            {isOwner && selectedSubmission.externalSubmissionId && <a href={`https://codeforces.com/contest/${problemById[selectedSubmission.problemId]?.contestCode}/submission/${selectedSubmission.externalSubmissionId}`} target="_blank" rel="noreferrer" style={{...primaryLink, marginTop: 10}}>Open Codeforces submission</a>}
            
            {isFinal && !isOwner && selectedSubmission.userId !== (session?.user?.name || session?.user?.email) && (
              <div style={{ marginTop: 16, borderTop: '1px solid rgba(148,163,184,.2)', paddingTop: 16 }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#f87171' }}>Report Discrepancy</h4>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input style={{...smallInput, marginBottom: 0}} placeholder="Suspected AI, Hardcoded, etc." value={reportReason} onChange={e => setReportReason(e.target.value)} />
                  <button style={{...ghostButton, borderColor: 'rgba(248,113,113,.4)', color: '#fecaca', marginBottom: 0}} onClick={submitReport}>Report</button>
                </div>
              </div>
            )}

            {isOwner && (
              <div style={{ marginTop: 16, borderTop: '1px solid rgba(148,163,184,.2)', paddingTop: 16 }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#fbbf24' }}>Owner Controls</h4>
                
                {selectedSubmission.reports?.length > 0 && (
                  <div style={{ marginBottom: 12, padding: 12, background: 'rgba(248,113,113,.1)', borderRadius: 8, border: '1px solid rgba(248,113,113,.3)' }}>
                    <strong style={{ color: '#f87171', display: 'block', marginBottom: 6 }}>Flagged by peers:</strong>
                    {selectedSubmission.reports.map((r: any) => <p key={r.id} style={{ margin: '4px 0', fontSize: 13, color: '#fecaca' }}>- {r.reason}</p>)}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <input style={{...smallInput, width: '120px', marginBottom: 0}} type="number" placeholder="New Points" value={overridePoints} onChange={e => setOverridePoints(e.target.value === '' ? '' : Number(e.target.value))} />
                  <button style={{...primaryButton, marginBottom: 0, width: 'auto'}} onClick={submitOverride}>Override Points</button>
                </div>
              </div>
            )}
          </div>
        </section>}
      </section>
    </main>
  );
}

// RESTORED STYLES
const page: CSSProperties = { minHeight: '100vh', padding: 28, fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.32), transparent 34rem), #070a16' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 };
const userPill: CSSProperties = { padding: '10px 14px', borderRadius: 999, background: 'rgba(15,23,42,.82)', border: '1px solid rgba(148,163,184,.22)' };
const gate: CSSProperties = { maxWidth: 620, margin: '15vh auto', padding: 34, borderRadius: 28, border: '1px solid rgba(148,163,184,.22)', background: 'rgba(15,23,42,.82)' };
const link: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 800 };
const primaryLink: CSSProperties = { display: 'inline-block', padding: '11px 15px', borderRadius: 999, border: 0, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontWeight: 900, cursor: 'pointer', textDecoration: 'none' };
const primaryButton: CSSProperties = { ...primaryLink, width: '100%', marginBottom: 10 };
const ghostButton: CSSProperties = { padding: '11px 15px', borderRadius: 999, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(2,6,23,.55)', color: '#eef2ff', fontWeight: 800, cursor: 'pointer', marginBottom: 10 };
const dangerButton: CSSProperties = { ...ghostButton, width: '100%', border: '1px solid rgba(248,113,113,.4)', color: '#fecaca' };
const smallInput: CSSProperties = { width: '100%', padding: 11, marginBottom: 10, border: '1px solid rgba(148,163,184,.25)', borderRadius: 12, background: 'rgba(15,23,42,.8)', color: '#eef2ff', outline: 'none' };
const eyebrow: CSSProperties = { color: '#67e8f9', fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase' };
const hero: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 18, flexWrap: 'wrap', margin: '24px 0' };
const timerCard: CSSProperties = { minWidth: 170, padding: 22, borderRadius: 24, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', display: 'grid', gap: 4, textAlign: 'center' };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(260px, .8fr) minmax(320px, 1.7fr)', gap: 18 };
const panel: CSSProperties = { padding: 24, borderRadius: 26, border: '1px solid rgba(148,163,184,.22)', background: 'rgba(15,23,42,.82)' };
const panelWide: CSSProperties = { ...panel };
const problemRow: CSSProperties = { display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 14, alignItems: 'center', padding: 16, borderRadius: 18, background: 'rgba(2,6,23,.5)', border: '1px solid rgba(148,163,184,.16)' };
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const th: CSSProperties = { textAlign: 'left', padding: 12, color: '#67e8f9', borderBottom: '1px solid rgba(148,163,184,.18)' };
const td: CSSProperties = { padding: 12, borderBottom: '1px solid rgba(148,163,184,.12)' };
const clickRow: CSSProperties = { cursor: 'pointer' };
const subRow: CSSProperties = { cursor: 'pointer', background: 'rgba(34,211,238,.05)' };
const mutedRow: CSSProperties = { opacity: .58, cursor: 'not-allowed' };
const detailCard: CSSProperties = { marginTop: 10, padding: 16, borderRadius: 18, background: 'rgba(2,6,23,.55)', border: '1px solid rgba(148,163,184,.16)', display: 'grid', gap: 6 };
const overlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(2,6,23,0.8)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 50 };
const overlayModal: CSSProperties = { padding: 30, backgroundColor: '#0f172a', border: '1px solid rgba(103,232,249,0.3)', borderRadius: 20, textAlign: 'center', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' };