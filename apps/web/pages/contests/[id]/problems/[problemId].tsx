import { CSSProperties, useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import dynamic from 'next/dynamic';
import { io, Socket } from 'socket.io-client';
import toast, { Toaster } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

export async function getServerSideProps() { return { props: {} }; }

const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false, loading: () => <div style={{padding: 20, color: '#64748b'}}>Loading Editor...</div> });

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

type TestCase = { id: string; input: string; expectedOutput: string; output: string; status: 'idle' | 'running' | 'passed' | 'failed' | 'error' };

function useContestTimer(startTime?: string | Date, endTime?: string | Date) {
  const [timeLeft, setTimeLeft] = useState({ state: 'loading', text: 'Syncing chronometer...' });
  
  useEffect(() => {
    if (!startTime || !endTime) return;
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    if (isNaN(start) || isNaN(end)) return;

    const interval = setInterval(() => {
      const now = Date.now();
      if (now < start) {
        const diff = Math.floor((start - now) / 1000);
        setTimeLeft({ state: 'scheduled', text: `Starts in: ${Math.floor(diff/3600)}h ${Math.floor((diff%3600)/60)}m ${diff%60}s` });
      } else if (now >= end) {
        setTimeLeft({ state: 'ended', text: '00:00:00 - Contest Ended' });
      } else {
        const diff = Math.floor((end - now) / 1000);
        setTimeLeft({ state: 'running', text: `Time left: ${Math.floor(diff/3600)}h ${Math.floor((diff%3600)/60)}m ${diff%60}s` });
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [startTime, endTime]);
  
  return timeLeft;
}

export default function ContestProblemWorkspace() {
  const router = useRouter();
  const { id, problemId } = router.query;
  const { data: session, status } = useSession();
  
  const [contest, setContest] = useState<any>(null);
  const [code, setCode] = useState('// Write your solution here...');
  const [language, setLanguage] = useState('cpp');
  
  const [activeTab, setActiveTab] = useState<'cph' | 'terminal' | 'testcases'>('cph');
  const [terminalOutput, setTerminalOutput] = useState<string>('Welcome to DivineCode Integrated Terminal.\nReady to compile and run...\n');
  const [customInput, setCustomInput] = useState<string>('');
  
  const [testcases, setTestcases] = useState<TestCase[]>([{ id: '1', input: '', expectedOutput: '', output: '', status: 'idle' }]);
  const [penaltyViewed, setPenaltyViewed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [judgeVerdict, setJudgeVerdict] = useState<{ status: string, message: string } | null>(null);
  
  const [aiDebuggerLoading, setAiDebuggerLoading] = useState(false);
  const [aiDebugResult, setAiDebugResult] = useState<any>(null);
  const [showCfModal, setShowCfModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [mcqData, setMcqData] = useState<any>(null);
  const [selectedOptions, setSelectedOptions] = useState<number[]>([]);

  // 👉 WebRTC and Chat Refs
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<{ [socketId: string]: RTCPeerConnection }>({});
  
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [voiceStatus, setVoiceStatus] = useState('disconnected');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      audioRef.current = new Audio('/accepted.mp3');
    }
  }, []);

  const playSuccessSound = () => {
    if (audioRef.current) audioRef.current.play().catch(e => console.warn("Audio play blocked", e));
  };

  useEffect(() => {
    if (!id || !session?.user?.email) return;
    fetch(`${API_V2_BASE_URL}/contests/${id}?viewerEmail=${session.user.email}`, {
      headers: { 'x-user-email': session.user.email }
    })
      .then(res => res.json())
      .then(data => {
        const cData = data.data || data;
        if (!cData.viewerMember && session?.user && (cData.participants || cData.members)) {
          const arr = cData.participants || cData.members || [];
          cData.viewerMember = arr.find((p: any) => 
            (session.user?.email && p.user?.email === session.user?.email) || 
            (session.user?.name && p.displayName === session.user?.name)
          );
        }
        setContest(cData);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, [id, session]);

  const problem = useMemo(() => contest?.problems?.find((p: any) => p.id === problemId), [contest, problemId]);
  const timer = useContestTimer(new Date(contest?.startTime || 0), new Date(contest?.endTime || 0));
  
  const isMCQ = problem?.platform === 'DIVINECODE' && !!problem?.interviewQuestionId;

  useEffect(() => {
    if (isMCQ && problem?.interviewQuestionId) {
      fetch(`${API_V2_BASE_URL}/interview/questions`, {
        headers: { 'x-user-email': session?.user?.email || '' }
      })
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data)) setMcqData(data.find(q => q.id === problem.interviewQuestionId));
        });
    }
  }, [isMCQ, problem, session]);

  // 👉 WebRTC Toggle Logic
  const toggleVoice = async () => {
    if (!contest?.viewerMember?.teamId) return toast.error("You must be in a team to use voice chat.");

    if (voiceStatus === 'connected' || voiceStatus === 'connecting') {
      setVoiceStatus('disconnected');
      socketRef.current?.emit('leave-voice', contest.viewerMember.teamId);
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      
      Object.values(peersRef.current).forEach(pc => pc.close());
      peersRef.current = {};
      toast.success("Voice disconnected.");
    } else {
      setVoiceStatus('connecting');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream;
        setVoiceStatus('connected');
        socketRef.current?.emit('join-voice', contest.viewerMember.teamId);
        toast.success("Voice channel joined!");
      } catch (err) {
        console.error('Mic access denied:', err);
        setVoiceStatus('disconnected');
        toast.error("Microphone access denied.");
      }
    }
  };

  useEffect(() => {
    if (!id || !session || !contest?.viewerMember?.teamId) return;
    socketRef.current = io(API_BASE_URL, { transports: ['websocket'], reconnection: true });
    const socket = socketRef.current;
    
    socket.on('connect', () => { 
      socket.emit('joinContest', id); 
      socket.emit('joinTeam', contest.viewerMember.teamId);
    });

    socket.on('teamMessage', (incomingMessage) => {
      setMessages((prev) => {
        if (prev.some(m => m.id === incomingMessage.id)) return prev;
        return [...prev, incomingMessage];
      });
    });

    socket.on('team_problem_solved', (data) => {
      if (data.userId !== (session.user?.name || session.user?.email)) {
        toast.success(`🎉 A teammate just solved a problem!`, { duration: 5000, icon: '🚀' });
        playSuccessSound();
      }
    });

    // 👉 WebRTC Socket Handlers
    socket.on('user-joined-voice', async (peerId) => {
      if (!localStreamRef.current) return;
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      peersRef.current[peerId] = pc;
      
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current!));
      
      pc.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
        audio.play().catch(e => console.log('Audio play blocked:', e));
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) socket.emit('voice-ice-candidate', { to: peerId, candidate: event.candidate });
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('voice-offer', { to: peerId, offer });
    });

    socket.on('voice-offer', async ({ from, offer }) => {
      if (!localStreamRef.current) return;
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      peersRef.current[from] = pc;
      
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current!));
      
      pc.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
        audio.play().catch(e => console.log('Audio play blocked:', e));
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) socket.emit('voice-ice-candidate', { to: from, candidate: event.candidate });
      };

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('voice-answer', { to: from, answer });
    });

    socket.on('voice-answer', async ({ from, answer }) => {
      const pc = peersRef.current[from];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('voice-ice-candidate', async ({ from, candidate }) => {
      const pc = peersRef.current[from];
      if (pc && pc.remoteDescription) {
         try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e){}
      }
    });

    socket.on('user-left-voice', (peerId) => {
      if (peersRef.current[peerId]) {
        peersRef.current[peerId].close();
        delete peersRef.current[peerId];
      }
    });

    return () => { 
      socket.disconnect(); 
      socketRef.current = null; 
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      Object.values(peersRef.current).forEach(pc => pc.close());
    };
  }, [id, session, contest?.viewerMember?.teamId]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSendMessage = () => {
    if (!chatInput.trim() || !contest?.viewerMember?.teamId) return;
    if (socketRef.current) {
      socketRef.current.emit('sendTeamMessage', {
        contestId: id, teamId: contest.viewerMember.teamId,
        senderId: contest.viewerMember.userId || contest.viewerMember.user?.id,
        content: chatInput.trim()
      });
    }
    setChatInput('');
  };

  const sendToCPH = async () => {
    if (!problem) return;
    const cphPayload = {
      name: problem.titleSnapshot || 'Problem',
      group: "DivineCode",
      url: window.location.href,
      interactive: false,
      memoryLimit: 256,
      timeLimit: 2000,
      tests: testcases.filter(tc => tc.input || tc.expectedOutput).map(tc => ({
        input: tc.input,
        output: tc.expectedOutput
      })),
      testType: "single",
      input: { type: "stdin" },
      output: { type: "stdout" },
      languages: { java: { taskClass: "Main" } }
    };

    try {
      const res = await fetch("http://localhost:10043/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cphPayload)
      });
      if (res.ok) toast.success("Test cases sent to CPH successfully!");
      else toast.error("Make sure CPH extension is running.");
    } catch (err) {
      toast.error("Could not connect to CPH. Is the extension open?");
    }
  };

  const runCustomCode = async () => {
    if (!code.trim() || code.includes('// Write your solution')) return alert("Please write code first.");
    setActiveTab('terminal');
    setTerminalOutput(`> Compiling and running...\n`);
    try {
      const res = await fetch(`${API_V2_BASE_URL}/execute`, {
        method: 'POST', 
        headers: { 
          'Content-Type': 'application/json',
          'x-user-email': session?.user?.email || '' 
        },
        body: JSON.stringify({ sourceCode: code, language, input: customInput })
      });
      const data = await res.json();
      if (!res.ok) setTerminalOutput(`> Error: ${data.error || 'Server connection failed.'}`);
      else if (data.verdict === 'COMPILATION_ERROR') setTerminalOutput(`> COMPILATION ERROR:\n\n${data.compileError}`);
      else if (data.verdict === 'RUNTIME_ERROR' || data.verdict === 'TIME_LIMIT_EXCEEDED') setTerminalOutput(`> ${data.verdict}:\n\n${data.stderr || ''}`);
      else setTerminalOutput(`> EXECUTED SUCCESSFULLY:\n\n${data.stdout || '[No Output]'}`);
    } catch (e) {
      setTerminalOutput('> Network error. Execution engine unreachable.');
    }
  };

  const runAllTestcases = async () => {
    setActiveTab('cph');
    for (let i = 0; i < testcases.length; i++) {
      if (!code.trim() || code.includes('// Write your solution')) return alert("Please write code first.");
      const newCases = [...testcases];
      newCases[i].status = 'running';
      newCases[i].output = '';
      setTestcases(newCases);

      try {
        const res = await fetch(`${API_V2_BASE_URL}/execute`, {
          method: 'POST', 
          headers: { 
            'Content-Type': 'application/json',
            'x-user-email': session?.user?.email || ''
          },
          body: JSON.stringify({ sourceCode: code, language, input: newCases[i].input })
        });
        const data = await res.json();
        let actualOut = '';
        
        if (!res.ok) {
          actualOut = data.error || 'Execution failed on server.';
          newCases[i].status = 'error';
        } else if (data.verdict === 'COMPILATION_ERROR') {
          actualOut = data.compileError || 'Compilation Error';
          newCases[i].status = 'error';
        } else if (data.verdict === 'RUNTIME_ERROR' || data.verdict === 'TIME_LIMIT_EXCEEDED') {
          actualOut = `[${data.verdict}]\n${data.stderr || ''}`;
          newCases[i].status = 'error';
        } else {
          actualOut = data.stdout || '';
          const expectedOut = newCases[i].expectedOutput.trim();
          newCases[i].status = (actualOut.trim() === expectedOut || !expectedOut) ? 'passed' : 'failed';
        }
        newCases[i].output = actualOut.trim();
      } catch (e) {
        newCases[i].status = 'error';
        newCases[i].output = 'Network error connecting to execution engine.';
      }
      setTestcases([...newCases]);
    }
  };

  const handleSubmitCode = async () => {
    if (isMCQ) {
       if (selectedOptions.length === 0) return alert("Please select an answer before submitting.");
    } else {
       if (!code.trim() || code.includes('// Write your solution')) return alert("Please write code first.");
       if (problem?.platform === 'CODEFORCES' || problem?.externalUrl?.includes('codeforces')) {
         setShowCfModal(true);
         return;
       }
    }
    
    setSubmitting(true);
    setJudgeVerdict(null);

    const finalLanguage = isMCQ ? 'mcq' : language;
    const finalCode = isMCQ ? JSON.stringify(selectedOptions) : code;

    try {
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/submissions`, {
        method: 'POST', 
        headers: { 
          'Content-Type': 'application/json', 
          'x-user-email': session?.user?.email || '' 
        },
        body: JSON.stringify({ contestProblemId: problemId, code: finalCode, language: finalLanguage })
      });
      const submission = await res.json();
      if (!res.ok) throw new Error(submission.error || 'Could not create submission');

      const judgeRes = await fetch(`${API_V2_BASE_URL}/submissions/${submission.id}/judge?wait=true`, { 
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'x-user-email': session?.user?.email || '' 
        }
      });
      const judgeData = await judgeRes.json();
      if (!judgeRes.ok) throw new Error(judgeData.error || 'Error executing system judge.');

      const sub = judgeData.submission;
      if (sub?.verdict === 'ACCEPTED' || sub?.verdict === 'Accepted') {
        setJudgeVerdict({ status: 'Accepted', message: isMCQ ? 'Correct Answer!' : 'All hidden system tests passed!' });
        playSuccessSound();
        setTimeout(() => router.push(`/contests/${id}`), 1500);
      } else {
        setJudgeVerdict({ status: sub?.verdict || 'Rejected', message: sub?.judgeMessage || 'Failed on hidden system tests.' });
      }
    } catch (e: any) {
      setJudgeVerdict({ status: 'Error', message: e.message || 'Network error.' });
    } finally {
      setSubmitting(false); 
    }
  };

  const handleSyncCodeforces = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/sync/codeforces?wait=true`, {
        method: 'POST', headers: { 'x-user-email': session?.user?.email || '' }
      });
      const data = await res.json();
      if (res.ok && data.synced?.length > 0) {
        playSuccessSound(); 
        setShowCfModal(false);
        setTimeout(() => router.push(`/contests/${id}`), 1000);
      } else {
        alert("Could not find a matching ACCEPTED submission. Are you sure you submitted it on Codeforces?");
      }
    } catch (e) { alert("Failed to connect to Codeforces sync engine."); } finally { setIsSyncing(false); }
  };

  const handleAiDebug = async () => {
    if (!code.trim()) return alert("Write some code to debug!");
    if (confirm("Using the AI Tutor deducts 50 points from your score. Proceed?")) {
      setAiDebuggerLoading(true);
      try {
        const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems/${problemId}/ai-debug`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-email': session?.user?.email || '' },
          body: JSON.stringify({ userCode: code, problemDescription: problem?.titleSnapshot }) 
        });
        const data = await res.json();
        if (res.ok) setAiDebugResult(data.aiDebugData);
        else alert(data.error);
      } catch (err) { alert("Failed to connect to AI."); } finally { setAiDebuggerLoading(false); }
    }
  };

  const DynamicLoader = () => (
    <div style={{...modalOverlay, backgroundColor: '#070a16', flexDirection: 'column'}}>
      <div style={{ position: 'relative', width: 80, height: 80 }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderTop: '4px solid #22d3ee', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
      <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      <h2 style={{ color: '#eef2ff', marginTop: 24, letterSpacing: '2px', fontWeight: 600 }}>INITIALIZING WORKSPACE</h2>
    </div>
  );

  if (status === 'loading' || isLoading) return <DynamicLoader />;
  if (!contest || !problem) return <div style={page}>Problem not found.</div>;

  const problemIframeUrl = problem.externalUrl?.includes('codeforces') 
    ? `${API_V2_BASE_URL}/proxy/problem?url=${encodeURIComponent(problem.externalUrl)}` 
    : problem.externalUrl;

  const monacoLanguage = language === 'cpp' ? 'cpp' : language === 'python' ? 'python' : 'java';

  return (
    <main style={{...page, minHeight: '100vh', height: '100vh', overflow: 'hidden'}}>
      <Toaster position="top-center" toastOptions={{ style: { background: '#1e293b', color: '#fff', border: '1px solid #475569' } }} />
      
      {submitting && (
        <div style={modalOverlay}>
          <div style={{...modalContent, textAlign: 'center'}}>
            <h2 style={{ color: '#fff', margin: '0 0 10px 0' }}>{isMCQ ? 'Grading Answer...' : 'Judging Submission...'}</h2>
            <p style={{ color: '#67e8f9' }}>Evaluating against hidden system modules</p>
          </div>
        </div>
      )}

      {judgeVerdict && (
        <div style={modalOverlay}>
          <div style={{...modalContent, border: `1px solid ${judgeVerdict.status.includes('Accept') ? '#4ade80' : '#f87171'}`}}>
            <h2 style={{ margin: '0 0 10px 0', color: judgeVerdict.status.includes('Accept') ? '#4ade80' : '#f87171' }}>{judgeVerdict.status}</h2>
            <pre style={{ background: '#020617', padding: 15, borderRadius: 8, color: '#e2e8f0', whiteSpace: 'pre-wrap', maxHeight: '40vh', overflow: 'auto' }}>
              {judgeVerdict.message}
            </pre>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setJudgeVerdict(null)} style={primaryBtn}>Dismiss</button>
            </div>
          </div>
        </div>
      )}

      <header style={headerBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <button onClick={() => router.push(`/contests/${id}`)} style={btnDark}>← Standings</button>
          <strong style={{ color: '#fff' }}>{problem.titleSnapshot}</strong>
        </div>
        <div style={timerBox}>{timer.text}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          {!isMCQ && (
            <>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} style={selectBox}>
                <option value="cpp">C++ 17</option>
                <option value="python">Python 3</option>
                <option value="java">Java</option>
              </select>
              <button onClick={sendToCPH} style={{...ghostBtn, borderColor: '#10b981', color: '#10b981'}}>⚡ Send to CPH</button>
              <button onClick={runAllTestcases} style={ghostBtn}>Run Test Cases</button>
              <button onClick={runCustomCode} style={runBtn}>Terminal ▶</button>
            </>
          )}
          <button onClick={handleSubmitCode} disabled={submitting} style={submitBtn}>{submitting ? 'Judging...' : 'Submit 🚀'}</button>
        </div>
      </header>

      <div style={{ display: 'flex', height: 'calc(100vh - 60px)', width: '100%' }}>
        
        {/* LEFT PANE */}
        <section style={{ width: '40%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #1e293b', background: '#0f172a' }}>
          <div style={paneHeader}>Problem Description</div>
          <div style={{ flex: 1, padding: 0, display: 'flex', flexDirection: 'column' }}>
            {isMCQ ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', marginTop: '10vh' }}>
                <svg width="64" height="64" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ margin: '0 auto 20px', color: '#38bdf8' }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                <h2 style={{ color: '#eef2ff' }}>Theory Assessment</h2>
                <p>Read the question carefully and select the correct option(s) in the workspace on the right.</p>
              </div>
            ) : (
              <>
                {problem.externalUrl ? (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <iframe src={problemIframeUrl} style={{...iframeStyle, flex: 1}} title="Problem Statement" />
                    <div style={{ padding: '10px', background: '#1e293b', textAlign: 'center' }}>
                       <a href={problem.externalUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', textDecoration: 'none', fontWeight: 'bold' }}>
                         ↗ Open Original Problem in New Tab
                       </a>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: 20 }}>
                    <div dangerouslySetInnerHTML={{ __html: problem.description || problem.customDescription || 'No description provided.' }} />
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* RIGHT PANE: Workspace / MCQ Form */}
        <section style={{ width: '60%', display: 'flex', flexDirection: 'column', background: '#1e1e1e' }}>
          {isMCQ ? (
            <div style={{ padding: '40px 60px', display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', background: '#020617' }}>
              <strong style={{ color: '#38bdf8', fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Question {problem?.label || ''}</strong>
              <h2 style={{ fontSize: 26, lineHeight: 1.5, margin: '20px 0 10px', color: '#eef2ff' }}>
                {mcqData?.prompt || problem?.titleSnapshot || 'Loading question...'}
              </h2>
              {mcqData?.isMultiple ? (
                 <p style={{ color: '#fbbf24', marginBottom: 30, fontWeight: 'bold' }}>* Select all that apply (Multiple Correct)</p>
              ) : (
                 <p style={{ color: '#94a3b8', marginBottom: 30 }}>* Select one answer</p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                 {mcqData?.options?.map((opt: string, idx: number) => {
                    const isSelected = selectedOptions.includes(idx);
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          if (mcqData?.isMultiple) {
                             setSelectedOptions(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]);
                          } else {
                             setSelectedOptions([idx]);
                          }
                        }}
                        style={{
                          padding: '20px 24px', borderRadius: 16, background: isSelected ? 'rgba(34,211,238,.12)' : 'rgba(15,23,42,.6)',
                          color: '#eef2ff', border: `2px solid ${isSelected ? 'rgba(34,211,238,.8)' : 'rgba(51,65,85,.6)'}`,
                          cursor: 'pointer', textAlign: 'left', fontSize: 16, transition: 'all 0.2s',
                          display: 'flex', alignItems: 'center', gap: 20
                        }}
                      >
                        <div style={{ width: 24, height: 24, borderRadius: mcqData?.isMultiple ? 6 : 12, border: `2px solid ${isSelected ? '#22d3ee' : '#64748b'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isSelected ? '#22d3ee' : 'transparent', flexShrink: 0 }}>
                           {isSelected && <div style={{ width: 10, height: 10, background: '#0f172a', borderRadius: mcqData?.isMultiple ? 2 : 6 }} />}
                        </div>
                        <div style={{ flex: 1, lineHeight: 1.5 }}>
                          <span style={{ fontWeight: 'bold', color: '#67e8f9', marginRight: 12 }}>{String.fromCharCode(65 + idx)}.</span>
                          {opt}
                        </div>
                      </button>
                    )
                 })}
              </div>
            </div>
          ) : (
            <>
              <div style={{ flex: 1, position: 'relative', paddingTop: 10 }}>
                <Editor height="100%" theme="vs-dark" language={monacoLanguage} value={code} onChange={(val) => setCode(val || '')} options={{ minimap: { enabled: false }, fontSize: 16 }} />
              </div>

              <div style={{ height: '35%', display: 'flex', flexDirection: 'column', borderTop: '1px solid #333', background: '#1e1e1e' }}>
                <div style={tabsHeader}>
                  <button style={activeTab === 'cph' ? activeTabStyle : inactiveTabStyle} onClick={() => setActiveTab('cph')}>CPH TESTCASES</button>
                  <button style={activeTab === 'terminal' ? activeTabStyle : inactiveTabStyle} onClick={() => setActiveTab('terminal')}>TERMINAL</button>
                  <button style={activeTab === 'testcases' ? activeTabStyle : inactiveTabStyle} onClick={() => setActiveTab('testcases')}>DEBUG / HIDDEN</button>
                </div>
                
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {activeTab === 'cph' && (
                    <div style={{ padding: 15, background: '#0f172a', minHeight: '100%' }}>
                      {testcases.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px 20px', background: '#020617', border: '1px dashed #334155', borderRadius: 8, marginBottom: 15 }}>
                          <h3 style={{ color: '#94a3b8', margin: '0 0 10px' }}>No Pre-Loaded Test Cases</h3>
                          <p style={{ color: '#64748b', fontSize: 13, marginBottom: 20 }}>Automatic scraping failed or was blocked by the platform. You can manually enter test cases below.</p>
                        </div>
                      ) : (
                        testcases.map((tc, idx) => (
                          <div key={tc.id} style={tcCard}>
                            <div style={tcHeader}>
                              <strong>Test Case {idx + 1}</strong>
                              <span style={{ color: tc.status === 'passed' ? '#4ade80' : tc.status === 'failed' || tc.status === 'error' ? '#f87171' : '#94a3b8' }}>{tc.status.toUpperCase()}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 10, padding: 10 }}>
                              <div style={{ flex: 1 }}><div style={tcLabel}>Input</div><textarea value={tc.input} onChange={e => { const n = [...testcases]; n[idx].input = e.target.value; setTestcases(n); }} style={tcBox} /></div>
                              <div style={{ flex: 1 }}><div style={tcLabel}>Expected Output</div><textarea value={tc.expectedOutput} onChange={e => { const n = [...testcases]; n[idx].expectedOutput = e.target.value; setTestcases(n); }} style={tcBox} /></div>
                            </div>
                            <div style={{ padding: '0 10px 10px' }}>
                              <div style={tcLabel}>Actual Output</div>
                              <pre style={{...tcBox, height: 60, margin: 0, overflow: 'auto', background: tc.status === 'failed' ? 'rgba(248,113,113,0.1)' : '#020617'}}>{tc.output}</pre>
                            </div>
                          </div>
                        ))
                      )}
                      <button onClick={() => setTestcases([...testcases, { id: Date.now().toString(), input: '', expectedOutput: '', output: '', status: 'idle' }])} style={{...secondaryBtn, width: '100%'}}>+ Add Custom Test Case</button>
                    </div>
                  )}

                  {activeTab === 'terminal' && (
                    <div style={{ display: 'flex', height: '100%', padding: 10, gap: 10, background: '#1e1e1e' }}>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ color: '#ccc', fontSize: 12, marginBottom: 5, fontWeight: 'bold' }}>STDIN (Custom Input)</div>
                        <textarea value={customInput} onChange={(e) => setCustomInput(e.target.value)} style={{ flex: 1, background: '#2d2d2d', color: '#fff', border: '1px solid #444', fontFamily: 'monospace', padding: 8, outline: 'none', resize: 'none' }} placeholder="Enter custom input here..." />
                      </div>
                      <div style={{ flex: 2, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ color: '#ccc', fontSize: 12, marginBottom: 5, fontWeight: 'bold' }}>TERMINAL OUTPUT</div>
                        <pre style={{ flex: 1, background: '#000', color: '#4ade80', margin: 0, padding: 10, border: '1px solid #444', fontFamily: 'monospace', overflowY: 'auto' }}>{terminalOutput}</pre>
                      </div>
                    </div>
                  )}

                  {activeTab === 'testcases' && (
                    <div style={{ padding: 15, background: '#0f172a', minHeight: '100%' }}>
                      <div style={aiTutorCard}>
                        <h3 style={{ color: '#a5b4fc', marginTop: 0 }}>🤖 AI Contest Tutor</h3>
                        {!aiDebugResult ? (
                          <button onClick={handleAiDebug} disabled={aiDebuggerLoading} style={aiTriggerBtn}>
                            {aiDebuggerLoading ? 'Analyzing Code...' : 'Find Flaw & Generate Failing Case (-50 pts)'}
                          </button>
                        ) : (
                          <div style={{ marginTop: 10, background: '#0f172a', padding: 16, borderRadius: 8, border: '1px solid #334155' }}>
                            <p style={{ color: '#fbbf24', fontWeight: 'bold' }}>💡 Hint: {aiDebugResult.hint}</p>
                            <div style={{ display: 'flex', gap: 10 }}>
                              <div style={{ flex: 1 }}><strong style={{ color: '#94a3b8', fontSize: 11 }}>FAILING INPUT</strong><pre style={codeBlockError}>{aiDebugResult.input}</pre></div>
                              <div style={{ flex: 1 }}><strong style={{ color: '#94a3b8', fontSize: 11 }}>EXPECTED OUTPUT</strong><pre style={codeBlockSuccess}>{aiDebugResult.expectedOutput}</pre></div>
                            </div>
                          </div>
                        )}
                      </div>

                      {!penaltyViewed ? (
                        <div style={{ textAlign: 'center', marginTop: 20, borderTop: '1px solid #1e293b', paddingTop: 20 }}>
                          <h3 style={{ color: '#f87171', marginTop: 0 }}>⚠️ Standard Hidden Test Cases</h3>
                          <button onClick={() => { if(confirm("Deduct 50 pts?")) setPenaltyViewed(true); }} style={btnDanger}>Accept Penalty & View</button>
                        </div>
                      ) : (
                        <div style={{ marginTop: 20 }}><h4 style={{ color: '#4ade80' }}>System Cases Unlocked</h4><p style={{ color: '#94a3b8', fontFamily: 'monospace' }}>[System test case data loaded]</p></div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Global Team Chat Embedded in Workspace */}
      {contest?.viewerMember?.teamId && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 999 }}>
          {isChatOpen ? (
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} style={{ width: 320, height: 400, background: '#0f172a', border: '1px solid #6366f1', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
              
              {/* WebRTC Voice Chat Controls */}
              <div style={{ background: '#1e1b4b', padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #312e81' }}>
                <strong style={{ color: '#a5b4fc' }}>Team Chat</strong>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={toggleVoice} style={{ background: voiceStatus === 'connected' ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.1)', color: voiceStatus === 'connected' ? '#4ade80' : '#fff', border: `1px solid ${voiceStatus === 'connected' ? '#4ade80' : 'transparent'}`, borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>
                    {voiceStatus === 'connected' ? '🟢 Voice On' : voiceStatus === 'connecting' ? '⏳ Connecting...' : '🎤 Join Voice'}
                  </button>
                  <button onClick={() => setIsChatOpen(false)} style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 18 }}>✖</button>
                </div>
              </div>

              <div style={{ flex: 1, padding: 12, overflowY: 'auto', color: '#94a3b8', fontSize: 14 }}>
                {messages.length === 0 ? <p style={{ textAlign: 'center', marginTop: '40%' }}>No messages yet. Say hi!</p> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {messages.map(msg => (
                      <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} key={msg.id} style={{ background: 'rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}><strong style={{ color: '#67e8f9' }}>{msg.sender?.username || 'Teammate'}</strong><span style={{ color: '#64748b' }}>{new Date(msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
                        <div style={{ color: '#e2e8f0', wordBreak: 'break-word' }}>{msg.content}</div>
                      </motion.div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>
              <div style={{ padding: 12, borderTop: '1px solid #334155', display: 'flex', gap: 8 }}>
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} placeholder="Type a message..." style={{ width: '100%', padding: 8, borderRadius: 6, background: '#1e293b', color: '#fff', border: '1px solid #334155' }} />
                <button onClick={handleSendMessage} style={{ background: '#6366f1', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 6, cursor: 'pointer' }}>Send</button>
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

// Styles
const page: CSSProperties = { display: 'flex', flexDirection: 'column', backgroundColor: '#020617', color: '#eef2ff', fontFamily: 'Inter, sans-serif' };
const headerBar: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', backgroundColor: '#1e1e1e', borderBottom: '1px solid #333', height: 60 };
const btnDark: CSSProperties = { background: '#333', border: 'none', color: '#ccc', padding: '8px 14px', cursor: 'pointer', fontWeight: 'bold', borderRadius: 4 };
const timerBox: CSSProperties = { background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '6px 12px', borderRadius: 6, fontWeight: 'bold' };
const submitBtn: CSSProperties = { background: '#10b981', border: 'none', color: '#fff', padding: '8px 16px', fontWeight: 'bold', cursor: 'pointer', borderRadius: 4 };
const runBtn: CSSProperties = { background: '#3b82f6', border: 'none', color: '#fff', padding: '8px 16px', fontWeight: 'bold', cursor: 'pointer', borderRadius: 4 };
const ghostBtn: CSSProperties = { background: 'transparent', border: '1px solid #444', color: '#ccc', padding: '8px 16px', fontWeight: 'bold', cursor: 'pointer', borderRadius: 4 };
const selectBox: CSSProperties = { background: '#333', color: '#fff', border: 'none', padding: '8px', outline: 'none', borderRadius: 4 };
const paneHeader: CSSProperties = { padding: '12px 16px', background: '#1e293b', fontWeight: 'bold', fontSize: 14, color: '#94a3b8' };
const iframeStyle: CSSProperties = { width: '100%', height: '100%', border: 'none', background: '#fff' };
const tabsHeader: CSSProperties = { display: 'flex', borderBottom: '1px solid #333', background: '#1e1e1e' };
const activeTabStyle: CSSProperties = { flex: 1, background: '#1e1e1e', border: 'none', borderTop: '2px solid #38bdf8', color: '#fff', padding: '10px', cursor: 'pointer', fontWeight: 'bold', fontSize: 12, letterSpacing: 1 };
const inactiveTabStyle: CSSProperties = { flex: 1, background: '#2d2d2d', border: 'none', color: '#888', padding: '10px', cursor: 'pointer', fontSize: 12, letterSpacing: 1, borderTop: '2px solid transparent' };
const btnDanger: CSSProperties = { background: '#ef4444', color: '#fff', padding: '8px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' };
const aiTutorCard: CSSProperties = { padding: 16, background: 'rgba(99, 102, 241, 0.05)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: 10 };
const aiTriggerBtn: CSSProperties = { background: '#5356ff', color: '#fff', padding: '8px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 13 };
const codeBlockError: CSSProperties = { background: 'rgba(248, 113, 113, 0.08)', padding: 10, color: '#f87171', borderRadius: 6, overflow: 'auto', border: '1px solid rgba(248, 113, 113, 0.2)', fontFamily: 'monospace', margin: 0, fontSize: 12 };
const codeBlockSuccess: CSSProperties = { ...codeBlockError, background: 'rgba(74, 222, 128, 0.08)', color: '#4ade80', border: '1px solid rgba(74, 222, 128, 0.2)' };
const modalOverlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(2, 6, 23, 0.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalContent: CSSProperties = { background: '#0f172a', padding: 30, borderRadius: 16, border: '1px solid #1e293b', width: '90%', maxWidth: 500, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' };
const secondaryBtn: CSSProperties = { background: '#334155', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' };
const primaryBtn: CSSProperties = { background: '#0284c7', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold', textDecoration: 'none', textAlign: 'center', display: 'inline-block' };
const cancelBtn: CSSProperties = { background: 'transparent', color: '#94a3b8', border: 'none', padding: '10px 16px', cursor: 'pointer', fontWeight: 'bold' };
const syncBtn: CSSProperties = { background: '#10b981', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' };
const tcCard: CSSProperties = { background: '#020617', border: '1px solid #334155', borderRadius: 8, overflow: 'hidden', marginBottom: 15 };
const tcHeader: CSSProperties = { background: '#1e293b', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', fontSize: 13 };
const tcBox: CSSProperties = { width: '100%', height: 60, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#fff', fontFamily: 'monospace', padding: 8, fontSize: 13, resize: 'none' };
const tcLabel: CSSProperties = { fontSize: 12, color: '#94a3b8', marginBottom: 4 };