import { CSSProperties, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import toast, { Toaster } from 'react-hot-toast';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { io, Socket } from 'socket.io-client';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

export function PostContestAiRecommendations({ contestId, contestStatus }: { contestId: string, contestStatus: string }) {
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (contestStatus !== 'ENDED') return;
    setLoading(true);
    fetch(`${API_V2_BASE_URL}/contests/${contestId}/ai-recommendations`, { method: 'POST' })
      .then(r => r.json())
      .then(data => { if (data.success) setRecommendations(data.recommendations || []); })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [contestId, contestStatus]);

  if (contestStatus !== 'ENDED') return null;

  return (
    <div style={{ marginBottom: '18px', background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.3)', padding: '24px', borderRadius: '16px' }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#a5b4fc', margin: '0 0 10px 0' }}>🤖 AI Tutor Recommendations</h2>
      <p style={{ color: '#94a3b8', marginBottom: '20px' }}>Based on the mechanics of today's problems, practice these to level up:</p>
      {loading ? ( <div style={{ color: '#64748b' }}>Analyzing contest data...</div> ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '15px' }}>
          {recommendations.map((prob) => (
            <a key={prob.id} href={prob.originalUrl || '#'} target="_blank" rel="noreferrer" style={{ display: 'block', background: '#0f172a', border: '1px solid #1e293b', padding: '16px', borderRadius: '12px', textDecoration: 'none' }}>
              <h3 style={{ margin: '0 0 8px 0', color: '#e2e8f0', fontSize: '16px' }}>{prob.title}</h3>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', background: '#3b82f633', color: '#38bdf8', padding: '2px 8px', borderRadius: '12px', fontWeight: 'bold' }}>{prob.difficulty}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function viewerQuery(session: any) {
  const query = new URLSearchParams();
  if (session?.user?.email) query.set('viewerEmail', session.user.email);
  if (session?.user?.name) query.set('viewerName', session.user.name);
  const value = query.toString();
  return value ? `?${value}` : '';
}

function viewerHeaders(session: any) {
  return { 'Content-Type': 'application/json', 'x-user-email': session?.user?.email || '', 'x-user-name': session?.user?.name || '' };
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
  const [loadingText, setLoadingText] = useState('Loading...');
  
  const [lastSync, setLastSync] = useState('Not synced yet');
  const [newProblemCode, setNewProblemCode] = useState('');
  const [newProblemPlatform, setNewProblemPlatform] = useState('Codeforces');
  const [reportReason, setReportReason] = useState('');
  const [overridePoints, setOverridePoints] = useState<number | ''>('');
  
  const [isRegistering, setIsRegistering] = useState(false);
  const [regMode, setRegMode] = useState<'SOLO' | 'TEAM_NEW' | 'TEAM_JOIN'>('SOLO');
  const [regHandle, setRegHandle] = useState('');
  const [regTeamName, setRegTeamName] = useState('');
  const [regInviteCode, setRegInviteCode] = useState('');

  const [ownerMode, setOwnerMode] = useState<'ADMIN' | 'PARTICIPANT'>('ADMIN');

  const [nowTick, setNowTick] = useState(Date.now());
  const syncingRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [standingsMode, setStandingsMode] = useState<'team' | 'individual'>('team');
  const [isRecommending, setIsRecommending] = useState(false);
  const [generatingTcFor, setGeneratingTcFor] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  
  const [voiceStatus, setVoiceStatus] = useState('disconnected');
  const [lobbyChat, setLobbyChat] = useState('');
  const [lobbyMessages, setLobbyMessages] = useState<any[]>([]);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<{ [socketId: string]: RTCPeerConnection }>({});

  const isOwner = Boolean(contest?.canManage);
  const viewerMember = contest?.viewerMember || null;
  const canSeeProblemMeta = Boolean(contest?.visibility?.canSeeProblemMeta);

  // Dynamic End Time logic
  const startTimeMs = contest ? new Date(contest.startTime).getTime() : 0;
  const isEndedDynamically = contest ? Date.now() > startTimeMs + (contest.durationMinutes * 60000) : false;
  const displayStatus = isEndedDynamically ? 'ENDED' : contest?.status;

  const isScheduledLockScreen = nowTick < startTimeMs;
  const halfTimeMs = startTimeMs + ((contest?.durationMinutes || 0) * 60000 / 2);
  const canUnregister = viewerMember && !isOwner && nowTick < halfTimeMs && displayStatus !== 'ENDED';

  const playSuccessSound = () => { try { new Audio('/accepted.mp3').play().catch(()=>{}); } catch (e) {} };

  function formatCountdown(ms: number) {
    if (ms <= 0) return '00:00:00';
    const s = Math.floor((ms / 1000) % 60);
    const m = Math.floor((ms / 1000 / 60) % 60);
    const h = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const d = Math.floor(ms / (1000 * 60 * 60 * 24));
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0 || d > 0) parts.push(`${h}h`);
    parts.push(`${String(m).padStart(2, '0')}m`);
    parts.push(`${String(s).padStart(2, '0')}s`);
    return parts.join(' : ');
  }

  useEffect(() => { const ticker = setInterval(() => setNowTick(Date.now()), 1000); return () => clearInterval(ticker); }, []);

  async function registerForContest() {
    if (!id || !session || !regHandle.trim()) return toast.error("Codeforces handle is required");
    if (regMode === 'TEAM_NEW' && !regTeamName.trim()) return toast.error("Team name required");
    if (regMode === 'TEAM_JOIN' && !regInviteCode.trim()) return toast.error("Invite code required");

    setIsRegistering(true); setLoadingText('Connecting to Lobby...'); setSyncing(true);

    const payload: any = { codeforcesHandle: regHandle.trim() };
    if (regMode === 'TEAM_NEW') payload.teamName = regTeamName.trim();
    if (regMode === 'TEAM_JOIN') payload.teamInviteCode = regInviteCode.trim();

    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/register`, { method: 'POST', headers: viewerHeaders(session), body: JSON.stringify(payload) });
    const data = await res.json();
    setIsRegistering(false); setSyncing(false);

    if (!res.ok) return toast.error(data.error || 'Failed to register');
    
    setContest(data); await loadSubmissions(); playSuccessSound(); toast.success("Successfully registered!");
    if (regMode === 'TEAM_NEW') {
      const myTeam = data.participants?.find((p: any) => p.userId === session.user?.email || p.user?.email === session.user?.email)?.team;
      if (myTeam?.inviteCode) alert(`Team Created! Share this invite code with your friends: ${myTeam.inviteCode}`);
    }
  }

  async function unregisterFromContest() {
    if (!confirm("Are you sure you want to unregister? You will lose access to submit.")) return;
    setLoadingText('Unregistering...'); setSyncing(true);
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/unregister`, { method: 'POST', headers: viewerHeaders(session) });
    setSyncing(false);
    if(res.ok) { toast.success('Successfully unregistered.'); loadContest(); } 
    else { const data = await res.json(); toast.error(data.error || 'Failed to unregister'); }
  }

  async function loadContest() {
    if (!id) return;
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}${viewerQuery(session)}`, { headers: viewerHeaders(session) });
    const data = await res.json();
    if (!res.ok) { setError(data.error || 'Contest not found'); return; }
    
    if (!data.viewerMember && session?.user && (data.participants || data.members)) {
      const arr = data.participants || data.members || [];
      data.viewerMember = arr.find((p: any) => (session.user?.email && p.user?.email === session.user?.email) || (session.user?.name && p.displayName === session.user?.name));
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
    if (!silent) { setLoadingText('Syncing Submissions...'); setSyncing(true); }
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/sync/codeforces`, { method: 'POST', headers: viewerHeaders(session) });
    const data = await res.json();
    syncingRef.current = false; setSyncing(false);
    if (!res.ok) { if (!silent) toast.error(data.error || 'Sync failed'); return; }
    await loadContest(); await loadSubmissions();
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
      setLoadingText('Fetching Problem Data...'); setSyncing(true);
      const p = await lookupProblem(newProblemPlatform, newProblemCode);
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems`, { method: 'POST', headers: viewerHeaders(session), body: JSON.stringify(p) });
      const data = await res.json();
      setSyncing(false);
      if (!res.ok) return toast.error(data.error || 'Could not add problem');
      toast.success('Problem added successfully.'); setContest(data); setNewProblemCode('');
    } catch (e: any) { setSyncing(false); toast.error(e.message || 'Could not add problem'); }
  }

  async function generateAITestcases(problemId: string) {
    const masterSolution = prompt('To generate accurate system test cases, the AI needs a correct Master Solution. Please paste working code here:');
    if (!masterSolution) return;
    setGeneratingTcFor(problemId);
    try {
      const res = await fetch(`${API_V2_BASE_URL}/problems/${problemId}/generate-ai-testcases`, { method: 'POST', headers: viewerHeaders(session), body: JSON.stringify({ masterSolution }) });
      const data = await res.json();
      if (res.ok) toast.success(`Successfully generated ${data.generatedCount} new system test cases!`);
      else toast.error(data.error || 'Failed to generate test cases.');
    } catch (e: any) { toast.error('Network error while connecting to AI.'); } 
    finally { setGeneratingTcFor(null); }
  }

  async function generateAIRecommendations() {
    if (!id || !session) return;
    setIsRecommending(true); setLoadingText('Curating Recommendations...'); setSyncing(true);
    try {
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/recommend-problems`, { method: 'POST', headers: viewerHeaders(session) });
      const data = await res.json();
      if (res.ok) toast.success(`AI Recommended: ${data.recommendations.map((r: any) => r.name || r.title).join(', ')}`);
      else toast.error(data.error || 'Failed to fetch AI recommendations');
    } catch (e) { toast.error('Network error while generating recommendations.'); } 
    finally { setIsRecommending(false); setSyncing(false); }
  }

  async function removeProblem(problemId: string) {
    if (!id || !session || !confirm('Remove this problem from the live contest?')) return;
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems/${problemId}`, { method: 'DELETE', headers: viewerHeaders(session) });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error || 'Could not remove problem');
    toast.success('Problem removed.'); setContest(data);
  }

  async function replaceProblem(problemId: string) {
    if (!id || !session) return;
    const code = prompt('Enter replacement Codeforces problem code, e.g. 1805A');
    if (!code) return;
    try {
      setLoadingText('Replacing Problem...'); setSyncing(true);
      const p = await lookupProblem('Codeforces', code);
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems/${problemId}`, { method: 'PUT', headers: viewerHeaders(session), body: JSON.stringify(p) });
      const data = await res.json();
      setSyncing(false);
      if (!res.ok) return toast.error(data.error || 'Could not replace problem');
      toast.success('Problem replaced successfully.'); setContest(data);
    } catch (e: any) { setSyncing(false); toast.error(e.message || 'Could not replace problem'); }
  }

  async function submitReport() {
    if (!selectedSubmission || !reportReason.trim()) return;
    const res = await fetch(`${API_BASE_URL}/api/submissions/${selectedSubmission.id}/report`, { method: 'POST', headers: viewerHeaders(session), body: JSON.stringify({ reason: reportReason }) });
    if (res.ok) { toast.success('Report submitted successfully to the contest owner.'); setReportReason(''); } 
    else { const data = await res.json(); toast.error(data.error || 'Failed to report submission'); }
  }
  
  async function finalizeContest() {
    if (!id || !session || !confirm('End this contest immediately and calculate final ratings/coins? This cannot be undone.')) return;
    setLoadingText('Calculating Final Ratings & Coins...'); setSyncing(true); 
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/finalize`, { method: 'POST', headers: viewerHeaders(session) });
    const data = await res.json();
    setSyncing(false);
    if (!res.ok) return toast.error(data.error || 'Could not finalize contest');
    playSuccessSound(); toast.success(data.message || 'Contest finalized!'); router.push(`/contests/${id}/final`);
  }

  async function submitOverride() {
    if (!selectedSubmission || overridePoints === '') return;
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/submissions/${selectedSubmission.id}/override`, { method: 'POST', headers: viewerHeaders(session), body: JSON.stringify({ manualPoints: Number(overridePoints) }) });
    if (res.ok) {
      toast.success('Points overridden successfully. Standings will recalculate instantly.');
      setSelectedSubmission(null); await loadSubmissions(); await loadContest(); 
    } else { const data = await res.json(); toast.error(data.error || 'Failed to override points'); }
  }

  // 👉 FIXED: Ensure Chatbox is available to everyone!
  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    
    if (contest?.viewerMember?.teamId && socketRef.current) {
      // Send to Private Team Room
      socketRef.current.emit('sendTeamMessage', {
        contestId: id, teamId: contest.viewerMember.teamId, senderId: contest.viewerMember.user?.id || contest.viewerMember.userId, content: chatInput.trim()
      });
    } else if (socketRef.current) {
      // Send to Global Lobby (Solo players)
      socketRef.current.emit('sendLobbyMessage', { contestId: id, sender: session?.user?.name || 'Guest', text: chatInput.trim(), time: Date.now() });
    }
    setChatInput('');
  };

  const sendLobbyMsg = () => {
    if(!lobbyChat.trim()) return;
    socketRef.current?.emit('sendLobbyMessage', { contestId: id, sender: session?.user?.name || 'Guest', text: lobbyChat.trim(), time: Date.now() });
    setLobbyChat('');
  };

  const toggleVoice = async () => {
    if (!contest?.viewerMember?.teamId) return toast.error("You must be in a team to use voice chat. Solos can only use Text Chat.");

    if (voiceStatus === 'connected' || voiceStatus === 'connecting') {
      setVoiceStatus('disconnected');
      socketRef.current?.emit('leave-voice', contest.viewerMember.teamId);
      if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(track => track.stop()); localStreamRef.current = null; }
      Object.values(peersRef.current).forEach(pc => pc.close()); peersRef.current = {};
      toast.success("Voice disconnected.");
    } else {
      setVoiceStatus('connecting');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream; setVoiceStatus('connected');
        socketRef.current?.emit('join-voice', contest.viewerMember.teamId);
        toast.success("Voice channel joined!");
      } catch (err) {
        console.error('Mic access denied:', err); setVoiceStatus('disconnected'); toast.error("Microphone access denied.");
      }
    }
  };

  useEffect(() => { loadContest(); loadSubmissions(); }, [id, session?.user?.email, session?.user?.name]);
  
  useEffect(() => {
    if (!id || !session || isFinal || !contest) return;
    
    socketRef.current = io(API_BASE_URL, { transports: ['websocket'], reconnection: true });
    const socket = socketRef.current;
    
    socket.on('connect', () => { 
      socket.emit('joinContest', id); 
      if (contest.viewerMember?.teamId) socket.emit('joinTeam', contest.viewerMember.teamId);
    });

    socket.on('lobbyMessage', (msg) => { setLobbyMessages(prev => [...prev, msg]); });
    socket.on('standings:update', () => { loadContest(); });
    
    socket.on('submission:judged', (sub) => { 
      loadSubmissions();
      if (sub.verdict === 'ACCEPTED' && sub.userId === (session?.user?.name || session?.user?.email)) playSuccessSound();
    });

    socket.on('teamMessage', (incomingMessage) => {
      setMessages((prev) => {
        if (prev.some(m => m.id === incomingMessage.id)) return prev;
        return [...prev, incomingMessage];
      });
    });

    socket.on('team_problem_solved', (data) => {
      if (data.userId !== (session.user?.name || session.user?.email)) {
        toast.success(`🎉 A teammate just solved a problem!`, { duration: 5000, icon: '🚀' }); playSuccessSound();
      }
      loadSubmissions();
    });

    socket.on('user-joined-voice', async (peerId) => {
      if (!localStreamRef.current) return;
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      peersRef.current[peerId] = pc;
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current!));
      pc.ontrack = (event) => { const audio = new Audio(); audio.srcObject = event.streams[0]; audio.autoplay = true; audio.play().catch(e => console.log('Audio play blocked:', e)); };
      pc.onicecandidate = (event) => { if (event.candidate) socket.emit('voice-ice-candidate', { to: peerId, candidate: event.candidate }); };
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer); socket.emit('voice-offer', { to: peerId, offer });
    });

    socket.on('voice-offer', async ({ from, offer }) => {
      if (!localStreamRef.current) return;
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      peersRef.current[from] = pc;
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current!));
      pc.ontrack = (event) => { const audio = new Audio(); audio.srcObject = event.streams[0]; audio.autoplay = true; audio.play().catch(e => console.log('Audio play blocked:', e)); };
      pc.onicecandidate = (event) => { if (event.candidate) socket.emit('voice-ice-candidate', { to: from, candidate: event.candidate }); };
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); socket.emit('voice-answer', { to: from, answer });
    });

    socket.on('voice-answer', async ({ from, answer }) => { const pc = peersRef.current[from]; if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer)); });
    socket.on('voice-ice-candidate', async ({ from, candidate }) => { const pc = peersRef.current[from]; if (pc && pc.remoteDescription) { try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e){} } });
    socket.on('user-left-voice', (peerId) => { if (peersRef.current[peerId]) { peersRef.current[peerId].close(); delete peersRef.current[peerId]; } });

    return () => { 
      socket.disconnect(); socketRef.current = null;
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => track.stop());
      Object.values(peersRef.current).forEach(pc => pc.close());
    };
  }, [id, session, isFinal, contest?.viewerMember?.teamId]);
  
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, lobbyMessages]);
  useEffect(() => { if (!id || !contest || isFinal) return; if (timeLeft === 0 && !isScheduledLockScreen) { setTimeout(() => window.location.reload(), 2000); } }, [timeLeft, id, contest, isFinal, isScheduledLockScreen]);
  useEffect(() => { if (isFinal) playSuccessSound(); }, [isFinal]);

  const problemById = useMemo(() => Object.fromEntries((contest?.problems || []).map((p: any, i: number) => [p.id, { ...p, label: String.fromCharCode(65 + i) }])), [contest]);
  const memberById = useMemo(() => Object.fromEntries((contest?.members || contest?.participants || []).map((m: any) => [m.id, m])), [contest]);
  
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
        if (rowMemberId === myMemberInfo.id || (myTeam !== 'Individuals' && subTeam === myTeam)) solvedSet.add(sub.problemId);
      }
    });
    return solvedSet;
  }, [contest, submissions, memberById]);

  const individualStandings = useMemo(() => {
    return (contest?.standings || []).sort((a: any, b: any) => a.rank - b.rank).map((s: any) => ({
      ...s, name: memberById[s.memberId]?.name || memberById[s.memberId]?.user?.name || 'Unknown', team: memberById[s.memberId]?.teamName || memberById[s.memberId]?.team || 'Individuals'
    }));
  }, [contest, memberById]);

  const teamStandings = useMemo(() => {
    const grouped: Record<string, any> = {};
    (contest?.standings || []).forEach((standing: any) => {
      const member = memberById[standing.memberId] || {};
      const team = member.teamName || member.team || 'Individuals';
      if (!grouped[team]) grouped[team] = { team, solved: 0, penalty: 0, score: 0, players: [] };
      let safeScore = standing.score || 0;
      if (safeScore === 0 && standing.solvedProblems) safeScore = standing.solvedProblems.reduce((sum: number, pId: string) => sum + (problemById[pId]?.points || 1000), 0);
      grouped[team].solved += standing.solved || 0; grouped[team].penalty += standing.penalty || 0; grouped[team].score += safeScore;
      grouped[team].players.push({ ...standing, codeforcesHandle: member.codeforcesHandle || member.externalHandle?.handle, team, score: safeScore });
    });
    return Object.values(grouped).map((team: any) => ({ ...team, players: team.players.sort((a: any, b: any) => b.solved - a.solved || a.penalty - b.penalty) })).sort((a: any, b: any) => b.solved - a.solved || a.penalty - b.penalty || a.team.localeCompare(b.team));
  }, [contest, memberById, problemById]);

  const canInspectMember = (memberId: string) => {
    if (isOwner || isFinal || timeLeft === 0) return true;
    const member = memberById[memberId];
    return Boolean(viewerMember && (viewerMember.id === memberId || (viewerMember.teamId && member?.teamId === viewerMember.teamId) || (viewerMember.team && viewerMember.team !== 'Individuals' && member?.team === viewerMember.team)));
  };

  const memberSubmissions = selectedMember ? submissions.filter((submission) => submission.memberId === selectedMember.memberId || submission.participantId === selectedMember.memberId) : [];
  const mySubmissions = viewerMember ? submissions.filter((s) => s.memberId === viewerMember.id || s.participantId === viewerMember.id || s.userId === (session?.user?.name || session?.user?.email)) : [];
  const myTotalAttempts = mySubmissions.length;

  const myAccepted = mySubmissions.filter(s => String(s.verdict).includes('ACCEPT') || String(s.verdict) === 'OK').length;
  const myAccuracy = myTotalAttempts > 0 ? Math.round((myAccepted / myTotalAttempts) * 100) : 0;
  const myStanding = viewerMember ? individualStandings.find((s: any) => s.memberId === viewerMember.id || s.participantId === viewerMember.id) : null;

  const totalPlayers = individualStandings.length || 1;
  const myRank = myStanding?.rank || totalPlayers;
  const percentile = Math.round(((totalPlayers - myRank) / totalPlayers) * 100);

  const ratingBefore = viewerMember?.ratingBefore || viewerMember?.user?.rating || 1200;
  const ratingAfter = viewerMember?.ratingAfter || ratingBefore;
  const ratingDelta = ratingAfter - ratingBefore;
  const earnedCoins = viewerMember?.user?.coins || 0;

  const performanceMatrix = (contest?.problems || []).map((p: any) => {
    const subs = mySubmissions.filter(s => s.problemId === (p.problemId || p.id) || s.contestProblemId === p.id);
    const isAccepted = subs.some(s => String(s.verdict) === 'ACCEPTED' || String(s.verdict) === 'OK');
    const isWrong = subs.length > 0 && !isAccepted;
    return { label: p.label, title: p.titleSnapshot || p.title, status: isAccepted ? 'Correct' : isWrong ? 'Wrong' : 'Unattempted' };
  });

  const CentralSpinner = ({ text }: { text: string }) => (
    <main style={{ ...page, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} style={{ width: 48, height: 48, border: '4px solid rgba(103, 232, 249, 0.2)', borderTopColor: '#67e8f9', borderRadius: '50%' }} />
      <h2 style={{ color: '#a8b3c7', marginTop: 16 }}>{text}</h2>
    </main>
  );

  if (status === 'loading') return <CentralSpinner text="Checking account..." />;
  if (!session) return <main style={page}><section style={gate}><h1>Sign in required</h1><p style={{ color: '#a8b3c7' }}>Sign in first.</p><a href="/signin" style={primaryLink}>Sign in with Google</a></section></main>;
  if (error) return <main style={page}><h1>{error}</h1><a href="/contests" style={link}>Back to contests</a></main>;
  if (!contest) return <CentralSpinner text="Loading contest room..." />;

  const isActuallyOwnerMode = isOwner && ownerMode === 'ADMIN';

  return (
    <main style={page}>
      <Toaster position="top-center" toastOptions={{ style: { background: '#1e293b', color: '#fff', border: '1px solid #475569' } }} />

      <AnimatePresence>
        {syncing && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.85)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
          >
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} style={{ width: 64, height: 64, border: '5px solid rgba(103, 232, 249, 0.2)', borderTopColor: '#67e8f9', borderRadius: '50%' }} />
            <motion.h2 initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} style={{ color: '#67e8f9', marginTop: 24, fontSize: 24 }}>{loadingText}</motion.h2>
          </motion.div>
        )}
      </AnimatePresence>

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
                   <thead><tr><th style={th}>Time</th><th style={th}>Problem</th><th style={th}>Verdict</th><th style={th}>Language</th><th style={th}>Action</th></tr></thead>
                   <tbody>
                     {memberSubmissions.map(sub => (
                        <tr key={sub.id} style={clickRow} onClick={() => setSelectedSubmission(sub)}>
                          <td style={td}>{new Date(sub.createdAt).toLocaleString()}</td>
                          <td style={td}>{problemById[sub.problemId]?.label || ''} {canSeeProblemMeta ? problemById[sub.problemId]?.titleSnapshot : ''}</td>
                          <td style={{...td, color: sub.verdict.includes('ACCEPT') ? '#4ade80' : '#f87171'}}>{sub.verdict}</td>
                          <td style={td}>{sub.language}</td>
                          <td style={td}><button style={ghostButton}>View</button></td>
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
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <a href="/" style={link}>DivineCode</a>
            {isOwner && !isFinal && (
              <div style={{ background: '#0f172a', borderRadius: 8, padding: 4, display: 'flex', border: '1px solid #334155' }}>
                <button onClick={() => setOwnerMode('ADMIN')} style={{ ...ghostButton, margin: 0, background: ownerMode === 'ADMIN' ? '#38bdf8' : 'transparent', color: ownerMode === 'ADMIN' ? '#000' : '#94a3b8', border: 'none' }}>🛡️ Edit Mode</button>
                <button onClick={() => setOwnerMode('PARTICIPANT')} style={{ ...ghostButton, margin: 0, background: ownerMode === 'PARTICIPANT' ? '#38bdf8' : 'transparent', color: ownerMode === 'PARTICIPANT' ? '#000' : '#94a3b8', border: 'none' }}>🎮 Play Mode</button>
              </div>
            )}
          </div>
          <div style={userPill}>{session.user?.name || session.user?.email}</div>
        </nav>

        <div style={hero}>
          <div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
               {displayStatus === 'SCHEDULED' && <span style={badgeScheduled}>⏳ Scheduled</span>}
               {displayStatus === 'RUNNING' && <span style={badgeLive}>🔴 Ongoing Live</span>}
               {displayStatus === 'ENDED' && <span style={badgeEnded}>✅ Completed</span>}
               <p style={{...eyebrow, margin: 0}}>{isFinal ? 'Final standings' : isActuallyOwnerMode ? 'Owner control room' : 'Player contest room'}</p>
            </div>
            <h1 style={{ fontSize: 46, margin: 0 }}>{contest.title}</h1>
            <p style={{ color: '#a8b3c7' }}>{isActuallyOwnerMode ? 'You are viewing as Admin. You can edit, sync, and delete this mashup.' : 'Problem ratings and hidden tests are sealed during the live contest.'}</p>
            <p style={{ color: '#67e8f9' }}>{isFinal ? 'Read-only final board' : `Last sync: ${lastSync}`}</p>
          </div>
          <div style={timerCard}>
            <strong>{displayStatus === 'ENDED' || isFinal ? 'FINAL' : isScheduledLockScreen ? 'WAITING' : `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}`}</strong>
            <span>{displayStatus === 'ENDED' || isFinal ? 'standings' : isScheduledLockScreen ? 'to start' : 'remaining'}</span>
          </div>
        </div>

        {isFinal && viewerMember && (
          <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ ...panel, marginBottom: 18, background: 'linear-gradient(145deg, #0f172a, #1e1b4b)', border: '1px solid #6366f1' }}>
            <h2 style={{ color: '#a5b4fc', margin: '0 0 15px 0' }}>🏆 Post-Contest Performance Report</h2>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 15, marginBottom: 20 }}>
              <div style={{ background: '#020617', padding: 15, borderRadius: 12, border: '1px solid #334155', textAlign: 'center' }}>
                <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 5 }}>Final Rank</div>
                <div style={{ color: '#fbbf24', fontSize: 32, fontWeight: 'bold' }}>#{myRank}</div>
              </div>
              <div style={{ background: '#020617', padding: 15, borderRadius: 12, border: '1px solid #334155', textAlign: 'center' }}>
                <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 5 }}>Percentile</div>
                <div style={{ color: percentile >= 80 ? '#4ade80' : '#fbbf24', fontSize: 32, fontWeight: 'bold' }}>Top {100 - percentile}%</div>
              </div>
              <div style={{ background: '#020617', padding: 15, borderRadius: 12, border: '1px solid #334155', textAlign: 'center' }}>
                <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 5 }}>Rating Update</div>
                <div style={{ color: ratingDelta > 0 ? '#4ade80' : ratingDelta < 0 ? '#f87171' : '#cbd5e1', fontSize: 32, fontWeight: 'bold' }}>
                  {ratingAfter} <span style={{ fontSize: 16 }}>{ratingDelta > 0 ? `(+${ratingDelta})` : ratingDelta < 0 ? `(${ratingDelta})` : ''}</span>
                </div>
              </div>
              <div style={{ background: '#020617', padding: 15, borderRadius: 12, border: '1px solid #334155', textAlign: 'center' }}>
                <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 5 }}>Coins Earned</div>
                <div style={{ color: '#fcd34d', fontSize: 32, fontWeight: 'bold' }}>+💰{earnedCoins}</div>
              </div>
            </div>

            <h3 style={{ color: '#cbd5e1', margin: '0 0 10px 0' }}>Problem Matrix</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10 }}>
              {performanceMatrix.map(pm => (
                <div key={pm.label} style={{ background: pm.status === 'Correct' ? 'rgba(74, 222, 128, 0.15)' : pm.status === 'Wrong' ? 'rgba(248, 113, 113, 0.15)' : 'rgba(30, 41, 59, 0.5)', border: `1px solid ${pm.status === 'Correct' ? '#4ade80' : pm.status === 'Wrong' ? '#f87171' : '#334155'}`, padding: 12, borderRadius: 8, textAlign: 'center' }}>
                  <strong style={{ display: 'block', color: '#e2e8f0', fontSize: 18 }}>{pm.label}</strong>
                  <span style={{ fontSize: 12, color: pm.status === 'Correct' ? '#4ade80' : pm.status === 'Wrong' ? '#f87171' : '#64748b' }}>{pm.status}</span>
                </div>
              ))}
            </div>

            <div style={{ background: 'rgba(56, 189, 248, 0.05)', border: '1px solid rgba(56, 189, 248, 0.3)', padding: 15, borderRadius: 12, marginTop: 20 }}>
              <h3 style={{ margin: '0 0 10px 0', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 8 }}>🤖 AI Mentor Analysis</h3>
              <p style={{ color: '#e2e8f0', margin: 0, lineHeight: 1.6 }}>
                {myAccuracy >= 80 
                  ? "Excellent problem-solving accuracy! To reach the next rating tier, focus on speed and minimizing testcase penalties on the hardest problems." 
                  : "Your accuracy can be improved. You spent significant time on edge cases. Review the hidden test cases generated by the AI and practice the recommended problems below."}
              </p>
            </div>
          </motion.section>
        )}

        <PostContestAiRecommendations contestId={id as string} contestStatus={displayStatus} />

        {!isActuallyOwnerMode && !viewerMember && displayStatus !== 'ENDED' && (
          <section style={{ ...panel, marginBottom: 18, border: '1px solid #38bdf8', background: 'linear-gradient(180deg, #0f172a, rgba(56, 189, 248, 0.05))', textAlign: 'center' }}>
            <h2 style={{color: '#38bdf8', margin: '0 0 10px 0', fontSize: 28}}>Register for {contest.title}</h2>
            <p style={{color: '#a8b3c7', marginBottom: 25}}>Configure your play style to enter the lobby.</p>
            
            <div style={{ display: 'flex', justifyContent: 'center', gap: 15, marginBottom: 20 }}>
              <button onClick={() => setRegMode('SOLO')} style={regMode === 'SOLO' ? activeTabBox : inactiveTabBox}>👤 Register as Solo</button>
              <button onClick={() => setRegMode('TEAM_NEW')} style={regMode === 'TEAM_NEW' ? activeTabBox : inactiveTabBox}>👥 Create a Team</button>
              <button onClick={() => setRegMode('TEAM_JOIN')} style={regMode === 'TEAM_JOIN' ? activeTabBox : inactiveTabBox}>🤝 Join via Invite Code</button>
            </div>

            <div style={{ maxWidth: 400, margin: '0 auto', textAlign: 'left' }}>
              <label style={tcLabel}>Codeforces Handle (Required for sync)</label>
              <input placeholder="tourist" style={smallInput} value={regHandle} onChange={e => setRegHandle(e.target.value)} />

              {regMode === 'TEAM_NEW' && (
                <>
                  <label style={tcLabel}>New Team Name</label>
                  <input placeholder="Runtime Terrors" style={smallInput} value={regTeamName} onChange={e => setRegTeamName(e.target.value)} />
                </>
              )}

              {regMode === 'TEAM_JOIN' && (
                <>
                  <label style={tcLabel}>6-Digit Invite Code</label>
                  <input placeholder="ABC-123" style={smallInput} value={regInviteCode} onChange={e => setRegInviteCode(e.target.value)} />
                </>
              )}

              <button onClick={registerForContest} disabled={isRegistering} style={{...primaryButton, marginTop: 15}}>{isRegistering ? 'Registering...' : 'Complete Registration'}</button>
            </div>
          </section>
        )}

        {isScheduledLockScreen && !isActuallyOwnerMode ? (
          <section style={{...panel, textAlign: 'center', padding: '60px 20px', border: '1px solid rgba(251, 191, 36, 0.4)', background: 'linear-gradient(180deg, rgba(15,23,42,0.9), rgba(251,191,36,0.05))'}}>
             <h2 style={{ fontSize: 32, marginBottom: 10, color: '#fbbf24', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>Contest has not started yet</h2>
             {viewerMember?.teamName && viewerMember.teamName !== 'Individuals' && viewerMember.teamName !== 'Solo' && (
               <p style={{ color: '#38bdf8', fontSize: 18, fontWeight: 'bold' }}>
                 Your Team Invite Code: <span style={{ background: '#020617', padding: '4px 10px', borderRadius: 6, border: '1px dashed #38bdf8', letterSpacing: 2 }}>{viewerMember.team?.inviteCode}</span>
               </p>
             )}
             <p style={{color: '#a8b3c7', fontSize: 18}}>Problems will be revealed when the countdown reaches zero.</p>
             <div style={{fontSize: 48, fontWeight: 'bold', color: '#67e8f9', marginTop: 20, fontFamily: 'monospace'}}>{formatCountdown(startTimeMs - nowTick)}</div>
             
             {canUnregister && (
               <div style={{ marginTop: 30 }}>
                 <button onClick={unregisterFromContest} style={{...dangerButton, width: 'auto'}}>Unregister from Contest</button>
               </div>
             )}
          </section>
        ) : (
          <>
            {canUnregister && (
              <section style={{ ...panel, marginBottom: 18, padding: 16 }}>
                <p style={{ color: '#94a3b8', display: 'inline-block', marginRight: 15 }}>Not ready? You can unregister before half-time.</p>
                <button onClick={unregisterFromContest} style={{...dangerButton, width: 'auto', marginBottom: 0}}>Unregister from Contest</button>
              </section>
            )}

            <div style={grid}>
              {isActuallyOwnerMode && !isFinal && <section style={panel}>
                <h2>Owner controls</h2>
                <a href={`/contests/${contest.id}/edit`} style={primaryButton}>Open editing page</a>
                <button onClick={() => syncCodeforces(false)} style={primaryButton}>Sync Codeforces now</button>
                <button onClick={() => extendTime(15)} style={ghostButton}>+15 min</button>
                <button onClick={() => extendTime(30)} style={ghostButton}>+30 min</button>
                <button onClick={finalizeContest} style={{...primaryButton, background: 'linear-gradient(135deg, #f59e0b, #fbbf24)', color: '#000'}}>End Contest & Calculate Ratings</button>
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
                    <span style={{ color: '#67e8f9' }}>{m.teamName || m.team || 'Individuals'} - CF: {m.externalHandle?.handle || m.codeforcesHandle || m.handle || 'missing'}</span>
                  </p>
                ))}
              </section>}

              <section style={isActuallyOwnerMode && !isFinal ? panelWide : { ...panelWide, gridColumn: '1 / -1' }}>
                <h2>Problems</h2>
                {contest.problems.length === 0 ? (
                  <p style={{ color: '#94a3b8' }}>No problems queued yet.</p>
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {contest.problems.map((p: any, index: number) => {
                      const label = String.fromCharCode(65 + index);
                      const actualTitle = p.titleSnapshot || p.problem?.title || `Problem ${label}`;
                      const visibleTitle = canSeeProblemMeta ? actualTitle : `Problem ${label}`;
                      const safeProblemHref = `/contests/${contest.id}/problems/${p.id}`; 
                      const isSolvedByTeam = teamSolvedProblemIds.has(p.id);

                      return <div key={p.id} style={{ ...problemRow, borderColor: isSolvedByTeam ? 'rgba(74, 222, 128, 0.4)' : 'rgba(148,163,184,.16)' }}>
                        <strong style={{ color: '#67e8f9', fontSize: 22 }}>{label}</strong>
                        <div>
                          <a href={safeProblemHref} style={{ color: '#eef2ff', fontWeight: 900, textDecoration: 'none' }}>{visibleTitle}</a>
                          <p style={{ margin: '6px 0 0', color: '#94a3b8' }}>
                            {canSeeProblemMeta ? `${p.platform} - Rating ${p.problem?.rating || p.rating || p.difficulty || 'Practice'} · ${p.points || 1000} pts` : `${p.platform} - rating hidden during contest`}
                          </p>
                        </div>
                        
                        {isSolvedByTeam && (
                          <div style={{ display: 'flex', alignItems: 'center', color: '#4ade80', fontWeight: 'bold' }}>
                            <svg style={{ width: 20, height: 20, marginRight: 4 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                            Solved
                          </div>
                        )}

                        {!isFinal && displayStatus !== 'ENDED' && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <a href={safeProblemHref} style={primaryLink}>{isSolvedByTeam ? 'Review problem' : 'Open problem'}</a>
                          {isActuallyOwnerMode && (
                            <>
                              <button onClick={() => generateAITestcases(p.problemId || p.id)} disabled={generatingTcFor === (p.problemId || p.id)} style={{...ghostButton, color: '#a5b4fc', borderColor: 'rgba(99, 102, 241, 0.4)'}}>
                                {generatingTcFor === (p.problemId || p.id) ? 'Generating...' : '🤖 Generate Hidden Test Cases'}
                              </button>
                              <button onClick={() => replaceProblem(p.id)} style={ghostButton}>Replace</button>
                              <button onClick={() => removeProblem(p.id)} style={dangerButton}>✖ Delete</button>
                            </>
                          )}
                        </div>}
                      </div>;
                    })}
                  </div>
                )}
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
                      <th style={th}>Rank</th><th style={th}>{standingsMode === 'team' ? 'Group' : 'Player'}</th><th style={th}>Solved</th><th style={th}>Penalty</th><th style={th}>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standingsMode === 'team' && teamStandings.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#94a3b8' }}>No teams on the board yet.</td></tr>}
                    {standingsMode === 'individual' && individualStandings.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#94a3b8' }}>No individuals on the board yet.</td></tr>}

                    {standingsMode === 'team' 
                      ? teamStandings.map((team: any, i: number) => (
                          <Fragment key={team.team}>
                            <tr onClick={() => setOpenTeam(openTeam === team.team ? null : team.team)} style={clickRow}>
                              <td style={td}>#{i + 1}</td><td style={td}>{team.team}</td><td style={td}>{team.solved}</td><td style={td}>{team.penalty}</td><td style={{...td, color: '#fbbf24', fontWeight: 'bold'}}>{team.score}</td>
                            </tr>
                            {openTeam === team.team && team.players.map((player: any, pi: number) => (
                              <tr key={player.memberId} onClick={() => canInspectMember(player.memberId) && setSelectedMember(player)} style={canInspectMember(player.memberId) ? subRow : mutedRow}>
                                <td style={td}>#{pi + 1}</td><td style={td}>{player.name}</td><td style={td}>{player.solved}</td><td style={td}>{player.penalty}</td><td style={td}>{player.score}</td>
                              </tr>
                            ))}
                          </Fragment>
                        ))
                      : individualStandings.map((player: any) => (
                          <tr key={player.memberId} onClick={() => canInspectMember(player.memberId) && setSelectedMember(player)} style={canInspectMember(player.memberId) ? clickRow : mutedRow}>
                            <td style={td}>#{player.rank}</td><td style={td}>{player.name} <span style={{ color: '#94a3b8', fontSize: 12 }}>({player.team})</span></td><td style={td}>{player.solved || 0}</td><td style={td}>{player.penalty || 0}</td><td style={{...td, color: '#fbbf24', fontWeight: 'bold'}}>{player.score || 0}</td>
                          </tr>
                        ))
                    }
                  </tbody>
                </table>
              </div>
            </section>
            
            <section style={{ ...panel, marginTop: 18 }}>
              <h2>
                {isFinal || timeLeft === 0 ? 'All submissions' : isActuallyOwnerMode ? 'All submissions' : contest.visibility?.submissionScope === 'team' ? 'Team submissions' : 'Your submissions'}
              </h2>
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
                        <th style={th}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map((sub: any, index: number) => (
                        <tr key={sub.id || index} style={{ borderBottom: '1px solid #334155' }}>
                          <td style={td}>{new Date(sub.createdAt).toLocaleTimeString()}</td>
                          <td style={td}>{sub.userId}</td>
                          <td style={td}>{problemById[sub.problemId]?.label || sub.problemId}</td>
                          <td style={td}>
                            <strong style={{ color: String(sub.verdict).includes('ACCEPT') ? '#4ade80' : '#f87171' }}>
                              {sub.verdict}
                            </strong>
                          </td>
                          <td style={td}>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                              <button onClick={() => setSelectedSubmission(sub)} style={{...ghostButton, margin: 0, padding: '5px 10px', fontSize: 12}}>View Code</button>
                              {sub.externalSubmissionUrl && (
                                <a href={sub.externalSubmissionUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#38bdf8', textDecoration: 'underline', fontSize: '12px' }}>
                                  👉 View original
                                </a>
                              )}
                            </div>
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
                
                {selectedSubmission.code && (
                  <div style={{marginTop: 12}}>
                    <strong style={{color: '#cbd5e1'}}>Source Code:</strong>
                    <div style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(148,163,184,.2)' }}>
                      <SyntaxHighlighter language={selectedSubmission.language?.toLowerCase().includes('python') ? 'python' : selectedSubmission.language?.toLowerCase().includes('java') ? 'java' : 'cpp'} style={vscDarkPlus} customStyle={{ margin: 0, padding: 16, maxHeight: 400, background: '#020617' }} showLineNumbers={true}>{selectedSubmission.code}</SyntaxHighlighter>
                    </div>
                  </div>
                )}
                
                {selectedSubmission.manualPoints !== null && selectedSubmission.manualPoints !== undefined && <p style={{ color: '#fbbf24', marginTop: 10 }}><b>Manual Override Points:</b> {selectedSubmission.manualPoints}</p>}
                
                {isActuallyOwnerMode && selectedSubmission.externalSubmissionId && <a href={`https://codeforces.com/contest/${problemById[selectedSubmission.problemId]?.contestCode}/submission/${selectedSubmission.externalSubmissionId}`} target="_blank" rel="noreferrer" style={{...primaryLink, marginTop: 10}}>Open Codeforces submission</a>}
                
                {isFinal && !isActuallyOwnerMode && selectedSubmission.userId !== (session?.user?.name || session?.user?.email) && (
                  <div style={{ marginTop: 16, borderTop: '1px solid rgba(148,163,184,.2)', paddingTop: 16 }}>
                    <h4 style={{ margin: '0 0 8px 0', color: '#f87171' }}>Report Discrepancy</h4>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input style={{...smallInput, marginBottom: 0}} placeholder="Suspected AI, Hardcoded, etc." value={reportReason} onChange={e => setReportReason(e.target.value)} />
                      <button style={{...ghostButton, borderColor: 'rgba(248,113,113,.4)', color: '#fecaca', marginBottom: 0}} onClick={submitReport}>Report</button>
                    </div>
                  </div>
                )}

                {isActuallyOwnerMode && (
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

      {/* 👉 FIXED: Chat Box logic - Solo players get a Global Chat, Teams get Team Chat */}
      {!isFinal && viewerMember && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 999 }}>
          {isChatOpen ? (
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} style={{ width: 320, height: 400, background: '#0f172a', border: '1px solid #6366f1', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
              
              <div style={{ background: '#1e1b4b', padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #312e81' }}>
                <strong style={{ color: '#a5b4fc' }}>{viewerMember.teamId ? 'Team Chat' : 'Global Contest Chat'}</strong>
                <div style={{ display: 'flex', gap: 8 }}>
                  {viewerMember.teamId && (
                    <button onClick={toggleVoice} style={{ background: voiceStatus === 'connected' ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.1)', color: voiceStatus === 'connected' ? '#4ade80' : '#fff', border: `1px solid ${voiceStatus === 'connected' ? '#4ade80' : 'transparent'}`, borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>
                      {voiceStatus === 'connected' ? '🟢 Voice On' : voiceStatus === 'connecting' ? '⏳ Connecting...' : '🎤 Join Voice'}
                    </button>
                  )}
                  <button onClick={() => setIsChatOpen(false)} style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 18 }}>✖</button>
                </div>
              </div>

              <div style={{ flex: 1, padding: 12, overflowY: 'auto', color: '#94a3b8', fontSize: 14 }}>
                {viewerMember.teamId ? (
                  // Team Message UI
                  messages.length === 0 ? <p style={{ textAlign: 'center', marginTop: '40%' }}>No messages yet. Say hi!</p> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {messages.map(msg => (
                        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} key={msg.id} style={{ background: 'rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}><strong style={{ color: '#67e8f9' }}>{msg.sender?.username || 'Teammate'}</strong><span style={{ color: '#64748b' }}>{new Date(msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
                          <div style={{ color: '#e2e8f0', wordBreak: 'break-word' }}>{msg.content}</div>
                        </motion.div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>
                  )
                ) : (
                  // Global Message UI (Solo Player)
                  lobbyMessages.length === 0 ? <p style={{ textAlign: 'center', marginTop: '40%' }}>No global messages yet.</p> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {lobbyMessages.map((msg, i) => (
                        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} key={i} style={{ background: 'rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}><strong style={{ color: '#a5b4fc' }}>{msg.sender}</strong></div>
                          <div style={{ color: '#e2e8f0', wordBreak: 'break-word' }}>{msg.text}</div>
                        </motion.div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>
                  )
                )}
              </div>
              <div style={{ padding: 12, borderTop: '1px solid #334155', display: 'flex', gap: 8 }}>
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} placeholder="Type a message..." style={{ ...smallInput, margin: 0, flex: 1 }} />
                <button onClick={handleSendMessage} style={{ ...primaryButton, width: 'auto', margin: 0 }}>Send</button>
              </div>
            </motion.div>
          ) : (
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setIsChatOpen(true)} style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: '50%', width: 56, height: 56, cursor: 'pointer', boxShadow: '0 4px 12px rgba(99,102,241,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
            </motion.button>
          )}
        </div>
      )}
    </main>
  );
}

// STYLES
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

const badgeScheduled: CSSProperties = { background: 'rgba(251, 191, 36, 0.1)', color: '#fbbf24', padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(251, 191, 36, 0.4)', fontSize: 12, fontWeight: 'bold' };
const badgeLive: CSSProperties = { background: 'rgba(248, 113, 113, 0.1)', color: '#f87171', padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(248, 113, 113, 0.4)', fontSize: 12, fontWeight: 'bold' };
const badgeEnded: CSSProperties = { background: 'rgba(74, 222, 128, 0.1)', color: '#4ade80', padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(74, 222, 128, 0.4)', fontSize: 12, fontWeight: 'bold' };
const activeTabBox: CSSProperties = { padding: '12px 18px', background: '#38bdf8', color: '#000', borderRadius: 12, fontWeight: 'bold', border: 'none', cursor: 'pointer', flex: 1 };
const inactiveTabBox: CSSProperties = { padding: '12px 18px', background: 'rgba(2,6,23,0.5)', color: '#94a3b8', borderRadius: 12, border: '1px solid #334155', cursor: 'pointer', flex: 1 };
const tcLabel: CSSProperties = { fontSize: 12, color: '#94a3b8', marginBottom: 4, display: 'block' };