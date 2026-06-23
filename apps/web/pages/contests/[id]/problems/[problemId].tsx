import { CSSProperties, useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import dynamic from 'next/dynamic';
import { io, Socket } from 'socket.io-client';
import { motion } from 'framer-motion';
import toast, { Toaster } from 'react-hot-toast';
import { fetchApi } from '../../../../lib/api';

export async function getServerSideProps() { return { props: {} }; }

const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false, loading: () => <div style={{padding: 20, color: '#64748b'}}>Loading Editor...</div> });

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

type TestCase = { id: string; input: string; expectedOutput: string; output: string; status: 'idle' | 'running' | 'passed' | 'failed' | 'error'; isPublic?: boolean };

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
  
  const [activeTab, setActiveTab] = useState<'cph' | 'terminal'>('cph');
  const [terminalOutput, setTerminalOutput] = useState<string>('Welcome to DivineCode Integrated Terminal.\nReady to compile and run...\n');
  const [customInput, setCustomInput] = useState<string>('');
  
  const [testcases, setTestcases] = useState<TestCase[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [judgeVerdict, setJudgeVerdict] = useState<{ status: string, message: string } | null>(null);
  
  const [aiDebuggerLoading, setAiDebuggerLoading] = useState(false);
  const [aiError, setAiError] = useState(false);
  const [aiDebugResult, setAiDebugResult] = useState<any>(null);
  const [showCfModal, setShowCfModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [mcqData, setMcqData] = useState<any>(null);
  const [selectedOptions, setSelectedOptions] = useState<number[]>([]);
  const [questionTimeLeft, setQuestionTimeLeft] = useState<number>(0);
  const [redirectInfo, setRedirectInfo] = useState<any>(null);
  const [problemType, setProblemType] = useState<'MCQ' | 'EXTERNAL' | 'INTERNAL' | 'UNKNOWN'>('UNKNOWN');

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
    
    fetchApi(`/api/v2/contests/${id}?viewerEmail=${session.user.email}`)
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
        setMessages([]);
        setSelectedOptions([]);
      })
      .catch((err) => {
        console.error('[Contest Load Error]', err);
        setIsLoading(false);
      });
  }, [id, session]);

  const problemIdStr = Array.isArray(problemId) ? problemId[0] : problemId;
  const problem = useMemo(() => contest?.problems?.find((p: any) => p.id === problemIdStr), [contest, problemIdStr]);
  const timer = useContestTimer(new Date(contest?.startTime || 0), new Date(contest?.endTime || 0));
  
  const isMCQ = useMemo(() => {
    return problem?.isMCQ === true || !!problem?.interviewQuestionId || problemType === 'MCQ';
  }, [problem, problemType]);

  useEffect(() => {
    if (problem && isMCQ && problem.mcqTimeLimitSeconds > 0) {
      setQuestionTimeLeft(problem.mcqTimeLimitSeconds);
    } else if (!isMCQ) {
      setQuestionTimeLeft(0);
    }
  }, [problem, isMCQ, problemIdStr]);

  useEffect(() => {
    if (questionTimeLeft <= 0) return;
    const interval = setInterval(() => { setQuestionTimeLeft((prev) => prev - 1); }, 1000);
    return () => clearInterval(interval);
  }, [questionTimeLeft]);

  useEffect(() => {
    if (!problem || isMCQ) return;
    let tcs = [];
    try {
      if (problem.customTestCases) tcs = typeof problem.customTestCases === 'string' ? JSON.parse(problem.customTestCases) : problem.customTestCases;
      else if (problem.problem?.testcases) tcs = typeof problem.problem.testcases === 'string' ? JSON.parse(problem.problem.testcases) : problem.problem.testcases;
      else if (problem.testcases) tcs = typeof problem.testcases === 'string' ? JSON.parse(problem.testcases) : problem.testcases;
    } catch (e) {}

    if (tcs && tcs.length > 0) {
      setTestcases(tcs.map((tc: any, i: number) => ({
        id: Date.now() + i.toString(),
        input: tc.input || '',
        expectedOutput: tc.expectedOutput || '',
        output: '',
        status: 'idle',
        isPublic: tc.isPublic !== false 
      })));
    } else {
      setTestcases([{ id: '1', input: '', expectedOutput: '', output: '', status: 'idle', isPublic: true }]);
    }
  }, [problem, isMCQ]);

  useEffect(() => {
    if (!problemIdStr) return;
    const controller = new AbortController();

    fetchApi(`/api/v2/problems/${problemIdStr}/redirect`, { signal: controller.signal })
      .then((data) => {
        setRedirectInfo(data);
        setProblemType(data?.type || (problem?.isMCQ ? 'MCQ' : (problem?.externalUrl ? 'EXTERNAL' : 'INTERNAL')));
      })
      .catch((err) => {
        console.warn('[Problem Redirect Fetch Error]', err);
        setProblemType(problem?.isMCQ ? 'MCQ' : (problem?.externalUrl ? 'EXTERNAL' : 'INTERNAL'));
      });

    return () => controller.abort();
  }, [problemIdStr, problem?.isMCQ, problem?.externalUrl]);

  useEffect(() => {
    if (isMCQ && problem) {
      try {
        if (problem?.interviewQuestion) {
          setMcqData(problem.interviewQuestion);
        } else if (redirectInfo?.interviewQuestion) {
          setMcqData(redirectInfo.interviewQuestion);
        } else if (problem?.mcqData) {
          const data = typeof problem.mcqData === 'string' ? JSON.parse(problem.mcqData) : problem.mcqData;
          setMcqData(data);
        } else {
          setMcqData(null);
        }
      } catch (e) {
        setMcqData(null);
      }
    } else {
      setMcqData(null);
    }
  }, [isMCQ, problem, redirectInfo, problemIdStr]);

  const toggleVoice = async () => {
    if (!contest?.viewerMember?.teamId) {
      toast.error("You must be in a team to use voice chat.");
      return;
    }
    if (!socketRef.current) {
      toast.error("Chat connection not established. Please wait...");
      return;
    }
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
      } catch (err: any) {
        setVoiceStatus('disconnected');
        toast.error(err?.message?.includes('Permission') ? "Microphone access denied by user." : "Could not access microphone. Check permissions.");
      }
    }
  };

  useEffect(() => {
    if (!id || !session?.user?.email || !contest?.viewerMember?.teamId) {
      return;
    }
    
    try {
      socketRef.current = io(API_BASE_URL, { 
        transports: ['websocket'], 
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5
      });
      const socket = socketRef.current;
      
      socket.on('connect', () => {
        socket.emit('joinContest', id); 
        socket.emit('joinTeam', contest.viewerMember.teamId);
      });

      socket.on('connect_error', (error: any) => {
        toast.error('Chat connection failed. Will retry...', { duration: 3000 });
      });

      socket.on('teamMessage', (incomingMessage: any) => {
        if (!incomingMessage || !incomingMessage.id) return;
        setMessages((prev) => {
          const isDuplicate = prev.some(m => m.id === incomingMessage.id);
          if (isDuplicate) return prev;
          return [...prev, incomingMessage];
        });
      });

      socket.on('team_problem_solved', (data: any) => {
        if (data?.userId !== (session.user?.name || session.user?.email)) {
          toast.success(`🎉 A teammate just solved a problem!`, { duration: 5000, icon: '🚀' });
          playSuccessSound();
        }
      });

      return () => { 
        try { socket.disconnect(); } catch (e) { }
        socketRef.current = null; 
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => track.stop());
        }
        Object.values(peersRef.current).forEach(pc => pc.close());
        peersRef.current = {};
      };
    } catch (err) {
      toast.error('Failed to initialize chat');
    }
  }, [id, session?.user?.email, contest?.viewerMember?.teamId, contest?.viewerMember]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    if (!contest?.viewerMember?.teamId) {
      toast.error("You must be in a team to send messages.");
      return;
    }
    if (!socketRef.current) {
      toast.error("Chat not connected. Please wait...");
      return;
    }
    try {
      const senderIdentifier = session?.user?.email || session?.user?.name || 'Anonymous';
      socketRef.current.emit('sendTeamMessage', {
        contestId: id, 
        teamId: contest.viewerMember.teamId,
        senderId: senderIdentifier,
        content: chatInput.trim()
      });
      setChatInput('');
    } catch (err) {
      toast.error('Failed to send message');
    }
  };

  const handleAiDebug = async () => {
    if (code.trim() === '' || code.trim() === '// Write your solution here...') {
       return alert("Please write some code in the editor before asking the AI for debug assistance.");
    }
    if (confirm("Using the AI Tutor deducts 50 points from your score. Proceed?")) {
      setAiDebuggerLoading(true);
      setAiError(false);
      try {
        const data = await fetchApi(`/api/v2/contests/${id}/problems/${problemIdStr}/ai-debug`, {
          method: 'POST', 
          body: JSON.stringify({ userCode: code, problemDescription: problem?.titleSnapshot }) 
        });
        setAiDebugResult(data.aiDebugData);
      } catch (err: any) { 
        setAiError(true);
        toast.error(err.message || "AI connection failed. Please retry."); 
      } finally { 
        setAiDebuggerLoading(false); 
      }
    }
  };

  const sendToCPH = async () => {
    if (!problem) return;
    const publicCases = testcases.filter(tc => (tc.input || tc.expectedOutput) && tc.isPublic);
    if (publicCases.length === 0) return toast.error("No public test cases available for CPH. The existing test cases are hidden.");
    
    const cphPayload = {
      name: problem.titleSnapshot || 'Problem',
      group: "DivineCode",
      url: window.location.href,
      interactive: false,
      memoryLimit: 256,
      timeLimit: 2000,
      tests: publicCases.map(tc => ({ input: tc.input, output: tc.expectedOutput })),
      testType: "single",
      input: { type: "stdin" },
      output: { type: "stdout" },
      languages: { java: { taskClass: "Main" } }
    };

    try {
      const res = await fetch("http://localhost:10043/", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cphPayload)
      });
      if (res.ok) toast.success(`Sent ${publicCases.length} public test cases to CPH!`);
      else toast.error("Make sure CPH extension is running.");
    } catch (err) {
      toast.error("Could not connect to CPH. Is the extension open?");
    }
  };

  const runCustomCode = async () => {
    if (code.trim() === '' || code.trim() === '// Write your solution here...') {
       return alert("Please write your code in the editor before running the terminal.");
    }
    setActiveTab('terminal');
    setTerminalOutput(`> Compiling and running...\n`);
    try {
      const data = await fetchApi(`/api/v2/execute`, {
        method: 'POST', 
        body: JSON.stringify({ sourceCode: code, language, input: customInput })
      });
      if (data.verdict === 'COMPILATION_ERROR') setTerminalOutput(`> COMPILATION ERROR:\n\n${data.compileError}`);
      else if (data.verdict === 'RUNTIME_ERROR' || data.verdict === 'TIME_LIMIT_EXCEEDED') setTerminalOutput(`> ${data.verdict}:\n\n${data.stderr || ''}`);
      else setTerminalOutput(`> EXECUTED SUCCESSFULLY:\n\n${data.stdout || '[No Output]'}`);
    } catch (e: any) {
      setTerminalOutput(`> Error: ${e.message || 'Execution engine unreachable.'}`);
    }
  };

  const runAllTestcases = async () => {
    if (code.trim() === '' || code.trim() === '// Write your solution here...') {
       return alert("Please write your code in the editor before running test cases.");
    }
    setActiveTab('cph');
    for (let i = 0; i < testcases.length; i++) {
      const newCases = [...testcases];
      newCases[i].status = 'running';
      newCases[i].output = '';
      setTestcases(newCases);

      try {
        const data = await fetchApi(`/api/v2/execute`, {
          method: 'POST', 
          body: JSON.stringify({ sourceCode: code, language, input: newCases[i].input })
        });
        
        let actualOut = '';
        if (data.verdict === 'COMPILATION_ERROR') {
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
      } catch (e: any) {
        newCases[i].status = 'error';
        newCases[i].output = e.message || 'Network error connecting to execution engine.';
      }
      setTestcases([...newCases]);
    }
  };

  const handleSyncCodeforces = async () => {
    setIsSyncing(true);
    try {
      const data = await fetchApi(`/api/v2/contests/${id}/sync/codeforces?wait=true`, { method: 'POST' });
      if (data.synced?.length > 0) {
        playSuccessSound(); 
        setShowCfModal(false);
        setTimeout(() => router.push(`/contests/${id}`), 1000);
      } else {
        alert("Could not find a matching ACCEPTED submission. Are you sure you submitted it on Codeforces?");
      }
    } catch (e: any) { 
      alert(e.message || "Failed to connect to Codeforces sync engine."); 
    } finally { 
      setIsSyncing(false); 
    }
  };

  const handleSubmitCode = async () => {
    if (isMCQ) {
      if (selectedOptions.length === 0) return alert("Please select an answer before submitting.");
    } else {
      if (code.trim() === '' || code.trim() === '// Write your solution here...') {
         return alert("Please write your code in the editor before submitting.");
      }
      if (problemType === 'EXTERNAL' || problem?.platform === 'CODEFORCES' || problem?.externalUrl?.includes('codeforces')) {
        const redirectUrl = redirectInfo?.redirectUrl || redirectInfo?.externalUrl || problem?.externalUrl;
        if (redirectUrl) {
          window.open(redirectUrl, '_blank');
          return;
        }
        setShowCfModal(true);
        return;
      }
    }
    
    setSubmitting(true);
    setJudgeVerdict(null);

    let finalCode: string;
    try {
      finalCode = isMCQ ? JSON.stringify(selectedOptions) : code;
    } catch (e) {
      setJudgeVerdict({ status: 'Error', message: 'Failed to serialize your answer. Please try again.' });
      setSubmitting(false);
      return;
    }

    const finalLanguage = isMCQ ? 'mcq' : language;

    try {
      const submission = await fetchApi(`/api/v2/contests/${id}/submissions`, {
        method: 'POST', 
        body: JSON.stringify({ contestProblemId: problemIdStr, code: finalCode, language: finalLanguage })
      });

      const judgeData = await fetchApi(`/api/v2/submissions/${submission.id}/judge?wait=true`, { method: 'POST' });

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

  const monacoLanguage = language === 'cpp' ? 'cpp' : language === 'python' ? 'python' : 'java';
  const externalUrl = redirectInfo?.redirectUrl || redirectInfo?.externalUrl || problem?.externalUrl || '';
  const problemDescriptionHtml = problem?.customDescription || problem?.problem?.description || (problem?.description ? problem.description : 'No description available for this problem.');

  const activeMcqPrompt = mcqData?.prompt || problem?.customDescription || problem?.titleSnapshot || 'No description provided';
  const activeMcqOptions = Array.isArray(mcqData?.options) ? mcqData.options : [];

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

      {aiDebugResult && (
        <div style={modalOverlay}>
          <div style={{...modalContent, border: '1px solid #a855f7'}}>
            <h2 style={{ margin: '0 0 10px 0', color: '#a855f7' }}>🤖 AI Debug Analysis</h2>
            
            <strong style={{ color: '#eef2ff' }}>Hint:</strong>
            <p style={{ color: '#cbd5e1', marginBottom: 15 }}>{aiDebugResult.hint}</p>

            <strong style={{ color: '#eef2ff' }}>Failing Input:</strong>
            <pre style={{ background: '#020617', padding: 10, borderRadius: 8, color: '#e2e8f0', marginTop: 5, whiteSpace: 'pre-wrap' }}>{aiDebugResult.input}</pre>

            <strong style={{ color: '#eef2ff' }}>Expected Output:</strong>
            <pre style={{ background: '#020617', padding: 10, borderRadius: 8, color: '#4ade80', marginTop: 5, whiteSpace: 'pre-wrap' }}>{aiDebugResult.expectedOutput}</pre>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setAiDebugResult(null)} style={{...primaryBtn, background: '#a855f7'}}>Dismiss</button>
            </div>
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

      {showCfModal && (
        <div style={modalOverlay}>
          <div style={modalContent}>
            <h2 style={{ margin: '0 0 15px', color: '#fff' }}>Codeforces Submission</h2>
            <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 20 }}>
              This is a live Codeforces problem. Submit your solution directly on their platform. Once accepted, click below to sync your points back here.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <a href={problem.externalUrl} target="_blank" rel="noreferrer" style={{...primaryBtn, flex: 1, background: '#38bdf8', color: '#0f172a'}}>1. Submit on Codeforces</a>
              <button onClick={handleSyncCodeforces} disabled={isSyncing} style={{...primaryBtn, flex: 1, background: '#10b981'}}>{isSyncing ? 'Syncing...' : '2. Sync Accepted Result'}</button>
            </div>
            <button onClick={() => setShowCfModal(false)} style={{...ghostBtn, width: '100%', marginTop: 10}}>Cancel</button>
          </div>
        </div>
      )}

      <header style={headerBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <button onClick={() => router.push(`/contests/${id}`)} style={btnDark}>← Standings</button>
          <strong style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: 12 }}>
            {problem.titleSnapshot}
          </strong>
        </div>
        <div style={timerBox}>{timer.text}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          {!isMCQ && (
            <>
              <button onClick={handleAiDebug} disabled={aiDebuggerLoading} style={{...ghostBtn, borderColor: '#a855f7', color: '#a855f7'}}>
                {aiDebuggerLoading ? '🤖 Analyzing...' : '🤖 AI Debug'}
              </button>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} style={selectBox}>
                <option value="cpp">C++ 17</option>
                <option value="python">Python 3</option>
                <option value="java">Java</option>
              </select>
              <button onClick={sendToCPH} style={{...ghostBtn, borderColor: '#10b981', color: '#10b981'}}>⚡ Send to CPH</button>
              <button onClick={runAllTestcases} style={ghostBtn}>Run Test Cases</button>
              <button onClick={runCustomCode} style={runBtn}>Terminal ▶</button>
              <button onClick={handleSubmitCode} disabled={submitting} style={submitBtn}>{submitting ? 'Judging...' : 'Submit 🚀'}</button>
            </>
          )}
        </div>
      </header>

      {isMCQ ? (
        <div style={{ width: '100%', height: 'calc(100vh - 60px)', overflowY: 'auto', background: '#020617', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: 800, padding: '60px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
              <strong style={{ color: '#38bdf8', fontSize: 16, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Question {problem?.label || ''}</strong>
              {problem?.mcqTimeLimitSeconds > 0 && (
                 <div style={{ fontSize: 24, fontWeight: 'bold', color: questionTimeLeft < 30 ? '#ef4444' : '#fbbf24', background: questionTimeLeft < 30 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(251,191,36,0.1)', padding: '5px 15px', borderRadius: 8 }}>
                   {Math.floor(questionTimeLeft / 60)}:{(questionTimeLeft % 60).toString().padStart(2, '0')}
                 </div>
              )}
            </div>
            
            <h2 style={{ fontSize: 28, lineHeight: 1.6, margin: '0 0 15px', color: '#eef2ff' }} dangerouslySetInnerHTML={{ __html: activeMcqPrompt }} />
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 40 }}>
              {activeMcqOptions.length > 0 ? (
                activeMcqOptions.map((opt: string, idx: number) => (
                  <button key={idx} onClick={() => setSelectedOptions(mcqData?.isMultiple ? (prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]) : [idx])} style={{ padding: '20px', borderRadius: 12, background: selectedOptions.includes(idx) ? 'rgba(34,211,238,.12)' : 'rgba(15,23,42,.6)', border: selectedOptions.includes(idx) ? '2px solid #22d3ee' : '2px solid #334155', color: '#eef2ff', cursor: 'pointer', textAlign: 'left' }}>
                    {String.fromCharCode(65 + idx)}. {opt}
                  </button>
                ))
              ) : (
                <div style={{ padding: '20px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: 12, color: '#ef4444' }}>
                  <p style={{ margin: 0, fontWeight: 'bold' }}>No options were provided for this question.</p>
                </div>
              )}
            </div>

            <button onClick={handleSubmitCode} disabled={submitting || (problem.mcqTimeLimitSeconds > 0 && questionTimeLeft <= 0)} style={{...submitBtn, width: '100%', padding: '16px', fontSize: 18}}>
               {submitting ? 'Submitting...' : 'Confirm Answer'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', height: 'calc(100vh - 60px)', width: '100%' }}>
          <section style={{ width: '40%', overflowY: 'auto', background: '#0f172a', padding: 20 }}>
            {/* NEW VIDEO EXPLANATION BLOCK */}
            {(problem?.videoUrl || problem?.problem?.videoUrl) && (
              <div style={{ marginBottom: 20, padding: 15, background: '#020617', borderRadius: 12, border: '1px solid #38bdf8' }}>
                <strong style={{ color: '#38bdf8', display: 'block', marginBottom: 10 }}>🎥 Video Explanation</strong>
                <iframe 
                  src={problem.videoUrl || problem.problem.videoUrl} 
                  style={{ width: '100%', height: 250, borderRadius: 8, border: 'none' }} 
                  allowFullScreen 
                />
              </div>
            )}
            {problemType === 'EXTERNAL' && externalUrl && (
              <div style={{ marginBottom: 20, padding: 20, borderRadius: 14, background: '#081327', border: '1px solid #334155' }}>
                <strong style={{ display: 'block', color: '#38bdf8', marginBottom: 10, fontSize: 16 }}>External problem detected</strong>
                <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.7 }}>
                  This problem is sourced from an external platform. You can code your solution here or open it natively.
                </p>
                <a href={externalUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 16, color: '#22d3ee', textDecoration: 'underline', fontWeight: 600 }}>
                  Open original question ↗
                </a>
              </div>
            )}
            {/* Video Explanation Section */}
{(problem?.videoUrl || problem?.problem?.videoUrl) && (
  <div style={{ marginBottom: 20, padding: 15, background: '#020617', borderRadius: 12, border: '1px solid #38bdf8' }}>
    <strong style={{ color: '#38bdf8', display: 'block', marginBottom: 10 }}>🎥 Video Explanation</strong>
    <iframe 
      src={problem.videoUrl || problem.problem.videoUrl} 
      style={{ width: '100%', height: 250, borderRadius: 8, border: 'none' }} 
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen 
    />
  </div>
)}
            {problemDescriptionHtml && problemDescriptionHtml.length > 10 ? (
              <div 
                className="problem-statement-html" 
                style={{ color: '#eef2ff', lineHeight: '1.7', paddingBottom: '60px' }} 
                dangerouslySetInnerHTML={{ __html: problemDescriptionHtml }} 
              />
            ) : (
              <div style={{ padding: 20, background: '#1e1b4b', borderRadius: 12, border: '1px solid #6366f1' }}>
                <p style={{ color: '#cbd5e1' }}>Problem description unavailable.</p>
                {externalUrl && (
                   <a href={externalUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', fontWeight: 'bold' }}>View External Problem Link ↗</a>
                )}
              </div>
            )}
          </section>
          <section style={{ width: '60%', display: 'flex', flexDirection: 'column', background: '#1e1e1e' }}>
            <Editor height="65%" theme="vs-dark" language={monacoLanguage} value={code} onChange={(val) => setCode(val || '')} />
            <div style={{ height: '35%', background: '#1e1e1e', borderTop: '1px solid #333' }}>
              <div style={tabsHeader}>
                <button onClick={() => setActiveTab('cph')} style={activeTab === 'cph' ? activeTabStyle : inactiveTabStyle}>TEST CASES</button>
                <button onClick={() => setActiveTab('terminal')} style={activeTab === 'terminal' ? activeTabStyle : inactiveTabStyle}>TERMINAL</button>
              </div>
              <div style={{ padding: 15, height: 'calc(100% - 40px)', overflowY: 'auto' }}>
                {activeTab === 'cph' && testcases.map((tc, index) => (
                  <div key={tc.id} style={{ marginBottom: 15, padding: 12, background: '#020617', border: `1px solid ${tc.status === 'passed' ? '#4ade80' : tc.status === 'failed' ? '#f87171' : tc.status === 'running' ? '#eab308' : '#334155'}`, borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                       <strong style={{ color: '#e2e8f0', fontSize: 14 }}>Test Case {index + 1}</strong>
                       {tc.status !== 'idle' && (
                         <span style={{ color: tc.status === 'passed' ? '#4ade80' : tc.status === 'failed' ? '#f87171' : '#eab308', fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', padding: '2px 8px', background: 'rgba(255,255,255,0.05)', borderRadius: 12 }}>
                           {tc.status}
                         </span>
                       )}
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Input:</div>
                    <pre style={{ margin: 0, padding: 8, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4, color: '#e2e8f0', fontSize: 12, whiteSpace: 'pre-wrap' }}>{tc.input}</pre>
                    <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 8, marginBottom: 4 }}>Expected Output:</div>
                    <pre style={{ margin: 0, padding: 8, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4, color: '#e2e8f0', fontSize: 12, whiteSpace: 'pre-wrap' }}>{tc.expectedOutput}</pre>

                    {tc.status !== 'idle' && (
                      <>
                        <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 8, marginBottom: 4 }}>Actual Output:</div>
                        <pre style={{ margin: 0, padding: 8, background: tc.status === 'passed' ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)', border: `1px solid ${tc.status === 'passed' ? '#4ade80' : '#f87171'}`, borderRadius: 4, color: tc.status === 'passed' ? '#4ade80' : '#f87171', fontSize: 12, whiteSpace: 'pre-wrap' }}>
                          {tc.output || '[No Output / Execution Failed]'}
                        </pre>
                      </>
                    )}
                  </div>
                ))}
                {activeTab === 'terminal' && (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
                    <div>
                       <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Custom Input (stdin):</div>
                       <textarea 
                         value={customInput} 
                         onChange={(e) => setCustomInput(e.target.value)}
                         style={{ width: '100%', height: 80, background: '#020617', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 8, padding: 10, fontFamily: 'monospace', outline: 'none', resize: 'vertical' }}
                         placeholder="Enter custom input data here..."
                       />
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                       <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Terminal Output:</div>
                       <pre style={{ flex: 1, margin: 0, padding: 12, background: '#020617', color: '#4ade80', fontFamily: 'monospace', fontSize: 13, whiteSpace: 'pre-wrap', border: '1px solid #334155', borderRadius: 8, minHeight: 120, overflowY: 'auto' }}>{terminalOutput}</pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {contest?.viewerMember?.teamId && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 999 }}>
          {isChatOpen ? (
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} style={{ width: 320, height: 400, background: '#0f172a', border: '1px solid #6366f1', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
              
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
                {messages.length === 0 ? (
                  <p style={{ textAlign: 'center', marginTop: '40%', color: '#64748b' }}>No messages yet. Say hi! 👋</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {messages.map((msg: any) => {
                      if (!msg || !msg.id) return null;
                      const username = msg.sender?.username || msg.sender?.name || msg.senderId || 'Teammate';
                      const timestamp = new Date(msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      return (
                        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} key={msg.id} style={{ background: 'rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                            <strong style={{ color: '#67e8f9' }}>{username}</strong>
                            <span style={{ color: '#64748b' }}>{timestamp}</span>
                          </div>
                          <div style={{ color: '#e2e8f0', wordBreak: 'break-word' }}>{msg.content || '(empty message)'}</div>
                        </motion.div>
                      );
                    })}
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
const tabsHeader: CSSProperties = { display: 'flex', borderBottom: '1px solid #333', background: '#1e1e1e' };
const activeTabStyle: CSSProperties = { flex: 1, background: '#1e1e1e', border: 'none', borderTop: '2px solid #38bdf8', color: '#fff', padding: '10px', cursor: 'pointer', fontWeight: 'bold', fontSize: 12, letterSpacing: 1 };
const inactiveTabStyle: CSSProperties = { flex: 1, background: '#2d2d2d', border: 'none', color: '#888', padding: '10px', cursor: 'pointer', fontSize: 12, letterSpacing: 1, borderTop: '2px solid transparent' };
const modalOverlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(2, 6, 23, 0.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalContent: CSSProperties = { background: '#0f172a', padding: 30, borderRadius: 16, border: '1px solid #1e293b', width: '90%', maxWidth: 500, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' };
const primaryBtn: CSSProperties = { background: '#0284c7', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold', textDecoration: 'none', textAlign: 'center', display: 'inline-block' };