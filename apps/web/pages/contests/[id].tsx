import { CSSProperties, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';

// 👉 Upgraded UI & Real-Time Imports
import toast, { Toaster } from 'react-hot-toast';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { io, Socket } from 'socket.io-client';

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

  const [registerHandle, setRegisterHandle] = useState('');
  const [registerTeam, setRegisterTeam] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  
  const [nowTick, setNowTick] = useState(Date.now());
  const syncingRef = useRef(false);
  
  // 👉 Socket & Scroll References
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 👉 UI States
  const [standingsMode, setStandingsMode] = useState<'team' | 'individual'>('team');
  const [isRecommending, setIsRecommending] = useState(false);
  const [generatingTcFor, setGeneratingTcFor] = useState<string | null>(null);

  // 👉 Chat States
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<{id: number, text: string, sender: string, time: Date}[]>([]);

  const isOwner = Boolean(contest?.canManage);
  const viewerMember = contest?.viewerMember || null;
  const canSeeProblemMeta = Boolean(contest?.visibility?.canSeeProblemMeta);

  const startTimeMs = contest ? new Date(contest.startTime).getTime() : 0;
  const isScheduledLockScreen = nowTick < startTimeMs;
  const halfTimeMs = startTimeMs + ((contest?.durationMinutes || 0) * 60000 / 2);
  const canUnregister = viewerMember && !isOwner && nowTick < halfTimeMs;

  function formatCountdown(ms: number) {
    if (ms <= 0) return '00:00:00';
    const s = Math.floor((ms / 1000) % 60);
    const m = Math.floor((ms / 1000 / 60) % 60);
    const h = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const d = Math.floor(ms / (1000 * 60 * 60 * 24));
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0 || d > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  }

  useEffect(() => {
    const ticker = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, []);

  async function registerForContest() {
    if (!id || !session || !registerHandle.trim()) return toast.error("Codeforces handle is required");
    setIsRegistering(true);
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/register`, {
      method: 'POST',
      headers: viewerHeaders(session),
      body: JSON.stringify({
        codeforcesHandle: registerHandle,
        teamName: registerTeam || 'Solo'
      })
    });
    const data = await res.json();
    setIsRegistering(false);
    
    if (!res.ok) return toast.error(data.error || 'Failed to register');
    
    setContest(data);
    await loadSubmissions();
    toast.success("Successfully registered! You can now submit code.");
  }

  async function unregisterFromContest() {
    if (!confirm("Are you sure you want to unregister? You will lose access to submit.")) return;
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/unregister`, { method: 'POST', headers: viewerHeaders(session) });
    if(res.ok) {
      toast.success('Successfully unregistered.');
      loadContest();
    } else {
      const data = await res.json();
      toast.error(data.error || 'Failed to unregister');
    }
  }

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
    if (!res.ok) { if (!silent) toast.error(data.error || 'Sync failed'); return; }
    await loadContest();
    await loadSubmissions();
    setLastSync(data.queued ? `${new Date().toLocaleTimeString()} - sync queued` : `${new Date().toLocaleTimeString()} - ${data.synced?.length || 0} accepted`);
    if (!silent) toast.success(data.queued ? 'Codeforces sync queued.' : `Synced ${data.synced?.length || 0} accepted submission(s).`);
  }

  async function extendTime(minutes: number) {
    if (!id || !session) return;
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/extend`, { method: 'POST', headers: viewerHeaders(session), body: JSON.stringify({ minutes }) });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error || 'Could not extend');
    toast.success(`Time extended by ${minutes} minutes.`);
    setContest(data);
  }

  async function deleteContest() {
    if (!id || !session || !confirm('Delete this live mashup and its submissions?')) return;
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}`, { method: 'DELETE', headers: viewerHeaders(session) });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error || 'Could not delete contest');
    toast.success('Contest deleted successfully.');
    router.push('/contests');
  }

  async function lookupProblem(platform: string, code: string) {
    const res = await fetch(`${API_BASE_URL}/api/problems/lookup?platform=${encodeURIComponent(platform)}&code=${encodeURIComponent(code)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lookup failed');
    return data;
  }

  async function addProblem() {
    if (!id || !session || !newProblemCode.trim()) return toast.error('Enter a problem code.');
    try {
      const p = await lookupProblem(newProblemPlatform, newProblemCode);
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems`, { method: 'POST', headers: viewerHeaders(session), body: JSON.stringify(p) });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error || 'Could not add problem');
      toast.success('Problem added successfully.');
      setContest(data);
      setNewProblemCode('');
    } catch (e: any) { toast.error(e.message || 'Could not add problem'); }
  }

  async function generateAITestcases(problemId: string) {
    const masterSolution = prompt('To generate accurate system test cases, the AI needs a correct Master Solution. Please paste working code here:');
    if (!masterSolution) return;
    
    setGeneratingTcFor(problemId);
    try {
      const res = await fetch(`${API_V2_BASE_URL}/problems/${problemId}/generate-ai-testcases`, { 
        method: 'POST', 
        headers: viewerHeaders(session),
        body: JSON.stringify({ masterSolution })
      });
      const data = await res.json();
      if (res.ok) toast.success(`Successfully generated ${data.generatedCount} new system test cases!`);
      else toast.error(data.error || 'Failed to generate test cases.');
    } catch (e: any) {
      toast.error('Network error while connecting to AI.');
    } finally {
      setGeneratingTcFor(null);
    }
  }

  async function generateAIRecommendations() {
    if (!id || !session) return;
    setIsRecommending(true);
    try {
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/recommend-problems`, { 
        method: 'POST', headers: viewerHeaders(session) 
      });
      const data = await res.json();
      if (res.ok) toast.success(`AI Recommended: ${data.recommendations.join(', ')}`);
      else toast.error(data.error || 'Failed to fetch AI recommendations');
    } catch (e) {
      toast.error('Network error while generating recommendations.');
    } finally {
      setIsRecommending(false);
    }
  }

  async function removeProblem(problemId: string) {
    if (!id || !session || !confirm('Remove this problem from the live contest?')) return;
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems/${problemId}`, { method: 'DELETE', headers: viewerHeaders(session) });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error || 'Could not remove problem');
    toast.success('Problem removed.');
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
      if (!res.ok) return toast.error(data.error || 'Could not replace problem');
      toast.success('Problem replaced successfully.');
      setContest(data);
    } catch (e: any) { toast.error(e.message || 'Could not replace problem'); }
  }

  async function submitReport() {
    if (!selectedSubmission || !reportReason.trim()) return;
    const res = await fetch(`${API_BASE_URL}/api/submissions/${selectedSubmission.id}/report`, {
      method: 'POST', headers: viewerHeaders(session), body: JSON.stringify({ reason: reportReason })
    });
    if (res.ok) { toast.success('Report submitted successfully to the contest owner.'); setReportReason(''); } 
    else { const data = await res.json(); toast.error(data.error || 'Failed to report submission'); }
  }
  
  async function finalizeContest() {
    if (!id || !session || !confirm('End this contest immediately and calculate final ratings/coins? This cannot be undone.')) return;
    setSyncing(true); 
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/finalize`, { method: 'POST', headers: viewerHeaders(session) });
    const data = await res.json();
    setSyncing(false);
    if (!res.ok) return toast.error(data.error || 'Could not finalize contest');
    toast.success(data.message || 'Contest finalized!');
    router.push(`/contests/${id}/final`);
  }

  async function submitOverride() {
    if (!selectedSubmission || overridePoints === '') return;
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/submissions/${selectedSubmission.id}/override`, {
      method: 'POST', headers: viewerHeaders(session), body: JSON.stringify({ manualPoints: Number(overridePoints) })
    });
    if (res.ok) {
      toast.success('Points overridden successfully. Standings will recalculate instantly.');
      setSelectedSubmission(null);
      await loadSubmissions();
      await loadContest(); 
    } else {
      const data = await res.json(); toast.error(data.error || 'Failed to override points');
    }
  }

  // 👉 Local Chat Handler with WebSockets
  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    
    const newMsg = {
      id: Date.now(),
      text: chatInput.trim(),
      sender: viewerMember?.name || session?.user?.name || 'Me',
      time: new Date()
    };
    
    // Optimistic UI Update
    setMessages(prev => [...prev, newMsg]);
    setChatInput('');
    
    // Emit to backend
    if (socketRef.current) {
      socketRef.current.emit('sendChatMessage', {
        contestId: id,
        team: viewerMember?.teamName || viewerMember?.team || 'Solo',
        message: newMsg
      });
    }
  };

  // 👉 Core Lifecycle Effects
  useEffect(() => { loadContest(); loadSubmissions(); }, [id, session?.user?.email, session?.user?.name]);
  
  useEffect(() => { const timer = setInterval(() => setTimeLeft((prev) => Math.max(0, prev - 1)), 1000); return () => clearInterval(timer); }, []);
  
  // 👉 Socket.io Implementation (Replaces 30s Polling)
  useEffect(() => {
    if (!id || !session || isFinal) return;
  
    socketRef.current = io(API_BASE_URL, {
      transports: ['websocket'],
      reconnection: true
    });
  
    const socket = socketRef.current;
  
    socket.on('connect', () => {
      socket.emit('joinContest', id);
    });
  
    socket.on('contestUpdated', () => {
      loadContest();
    });
  
    socket.on('submissionsUpdated', () => {
      loadSubmissions();
      syncCodeforces(true); 
    });
  
    socket.on('chatMessage', (incomingMessage) => {
      setMessages((prev) => {
        if (prev.some(m => m.id === incomingMessage.id)) return prev;
        // Ensure Date is correctly parsed if coming as a string from the socket
        return [...prev, { ...incomingMessage, time: new Date(incomingMessage.time) }];
      });
    });
  
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [id, session?.user?.email, session?.user?.name, isFinal]);
  
  // 👉 Auto-Scroll Effect for Chat Messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => { if (!id || !contest || isFinal) return; if (timeLeft === 0 && !isScheduledLockScreen) router.push(`/contests/${id}/final`); }, [timeLeft, id, contest, isFinal, isScheduledLockScreen]);

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

  const individualStandings = useMemo(() => {
    return (contest?.standings || [])
      .sort((a: any, b: any) => a.rank - b.rank)
      .map((s: any) => ({
        ...s,
        name: memberById[s.memberId]?.name || memberById[s.memberId]?.user?.name || 'Unknown',
        team: memberById[s.memberId]?.teamName || memberById[s.memberId]?.team || 'Individuals'
      }));
  }, [contest, memberById]);

  const teamStandings = useMemo(() => {
    const grouped: Record<string, any> = {};
    (contest?.standings || []).forEach((standing: any) => {
      const member = memberById[standing.memberId] || {};
      const team = member.teamName || member.team || 'Individuals';
      if (!grouped[team]) grouped[team] = { team, solved: 0, penalty: 0, score: 0, players: [] };
    
      let safeScore = standing.score || 0;
      if (safeScore === 0 && standing.solvedProblems) {
        safeScore = standing.solvedProblems.reduce((sum: number, pId: string) => sum + (problemById[pId]?.points || 1000), 0);
      }
      
      grouped[team].solved += standing.solved || 0;
      grouped[team].penalty += standing.penalty || 0;
      grouped[team].score += safeScore;
      grouped[team].players.push({ ...standing, codeforcesHandle: member.codeforcesHandle || member.externalHandle?.handle, team, score: safeScore });
    });
    return Object.values(grouped).map((team: any) => ({ ...team, players: team.players.sort((a: any, b: any) => b.solved - a.solved || a.penalty - b.penalty) })).sort((a: any, b: any) => b.solved - a.solved || a.penalty - b.penalty || a.team.localeCompare(b.team));
  }, [contest, memberById, problemById]);

  const canInspectMember = (memberId: string) => {
    if (isOwner || isFinal || timeLeft === 0) return true;
    const member = memberById[memberId];
    return Boolean(viewerMember && (viewerMember.id === memberId || (viewerMember.team && viewerMember.team !== 'Individuals' && member?.team === viewerMember.team)));
  };

  const memberSubmissions = selectedMember ? submissions.filter((submission) => submission.memberId === selectedMember.memberId || submission.participantId === selectedMember.memberId) : [];

  const mySubmissions = viewerMember ? submissions.filter((s) => s.memberId === viewerMember.id || s.participantId === viewerMember.id || s.userId === (session?.user?.name || session?.user?.email)) : [];
  const myTotalAttempts = mySubmissions.length;
  const myAccepted = mySubmissions.filter(s => s.verdict.includes('ACCEPT') || s.verdict === 'OK').length;
  const myAccuracy = myTotalAttempts > 0 ? Math.round((myAccepted / myTotalAttempts) * 100) : 0;
  const myStanding = viewerMember ? individualStandings.find((s: any) => s.memberId === viewerMember.id) : null;

  const CentralSpinner = ({ text }: { text: string }) => (
    <main style={{ ...page, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 48, height: 48, border: '4px solid rgba(103, 232, 249, 0.2)', borderTopColor: '#67e8f9', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <h2 style={{ color: '#a8b3c7', marginTop: 16 }}>{text}</h2>
    </main>
  );

  if (status === 'loading') return <CentralSpinner text="Checking account..." />;
  if (!session) return <main style={page}><section style={gate}><h1>Sign in required</h1><p style={{ color: '#a8b3c7' }}>Sign in first.</p><a href="/signin" style={primaryLink}>Sign in with Google</a></section></main>;
  if (error) return <main style={page}><h1>{error}</h1><a href="/contests" style={link}>Back to contests</a></main>;
  if (!contest) return <CentralSpinner text="Loading contest room..." />;

  return (
    <main style={page}>
      {/* 👉 Global Toaster Registration */}
      <Toaster position="top-center" toastOptions={{ style: { background: '#1e293b', color: '#fff', border: '1px solid #475569' } }} />

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
                        <tr key={sub.id} style={clickRow}>
                          <td style={td}>{new Date(sub.createdAt).toLocaleString()}</td>
                          <td style={td}>{sub.userId}</td>
                          <td style={td}>
                            {problemById[sub.problemId]?.label || ''} 
                            {canSeeProblemMeta ? problemById[sub.problemId]?.titleSnapshot : ''}
                          </td>
                          <td style={{...td, color: sub.verdict.includes('ACCEPT') ? '#4ade80' : '#f87171'}}>{sub.verdict}</td>
                          <td style={td}>
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
            <strong>{isFinal ? 'FINAL' : isScheduledLockScreen ? 'WAITING' : `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}`}</strong>
            <span>{isFinal ? 'standings' : isScheduledLockScreen ? 'to start' : 'remaining'}</span>
          </div>
        </div>

        {isFinal && viewerMember && (
          <section style={{ ...panel, marginBottom: 18, background: 'linear-gradient(145deg, #0f172a, #1e1b4b)', border: '1px solid #6366f1' }}>
            <h2 style={{ color: '#a5b4fc', margin: '0 0 15px 0' }}>🏆 Post-Contest Performance Report</h2>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 15 }}>
              <div style={{ background: '#020617', padding: 15, borderRadius: 12, border: '1px solid #334155', textAlign: 'center' }}>
                <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 5 }}>Final Rank</div>
                <div style={{ color: '#fbbf24', fontSize: 28, fontWeight: 'bold' }}>#{myStanding?.rank || '-'}</div>
              </div>

              <div style={{ background: '#020617', padding: 15, borderRadius: 12, border: '1px solid #334155', textAlign: 'center' }}>
                <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 5 }}>Total Score</div>
                <div style={{ color: '#67e8f9', fontSize: 28, fontWeight: 'bold' }}>{myStanding?.score || 0}</div>
              </div>

              <div style={{ background: '#020617', padding: 15, borderRadius: 12, border: '1px solid #334155', textAlign: 'center' }}>
                <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 5 }}>Problems Solved</div>
                <div style={{ color: '#4ade80', fontSize: 28, fontWeight: 'bold' }}>{myStanding?.solved || 0}</div>
              </div>

              <div style={{ background: '#020617', padding: 15, borderRadius: 12, border: '1px solid #334155', textAlign: 'center' }}>
                <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 5 }}>Accuracy</div>
                <div style={{ color: myAccuracy >= 50 ? '#4ade80' : '#f87171', fontSize: 28, fontWeight: 'bold' }}>{myAccuracy}%</div>
              </div>

              <div style={{ background: '#020617', padding: 15, borderRadius: 12, border: '1px solid #334155', textAlign: 'center' }}>
                <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 5 }}>Total Penalty</div>
                <div style={{ color: '#f87171', fontSize: 28, fontWeight: 'bold' }}>{myStanding?.penalty || 0}</div>
              </div>
            </div>
          </section>
        )}

        {isScheduledLockScreen && !isOwner ? (
          <section style={{...panel, textAlign: 'center', padding: '60px 20px', border: '1px solid rgba(251, 191, 36, 0.4)', background: 'linear-gradient(180deg, rgba(15,23,42,0.9), rgba(251,191,36,0.05))'}}>
             <h2 style={{ fontSize: 32, marginBottom: 10, color: '#fbbf24', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
               <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
               </svg>
               Contest has not started yet
             </h2>
             <p style={{color: '#a8b3c7', fontSize: 18}}>Problems will be revealed when the countdown reaches zero.</p>
             <div style={{fontSize: 48, fontWeight: 'bold', color: '#67e8f9', marginTop: 20, fontFamily: 'monospace'}}>
               {formatCountdown(startTimeMs - nowTick)}
             </div>
          </section>
        ) : (
          <>
            {!isOwner && !viewerMember && contest.status !== 'ENDED' && (
              <section style={{ ...panel, marginBottom: 18, border: '1px solid #22d3ee', background: 'rgba(34, 211, 238, 0.05)' }}>
                <h2 style={{color: '#22d3ee', margin: '0 0 10px 0'}}>Join this Contest</h2>
                <p style={{color: '#a8b3c7', marginBottom: 16}}>You must register your Codeforces handle to submit solutions and appear on the leaderboard.</p>
                <div style={{display: 'flex', gap: 12, flexWrap: 'wrap'}}>
                  <input placeholder="Codeforces Handle (e.g. tourist)" style={{...smallInput, maxWidth: 250, marginBottom: 0}} value={registerHandle} onChange={e => setRegisterHandle(e.target.value)} />
                  <input placeholder="Team Name (Leave empty for solo)" style={{...smallInput, maxWidth: 250, marginBottom: 0}} value={registerTeam} onChange={e => setRegisterTeam(e.target.value)} />
                  <button onClick={registerForContest} disabled={isRegistering} style={{...primaryButton, width: 'auto', marginBottom: 0}}>
                    {isRegistering ? 'Joining...' : 'Register Now'}
                  </button>
                </div>
              </section>
            )}

            {canUnregister && (
              <section style={{ ...panel, marginBottom: 18, padding: 16 }}>
                <p style={{ color: '#94a3b8', display: 'inline-block', marginRight: 15 }}>Not ready? You can unregister before half-time.</p>
                <button onClick={unregisterFromContest} style={{...dangerButton, width: 'auto', marginBottom: 0}}>Unregister from Contest</button>
              </section>
            )}

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
                
                <button onClick={generateAIRecommendations} disabled={isRecommending} style={{ ...ghostButton, color: '#fbbf24', borderColor: 'rgba(251, 191, 36, 0.4)' }}>
                  {isRecommending ? '✨ Curating...' : '✨ Suggest Missing Problems'}
                </button>

                <h2>Players</h2>
                {(contest.participants || contest.members || []).map((m: any) => (
                  <p key={m.id} style={{ color: '#cbd5e1', marginBottom: '8px', lineHeight: '1.4' }}>
                    {m.user?.name || m.name || m.displayName || 'Unknown Player'}<br/>
                    <span style={{ color: '#67e8f9' }}>
                      {m.teamName || m.team || 'Individuals'} - CF: {m.externalHandle?.handle || m.codeforcesHandle || m.handle || 'missing'}
                    </span>
                  </p>
                ))}
              </section>}

              <section style={isOwner && !isFinal ? panelWide : { ...panelWide, gridColumn: '1 / -1' }}>
                <h2>Problems</h2>
                <div style={{ display: 'grid', gap: 12 }}>
                  {contest.problems.map((p: any, index: number) => {
                    const label = String.fromCharCode(65 + index);
                    const actualTitle = p.titleSnapshot || p.problem?.title || `Problem ${label}`;
                    const visibleTitle = canSeeProblemMeta ? actualTitle : `Problem ${label}`;
                    const safeProblemHref = `/contests/${contest.id}/problems/${p.id}`; 
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
                        {isOwner && (
                          <>
                            <button onClick={() => generateAITestcases(p.problemId || p.id)} disabled={generatingTcFor === (p.problemId || p.id)} style={{...ghostButton, color: '#a5b4fc', borderColor: 'rgba(99, 102, 241, 0.4)'}}>
                              {generatingTcFor === (p.problemId || p.id) ? 'Generating...' : '🤖 Generate Hidden Test Cases'}
                            </button>
                            <button onClick={() => replaceProblem(p.id)} style={ghostButton}>Replace</button>
                            <button onClick={() => removeProblem(p.id)} style={ghostButton}>Remove</button>
                          </>
                        )}
                      </div>}
                    </div>;
                  })}
                </div>
              </section>
            </div>

            <section style={{ ...panel, marginTop: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ margin: 0 }}>Leaderboard</h2>
                <div style={{ display: 'flex', background: '#020617', borderRadius: 8, padding: 4, border: '1px solid rgba(148,163,184,.22)' }}>
                  <button onClick={() => setStandingsMode('team')} style={{ ...ghostButton, margin: 0, border: 'none', background: standingsMode === 'team' ? 'rgba(34, 211, 238, 0.1)' : 'transparent', color: standingsMode === 'team' ? '#67e8f9' : '#94a3b8' }}>Teams</button>
                  <button onClick={() => setStandingsMode('individual')} style={{ ...ghostButton, margin: 0, border: 'none', background: standingsMode === 'individual' ? 'rgba(34, 211, 238, 0.1)' : 'transparent', color: standingsMode === 'individual' ? '#67e8f9' : '#94a3b8' }}>Individuals</button>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Rank</th>
                      <th style={th}>{standingsMode === 'team' ? 'Group' : 'Player'}</th>
                      <th style={th}>Solved</th>
                      <th style={th}>Penalty</th>
                      <th style={th}>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Empty States */}
                    {standingsMode === 'team' && teamStandings.length === 0 && (
                      <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#94a3b8' }}>No teams on the board yet.</td></tr>
                    )}
                    {standingsMode === 'individual' && individualStandings.length === 0 && (
                      <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#94a3b8' }}>No individuals on the board yet.</td></tr>
                    )}

                    {standingsMode === 'team' 
                      ? teamStandings.map((team: any, i: number) => (
                          <Fragment key={team.team}>
                            <tr onClick={() => setOpenTeam(openTeam === team.team ? null : team.team)} style={clickRow}>
                              <td style={td}>#{i + 1}</td>
                              <td style={td}>{team.team}</td>
                              <td style={td}>{team.solved}</td>
                              <td style={td}>{team.penalty}</td>
                              <td style={{...td, color: '#fbbf24', fontWeight: 'bold'}}>{team.score}</td>
                            </tr>
                            {openTeam === team.team && team.players.map((player: any, pi: number) => (
                              <tr key={player.memberId} onClick={() => canInspectMember(player.memberId) && setSelectedMember(player)} style={canInspectMember(player.memberId) ? subRow : mutedRow}>
                                <td style={td}>#{pi + 1}</td>
                                <td style={td}>{player.name}</td>
                                <td style={td}>{player.solved}</td>
                                <td style={td}>{player.penalty}</td>
                                <td style={td}>{player.score}</td>
                              </tr>
                            ))}
                          </Fragment>
                        ))
                      : individualStandings.map((player: any) => (
                          <tr key={player.memberId} onClick={() => canInspectMember(player.memberId) && setSelectedMember(player)} style={canInspectMember(player.memberId) ? clickRow : mutedRow}>
                            <td style={td}>#{player.rank}</td>
                            <td style={td}>{player.name} <span style={{ color: '#94a3b8', fontSize: 12 }}>({player.team})</span></td>
                            <td style={td}>{player.solved || 0}</td>
                            <td style={td}>{player.penalty || 0}</td>
                            <td style={{...td, color: '#fbbf24', fontWeight: 'bold'}}>{player.score || 0}</td>
                          </tr>
                        ))
                    }
                  </tbody>
                </table>
              </div>
            </section>
            
            <section style={{ ...panel, marginTop: 18 }}>
              <h2>{isFinal || timeLeft === 0 ? 'All submissions' : isOwner ? 'All submissions' : contest.visibility?.submissionScope === 'team' ? 'Team submissions' : 'Your submissions'}</h2>
              {submissions.length === 0 && <p style={{ color: '#94a3b8' }}>No visible submissions yet.</p>}
              {submissions.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={table}>
                    <thead>
                      <tr>
                        <th style={th}>Time</th>
                        <th style={th}>User</th>
                        <th style={th}>Problem</th>
                        <th style={th}>Verdict</th>
                        <th style={th}>Source</th>
                      </tr>
                    </thead>
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
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {selectedSubmission && <section style={{ ...panel, marginTop: 18 }}>
              <h2>Submission detail</h2>
              <button onClick={() => setSelectedSubmission(null)} style={ghostButton}>Close Panel</button>
              <div style={detailCard}>
                <p><b>User:</b> {selectedSubmission.userId}</p>
                <p><b>Problem:</b> {canSeeProblemMeta ? problemById[selectedSubmission.problemId]?.titleSnapshot || selectedSubmission.problemId : problemById[selectedSubmission.problemId]?.label || selectedSubmission.problemId}</p>
                <p><b>Verdict:</b> {selectedSubmission.verdict}</p>
                <p><b>Language:</b> {selectedSubmission.language || 'Unknown'}</p>
                
                {/* 👉 Syntactic Highlighting Integration */}
                {selectedSubmission.code && (
                  <div style={{marginTop: 12}}>
                    <strong style={{color: '#cbd5e1'}}>Source Code:</strong>
                    <div style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(148,163,184,.2)' }}>
                      <SyntaxHighlighter 
                        language={
                          selectedSubmission.language?.toLowerCase().includes('python') ? 'python' : 
                          selectedSubmission.language?.toLowerCase().includes('java') ? 'java' : 
                          'cpp'
                        } 
                        style={vscDarkPlus}
                        customStyle={{ margin: 0, padding: 16, maxHeight: 400, background: '#020617' }}
                        showLineNumbers={true}
                      >
                        {selectedSubmission.code}
                      </SyntaxHighlighter>
                    </div>
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
          </>
        )}
      </section>

      {/* 👉 Floating Team Chat Panel (Now Real-Time & Auto-Scrolling) */}
      {!isFinal && viewerMember && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 999 }}>
          {isChatOpen ? (
            <div style={{ width: 320, height: 400, background: '#0f172a', border: '1px solid #6366f1', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
              
              {/* Header */}
              <div style={{ background: '#1e1b4b', padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #312e81' }}>
                <strong style={{ color: '#a5b4fc' }}>Team Chat ({viewerMember.teamName || 'Solo'})</strong>
                <button onClick={() => setIsChatOpen(false)} style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 18 }}>✖</button>
              </div>
              
              {/* Messages Area */}
              <div style={{ flex: 1, padding: 12, overflowY: 'auto', color: '#94a3b8', fontSize: 14 }}>
                {messages.length === 0 ? (
                  <p style={{ textAlign: 'center', marginTop: '40%' }}>No messages yet. Say hi to your team!</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {messages.map(msg => (
                      <div key={msg.id} style={{ background: 'rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                          <strong style={{ color: '#67e8f9' }}>{msg.sender}</strong>
                          <span style={{ color: '#64748b' }}>{new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div style={{ color: '#e2e8f0', wordBreak: 'break-word' }}>{msg.text}</div>
                      </div>
                    ))}
                    {/* 👉 Dummy Div for Auto-Scrolling */}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>
              
              {/* Input Area */}
              <div style={{ padding: 12, borderTop: '1px solid #334155', display: 'flex', gap: 8 }}>
                <input 
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Type a message..." 
                  style={{ ...smallInput, margin: 0, flex: 1 }} 
                />
                <button onClick={handleSendMessage} style={{ ...primaryButton, width: 'auto', margin: 0 }}>Send</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setIsChatOpen(true)} style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: '50%', width: 56, height: 56, cursor: 'pointer', boxShadow: '0 4px 12px rgba(99,102,241,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
            </button>
          )}
        </div>
      )}

    </main>
  );
}

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