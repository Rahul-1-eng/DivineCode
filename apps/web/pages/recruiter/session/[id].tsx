/**
 * @file [id].tsx
 * @author Rahul Kumar Sahoo
 * @description The Live-Action Split-Screen Interview Sandbox.
 * Synchronizes the Code Editor, Candidate WebRTC stream, and the Neural Avatar Engine.
 */

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import toast, { Toaster } from 'react-hot-toast';
import { fetchApi } from '../../../lib/api';
import { speakText, stopSpeaking, primeVoices } from '../../../lib/voice';
// Note: Adjust this import based on your specific Monaco/Code editor wrapper location
import Editor from '@monaco-editor/react';

// Backend treats this exact placeholder as "no code written yet" — keep them in sync.
const CODE_PLACEHOLDER = '// Initialize solution architecture here...\n';

interface TranscriptEntry {
  role: 'interviewer' | 'candidate' | 'system';
  text: string;
}

// -----------------------------------------------------------------------------
// Neural Avatar — fully animated SVG interviewer (no video assets, no deps).
// Blinks on an idle loop, breathes, and lip-syncs a viseme cycle while the
// TTS engine is speaking; a reactive waveform mirrors the speech state.
// -----------------------------------------------------------------------------
function NeuralAvatar({ speaking }: { speaking: boolean }) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: 'radial-gradient(ellipse at 50% 30%, #312e81 0%, #1e1b4b 55%, #0f0d2e 100%)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      {/* Ambient pulse ring behind the head while speaking */}
      <motion.div
        animate={speaking ? { scale: [1, 1.25, 1], opacity: [0.25, 0.45, 0.25] } : { scale: 1, opacity: 0.15 }}
        transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
        style={{ position: 'absolute', width: 190, height: 190, borderRadius: '50%', background: 'radial-gradient(circle, rgba(165,180,252,0.5) 0%, transparent 70%)' }}
      />

      <motion.svg
        width="230" height="230" viewBox="0 0 200 200"
        animate={{ y: [0, -3, 0] }}
        transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
        style={{ position: 'relative', zIndex: 2 }}
      >
        {/* Shoulders / blazer */}
        <path d="M 40 200 Q 40 148 100 145 Q 160 148 160 200 Z" fill="#1e293b" stroke="#334155" strokeWidth="2" />
        <path d="M 88 148 L 100 168 L 112 148 Q 106 144 100 144 Q 94 144 88 148 Z" fill="#f8fafc" />
        <path d="M 97 165 L 100 200 L 103 165 L 100 170 Z" fill="#6366f1" />

        {/* Neck */}
        <rect x="90" y="118" width="20" height="26" rx="8" fill="#c69c7b" />

        {/* Head */}
        <ellipse cx="100" cy="88" rx="36" ry="40" fill="#d4a888" />
        {/* Ears */}
        <ellipse cx="63" cy="90" rx="6" ry="10" fill="#c69c7b" />
        <ellipse cx="137" cy="90" rx="6" ry="10" fill="#c69c7b" />
        {/* Hair */}
        <path d="M 62 82 Q 60 44 100 42 Q 140 44 138 82 Q 138 64 124 58 Q 100 50 76 58 Q 62 64 62 82 Z" fill="#26221f" />

        {/* Eyebrows */}
        <motion.g animate={speaking ? { y: [0, -1.5, 0] } : { y: 0 }} transition={{ repeat: Infinity, duration: 1.8 }}>
          <path d="M 74 74 Q 83 70 92 74" stroke="#26221f" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M 108 74 Q 117 70 126 74" stroke="#26221f" strokeWidth="3" fill="none" strokeLinecap="round" />
        </motion.g>

        {/* Eyes — blink on an idle loop */}
        <motion.g
          animate={{ scaleY: [1, 1, 0.08, 1, 1] }}
          transition={{ repeat: Infinity, duration: 4.2, times: [0, 0.46, 0.5, 0.54, 1] }}
          style={{ originY: '84px', originX: '100px', transformBox: 'fill-box', transformOrigin: 'center 84px' } as any}
        >
          <ellipse cx="83" cy="84" rx="6.5" ry="7" fill="#fff" />
          <ellipse cx="117" cy="84" rx="6.5" ry="7" fill="#fff" />
          <circle cx="84" cy="85" r="3.4" fill="#26221f" />
          <circle cx="118" cy="85" r="3.4" fill="#26221f" />
          <circle cx="85.2" cy="83.8" r="1.1" fill="#fff" />
          <circle cx="119.2" cy="83.8" r="1.1" fill="#fff" />
        </motion.g>

        {/* Nose */}
        <path d="M 100 90 Q 97 100 100 103 Q 102 104 104 102" stroke="#b98d6e" strokeWidth="2" fill="none" strokeLinecap="round" />

        {/* Mouth — viseme cycle while speaking, calm line when idle */}
        {speaking ? (
          <motion.ellipse
            cx="100" cy="114" rx="9"
            animate={{ ry: [1.5, 5.5, 2.5, 6.5, 3, 1.5], rx: [9, 7, 10, 6.5, 9, 9] }}
            transition={{ repeat: Infinity, duration: 0.65, ease: 'easeInOut' }}
            fill="#7f3b2d"
          />
        ) : (
          <path d="M 90 114 Q 100 119 110 114" stroke="#9c5642" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        )}
      </motion.svg>

      {/* Speech waveform */}
      <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'flex-end', gap: 4, height: 26, zIndex: 3 }}>
        {[0, 1, 2, 3, 4, 5, 6].map(i => (
          <motion.div
            key={i}
            animate={speaking ? { height: [5, 18 + (i % 3) * 6, 8, 22 - (i % 4) * 4, 5] } : { height: 4 }}
            transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.08, ease: 'easeInOut' }}
            style={{ width: 4, borderRadius: 2, background: speaking ? '#a5b4fc' : 'rgba(165,180,252,0.35)' }}
          />
        ))}
      </div>

      {/* Nameplate */}
      <div style={{ position: 'absolute', bottom: 12, left: 12, background: 'rgba(0,0,0,0.55)', padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#e2e8f0', zIndex: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: speaking ? '#4ade80' : '#64748b', boxShadow: speaking ? '0 0 8px #4ade80' : 'none' }} />
        Alex Sharma · Senior Engineering Manager
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Component Style Dictionary
// -----------------------------------------------------------------------------
const STYLES: Record<string, React.CSSProperties> = {
  container: { height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-main)', color: 'var(--text-main)', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', background: 'var(--bg-panel-solid)', borderBottom: '1px solid var(--border-color)', zIndex: 10 },
  workspace: { display: 'flex', flex: 1, overflow: 'hidden' },
  leftPane: { flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-color)', background: 'var(--bg-main)' },
  rightPane: { width: '450px', display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)', position: 'relative' },

  // Editor & Problem Area
  problemPrompt: { padding: '20px', borderBottom: '1px solid var(--border-color)', maxHeight: '40%', overflowY: 'auto', background: 'var(--bg-card)' },
  editorWrapper: { flex: 1, position: 'relative' },

  // Video & Avatar Matrix
  videoMatrix: { height: '300px', background: '#000', position: 'relative', borderBottom: '1px solid var(--border-color)' },
  aiAvatar: { width: '100%', height: '100%', objectFit: 'cover', opacity: 0.9 },
  candidateWebcam: { position: 'absolute', bottom: 12, right: 12, width: 120, height: 90, background: '#111', borderRadius: 8, border: '2px solid rgba(255,255,255,0.2)', objectFit: 'cover', overflow: 'hidden', zIndex: 5 },

  // Telemetry & Hardware Controls
  chatLog: { flex: 1, padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 },
  controlBar: { padding: 20, background: 'var(--bg-panel-solid)', borderTop: '1px solid var(--border-color)', display: 'flex', gap: 12 },
  micBtn: { flex: 1, padding: '16px', borderRadius: 12, border: 'none', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10 },
  endBtn: { padding: '16px', borderRadius: 12, border: '1px solid #ef4444', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontWeight: 'bold', cursor: 'pointer' },
  retryBanner: { margin: '0 20px', padding: '12px 16px', borderRadius: 12, background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 14 },
  verdictOverlay: { position: 'absolute', inset: 0, background: 'rgba(2, 6, 23, 0.92)', zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 40, textAlign: 'center' },
  centerScreen: { height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 20, background: 'var(--bg-main)', color: 'var(--text-main)', padding: 40, textAlign: 'center' }
};

export default function LiveInterviewSandbox() {
  const router = useRouter();
  const { id } = router.query;

  // Sandbox State
  const [session, setSession] = useState<any>(null);
  const [loadError, setLoadError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [code, setCode] = useState(CODE_PLACEHOLDER);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [pendingAnswer, setPendingAnswer] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<'PASSED' | 'FAILED' | null>(null);
  // Admin permit flags resolved server-side: admin = may force-advance rounds;
  // owner = may answer (admins inspecting another user's session are observers).
  const [viewer, setViewer] = useState({ admin: false, recruiter: false, owner: true });
  const [isAdvancing, setIsAdvancing] = useState(false);

  // Hardware State
  const [isListening, setIsListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recognitionRef = useRef<any>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);

  // Live Code Execution State (OA_DSA round only)
  const [language, setLanguage] = useState('cpp');
  const [stdinInput, setStdinInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ verdict: string; stdout: string; stderr: string } | null>(null);
  const runResultRef = useRef<typeof runResult>(null);
  useEffect(() => { runResultRef.current = runResult; }, [runResult]);

  // Refs mirror live state so the speech-recognition callback (bound once on
  // mount) never operates on a stale closure of session/code.
  const sessionRef = useRef<any>(null);
  const codeRef = useRef(code);
  const transmitRef = useRef<(text: string, isRetry?: boolean) => void>(() => {});
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { codeRef.current = code; }, [code]);

  const activeRoundOf = (s: any) => s?.rounds?.find((r: any) => r.order === s.currentRound);

  // ---------------------------------------------------------------------------
  // Session Loading (mount, manual retry, and 409 resync all funnel here)
  // ---------------------------------------------------------------------------
  const loadSession = async () => {
    setLoadError(null);
    try {
      const res = await fetchApi(`/api/v2/recruiter/sessions/${id}`);
      const s = res.session;
      setSession(s);
      setViewer({ admin: !!res.viewerIsAdmin, recruiter: !!res.viewerIsRecruiter, owner: res.viewerIsOwner !== false });
      setPendingAnswer(null);
      if (s.status === 'PASSED' || s.status === 'FAILED') setVerdict(s.status);

      // Hydrate the transcript from the active round's persisted turns
      const active = activeRoundOf(s) || s.rounds[s.rounds.length - 1];
      setTranscript((active?.turns || []).map((t: any) => ({
        role: t.role === 'INTERVIEWER' ? 'interviewer' : 'candidate',
        text: t.text
      })));
    } catch (err: any) {
      if (err?.status === 404) {
        toast.error('Session not found.');
        router.push('/recruiter');
        return;
      }
      // 503 = AI engine warming up / unreachable; no status = network fault. Both are retryable.
      setLoadError({
        message: err?.message || 'Failed to load session.',
        retryable: err?.retryable || err?.status === 503 || !err?.status
      });
    }
  };

  // 1. Session Mount & Hardware Verification
  useEffect(() => {
    if (!id) return;

    loadSession();

    // Warm the shared TTS engine (async voice list + first-gesture audio unlock)
    primeVoices();

    // Initialize Local Candidate Webcam
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then(stream => { if (videoRef.current) videoRef.current.srcObject = stream; })
        .catch(err => console.warn("Camera hardware bypass:", err));
    }

    // Web Speech API Initialization (Baseline Free-Tier)
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'en-IN';

        recognition.onresult = (event: any) => {
          const spoken = event.results[event.results.length - 1][0].transcript;
          transmitRef.current(spoken);
        };

        recognition.onend = () => {
          setIsListening(false);
        };
        recognition.onerror = (event: any) => {
          console.error("Speech Recognition Error:", event.error);
          setIsListening(false);
        };
        recognitionRef.current = recognition;
      }
    }

    return () => {
      // Hardware Cleanup Pipeline
      if (recognitionRef.current) recognitionRef.current.abort();
      stopSpeaking();
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      }
    };
  }, [id]);

  // Keep the chat log pinned to the latest exchange
  useEffect(() => {
    if (chatLogRef.current) chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
  }, [transcript, isThinking]);

  // Advance the state machine: close the given round, open the next one.
  // Shared by the natural conclude path and the admin force-advance permit.
  const applyNextRound = (closedRoundId: string, passed: boolean | null, next: any) => {
    setSession((prev: any) => ({
      ...prev,
      currentRound: next.order,
      rounds: prev.rounds.map((r: any) =>
        r.id === closedRoundId
          ? { ...r, endedAt: new Date().toISOString(), passed }
          : r.id === next.id
            ? { ...r, problemStatement: next.problemStatement }
            : r
      )
    }));
    setCode(CODE_PLACEHOLDER);
    setRunResult(null);
    setTranscript(prev => [
      ...prev,
      { role: 'system', text: `Round ${next.order}: ${String(next.type).replace(/_/g, ' ')}` },
      { role: 'interviewer', text: next.openingSpeech }
    ]);
    synthesizeNeuralVoice(next.openingSpeech);
  };

  // Admin permit: force-conclude the active round as passed and open the next
  // one, so every stage of the pipeline can be walked through and inspected.
  const forceAdvanceRound = async () => {
    const s = sessionRef.current;
    if (!s || s.status !== 'IN_PROGRESS' || isAdvancing) return;
    const activeRound = activeRoundOf(s);
    if (!activeRound) return;

    setIsAdvancing(true);
    stopSpeaking();
    setIsAiSpeaking(false);

    try {
      const res = await fetchApi(`/api/v2/recruiter/sessions/${s.id}/advance`, {
        method: 'POST',
        body: JSON.stringify({})
      });

      if (res.nextRound) {
        applyNextRound(activeRound.id, true, res.nextRound);
        toast.success(`Round ${res.skippedRound} skipped.`, { icon: '⏭️' });
      } else {
        setSession((prev: any) => ({
          ...prev,
          status: 'PASSED',
          rounds: prev.rounds.map((r: any) =>
            r.id === activeRound.id ? { ...r, endedAt: new Date().toISOString(), passed: true } : r
          )
        }));
        setVerdict('PASSED');
        toast.success('Final round skipped — pipeline complete.', { icon: '⏭️' });
      }
    } catch (err: any) {
      if (err?.status === 409) {
        toast.error('The interview state changed. Resyncing…');
        loadSession();
      } else {
        toast.error(err?.message || 'Failed to advance the round.');
      }
    } finally {
      setIsAdvancing(false);
    }
  };

  // 2. Telemetry Processing & AI Dispatch
  const handleCandidateTransmission = async (text: string, isRetry = false) => {
    const s = sessionRef.current;
    if (!text.trim() || !s) return;

    const activeRound = activeRoundOf(s);
    if (!activeRound || s.status !== 'IN_PROGRESS') return;

    // Append to local log immediately for latency masking (retries are already logged)
    if (!isRetry) setTranscript(prev => [...prev, { role: 'candidate', text }]);
    setPendingAnswer(null);
    setIsListening(false);
    recognitionRef.current?.stop();
    setIsThinking(true);

    // Ship the last real compiler run alongside the answer so the interviewer
    // grades against actual execution evidence, not just claims.
    const lastRun = runResultRef.current;
    const executionResult = lastRun
      ? `Verdict: ${lastRun.verdict}${lastRun.stdout ? `\nStdout:\n${lastRun.stdout}` : ''}${lastRun.stderr ? `\nStderr:\n${lastRun.stderr}` : ''}`
      : undefined;

    try {
      const res = await fetchApi(`/api/v2/recruiter/sessions/${s.id}/rounds/${activeRound.id}/turn`, {
        method: 'POST',
        body: JSON.stringify({ userResponse: text, codeSnapshot: codeRef.current, executionResult })
      });

      setIsThinking(false);
      setTranscript(prev => [...prev, { role: 'interviewer', text: res.reply }]);
      synthesizeNeuralVoice(res.reply);

      if (res.concludeRound) {
        if (res.nextRound) {
          applyNextRound(activeRound.id, res.roundPassed, res.nextRound);
        } else {
          // Terminal state: the candidate cleared the loop or washed out
          setSession((prev: any) => ({ ...prev, status: res.sessionStatus }));
          setVerdict(res.sessionStatus === 'PASSED' ? 'PASSED' : 'FAILED');
        }
      }
    } catch (err: any) {
      setIsThinking(false);

      if (err?.status === 409) {
        // Round/session state moved on under us — resync from the server
        toast.error('The interview state changed. Resyncing…');
        loadSession();
        return;
      }
      if (err?.status === 400) {
        toast.error(err.message || 'Your answer could not be processed.');
        return;
      }

      // Retryable fault (503 engine unavailable, network drop, 5xx). The backend
      // persists nothing on failure, so resending the same answer is always safe.
      setPendingAnswer(text);
      toast.error(err?.retryable || err?.status === 503
        ? 'The interviewer engine is momentarily unavailable. Your answer was kept — hit Resend.'
        : `Delivery failed: ${err?.message || 'network error'}. Your answer was kept — hit Resend.`);
    }
  };
  useEffect(() => { transmitRef.current = handleCandidateTransmission; });

  // Real compile-and-run against the platform's judging engine (Wandbox).
  const runCode = async () => {
    const s = sessionRef.current;
    if (!s || isRunning) return;
    if (codeRef.current.trim().length < 5 || codeRef.current === CODE_PLACEHOLDER) {
      return toast.error('Write some code before running.');
    }

    setIsRunning(true);
    setRunResult(null);
    try {
      const res = await fetchApi(`/api/v2/recruiter/sessions/${s.id}/run`, {
        method: 'POST',
        body: JSON.stringify({ code: codeRef.current, language, stdin: stdinInput })
      });
      setRunResult({ verdict: res.verdict, stdout: res.stdout || '', stderr: res.stderr || '' });
    } catch (err: any) {
      if (err?.status === 409) {
        toast.error(err.message || 'Execution is only available in the DSA round.');
      } else {
        toast.error(err?.message || 'Execution engine unreachable. Try again.');
      }
    } finally {
      setIsRunning(false);
    }
  };

  // 3. Audio Execution — delegated to the shared lib/voice.ts engine
  // (chunking, voice-list loading, cancel/speak race, keep-alive all handled there)
  const synthesizeNeuralVoice = (text: string) => {
    setIsAiSpeaking(true);
    speakText(text, {
      rate: 1.05,
      pitch: 0.95,
      onEnd: () => setIsAiSpeaking(false),
      onBlocked: () => {
        setIsAiSpeaking(false);
        toast('Tap anywhere on the page to enable the interviewer voice.', { icon: '🔊' });
      }
    });
  };

  const toggleMic = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      stopSpeaking();
      setIsAiSpeaking(false);

      try {
        recognitionRef.current?.start();
        setIsListening(true);
      } catch (err) {
        console.warn("Recognition already started, syncing state.");
        setIsListening(true);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Render Pipeline
  // ---------------------------------------------------------------------------
  if (loadError) {
    return (
      <div style={STYLES.centerScreen}>
        <Toaster position="bottom-right" />
        <div style={{ fontSize: 48 }}>📡</div>
        <h2 style={{ margin: 0 }}>Connection Interrupted</h2>
        <p style={{ color: 'var(--text-muted)', maxWidth: 420, lineHeight: 1.6, margin: 0 }}>{loadError.message}</p>
        <div style={{ display: 'flex', gap: 12 }}>
          {loadError.retryable && (
            <button onClick={loadSession} style={{ padding: '14px 28px', borderRadius: 999, border: 0, background: 'var(--accent-primary)', color: '#020617', fontWeight: 700, cursor: 'pointer' }}>
              Retry Connection
            </button>
          )}
          <button onClick={() => router.push('/recruiter')} style={{ padding: '14px 28px', borderRadius: 999, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-main)', fontWeight: 700, cursor: 'pointer' }}>
            Exit to Gateway
          </button>
        </div>
      </div>
    );
  }

  if (!session) return <div style={STYLES.container}><div style={{ margin: 'auto' }}>Allocating Sandbox...</div></div>;

  const currentRound = activeRoundOf(session);
  const micDisabled = isThinking || !!verdict || !viewer.owner;

  return (
    <div className="iv-container" style={STYLES.container}>
      <Toaster position="bottom-right" />

      <style>{`
        /* Below 900px the split-screen stacks: editor on top, avatar + chat below. */
        @media (max-width: 900px) {
          .iv-container { height: auto !important; min-height: 100dvh; overflow: visible !important; }
          .iv-workspace { flex-direction: column !important; overflow: visible !important; }
          .iv-left { border-right: none !important; border-bottom: 1px solid var(--border-color); }
          .iv-prompt { max-height: 30vh !important; }
          .iv-editor { flex: none !important; height: 45vh; min-height: 280px; }
          .iv-right { width: 100% !important; }
          .iv-video { height: 230px !important; }
          .iv-chatlog { flex: none !important; max-height: 45vh; min-height: 160px; }
          .iv-header { flex-wrap: wrap; gap: 8px; padding: 10px 14px !important; }
          .iv-verdict { overflow-y: auto; padding: 24px !important; }
        }
        @media (max-width: 480px) {
          .iv-controlbar { flex-wrap: wrap; padding: 14px !important; }
          .iv-controlbar button { flex: 1 1 auto; }
          .iv-run-row { flex-wrap: wrap; }
          .iv-run-row input { min-width: 140px; }
        }
      `}</style>

      {/* Upper Telemetry HUD */}
      <header className="iv-header" style={STYLES.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text-main)' }}>DivineCode Live-Action Sandbox</h2>
          <span style={{ background: 'var(--bg-card)', padding: '4px 10px', borderRadius: 6, fontSize: 13, border: '1px solid var(--border-color)', fontWeight: 'bold' }}>
            Round {session.currentRound}: {currentRound?.type.replace(/_/g, ' ')}
          </span>
          {(viewer.admin || viewer.recruiter) && !viewer.owner && (
            <span style={{ background: 'rgba(251, 191, 36, 0.15)', color: '#fbbf24', padding: '4px 10px', borderRadius: 6, fontSize: 13, border: '1px solid rgba(251, 191, 36, 0.4)', fontWeight: 'bold' }}>
              👁️ {viewer.admin ? 'ADMIN' : 'RECRUITER'} OBSERVER
            </span>
          )}
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          Session ID: <span style={{ fontFamily: 'monospace' }}>{session.id.slice(-8)}</span>
        </div>
      </header>

      <div className="iv-workspace" style={STYLES.workspace}>
        {/* Left Matrix: Code Environment */}
        <div className="iv-left" style={STYLES.leftPane}>
          <div className="iv-prompt" style={STYLES.problemPrompt}>
            <h3 style={{ margin: '0 0 10px 0', color: 'var(--accent-primary)' }}>Active Problem Context</h3>
            <p style={{ color: 'var(--text-main)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
              {currentRound?.problemStatement || 'The interviewer is preparing your round briefing…'}
            </p>
          </div>

          {/* Integrated Monaco Instance */}
          <div className="iv-editor" style={STYLES.editorWrapper}>
             <Editor
                height="100%"
                language={language === 'javascript' ? 'javascript' : language}
                theme="vs-dark"
                value={code}
                onChange={(val) => setCode(val || '')}
                options={{ minimap: { enabled: false }, fontSize: 16, padding: { top: 20 } }}
              />
          </div>

          {/* Live Execution Console — real Wandbox compile & run (DSA round only) */}
          {currentRound?.type === 'OA_DSA' && !verdict && (
            <div style={{ borderTop: '1px solid var(--border-color)', background: 'var(--bg-panel-solid)', flexShrink: 0 }}>
              <div className="iv-run-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', flexWrap: 'wrap' }}>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  disabled={isRunning}
                  style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-main)', color: 'var(--text-main)', border: '1px solid var(--border-color)', fontSize: 13, fontWeight: 600, outline: 'none' }}
                >
                  <option value="cpp">C++</option>
                  <option value="c">C</option>
                  <option value="python">Python</option>
                  <option value="java">Java</option>
                  <option value="javascript">JavaScript</option>
                </select>
                <input
                  value={stdinInput}
                  onChange={(e) => setStdinInput(e.target.value)}
                  placeholder="stdin (optional)"
                  disabled={isRunning}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-main)', color: 'var(--text-main)', border: '1px solid var(--border-color)', fontSize: 13, fontFamily: 'monospace', outline: 'none' }}
                />
                <button
                  onClick={runCode}
                  disabled={isRunning || !viewer.owner}
                  style={{ padding: '8px 22px', borderRadius: 8, border: 'none', background: isRunning ? 'var(--bg-card)' : '#22c55e', color: isRunning ? 'var(--text-muted)' : '#022c22', fontWeight: 800, fontSize: 13, cursor: isRunning || !viewer.owner ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
                >
                  {isRunning ? '⚙️ Compiling…' : '▶ Run Code'}
                </button>
              </div>

              {runResult && (
                <div style={{ padding: '0 16px 12px 16px', maxHeight: 140, overflowY: 'auto' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6, color: runResult.verdict === 'EXECUTED' || runResult.verdict === 'ACCEPTED' ? '#4ade80' : '#ef4444' }}>
                    {runResult.verdict === 'EXECUTED' || runResult.verdict === 'ACCEPTED' ? '✓' : '✗'} {runResult.verdict.replace(/_/g, ' ')}
                  </div>
                  <pre style={{ margin: 0, padding: 12, borderRadius: 8, background: '#0a0a0a', color: '#e2e8f0', fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', border: '1px solid var(--border-color)' }}>
                    {runResult.stdout || runResult.stderr || '(no output)'}
                    {runResult.stdout && runResult.stderr ? `\n--- stderr ---\n${runResult.stderr}` : ''}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Matrix: Neural Recruiter & Comm Link */}
        <div className="iv-right" style={STYLES.rightPane}>
          <div className="iv-video" style={STYLES.videoMatrix}>
            <NeuralAvatar speaking={isAiSpeaking} />

            <video ref={videoRef} autoPlay playsInline muted style={STYLES.candidateWebcam} />

            {/* Live Status Indicator */}
            <div style={{ position: 'absolute', top: 15, left: 15, background: 'rgba(0,0,0,0.6)', padding: '4px 10px', borderRadius: 999, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 'bold' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 10px #4ade80' }} />
              SECURE CONNECTION
            </div>
          </div>

          <div ref={chatLogRef} className="iv-chatlog" style={STYLES.chatLog}>
            {transcript.map((log, i) => (
              log.role === 'system' ? (
                <div key={i} style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, padding: '8px 0', borderBottom: '1px dashed var(--border-color)' }}>
                  — {log.text} —
                </div>
              ) : (
                <div key={i} style={{ padding: 12, borderRadius: 12, background: log.role === 'interviewer' ? 'var(--bg-card)' : 'rgba(165,180,252,0.1)', border: `1px solid ${log.role === 'interviewer' ? 'var(--border-color)' : 'rgba(165,180,252,0.3)'}`, color: 'var(--text-main)' }}>
                  <strong style={{ display: 'block', fontSize: 12, color: log.role === 'interviewer' ? 'var(--accent-primary)' : '#a5b4fc', marginBottom: 4, textTransform: 'uppercase' }}>
                    {log.role === 'interviewer' ? 'Senior Engineer' : 'Candidate'}
                  </strong>
                  <span style={{ lineHeight: 1.5, fontSize: 15 }}>{log.text}</span>
                </div>
              )
            ))}
            {isThinking && (
              <div style={{ padding: 12, borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 14 }}>
                Senior Engineer is evaluating your answer…
              </div>
            )}
          </div>

          {/* Retryable-fault recovery: the failed answer is preserved verbatim */}
          {pendingAnswer && !verdict && (
            <div style={STYLES.retryBanner}>
              <span style={{ color: 'var(--text-main)' }}>⚠️ Last answer not delivered.</span>
              <button
                onClick={() => transmitRef.current(pendingAnswer, true)}
                style={{ padding: '8px 18px', borderRadius: 999, border: 0, background: '#fbbf24', color: '#020617', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                Resend
              </button>
            </div>
          )}

          <div className="iv-controlbar" style={STYLES.controlBar}>
             <button
                onClick={toggleMic}
                disabled={micDisabled}
                style={{ ...STYLES.micBtn, background: isListening ? '#ef4444' : 'var(--accent-primary)', color: isListening ? '#fff' : '#000', opacity: micDisabled ? 0.5 : 1, cursor: micDisabled ? 'not-allowed' : 'pointer' }}
             >
                {isThinking ? '⏳ Evaluating…' : !viewer.owner ? '👁️ Observer Mode' : isListening ? '🛑 Stop Recording & Submit' : '🎤 Hold to Speak'}
             </button>
             {(viewer.admin || viewer.recruiter) && !verdict && session.status === 'IN_PROGRESS' && (
               <button
                 onClick={forceAdvanceRound}
                 disabled={isAdvancing || isThinking}
                 title="Admin permit: conclude this round as passed and open the next stage"
                 style={{ padding: '16px', borderRadius: 12, border: '1px solid #fbbf24', background: 'rgba(251, 191, 36, 0.1)', color: '#fbbf24', fontWeight: 'bold', cursor: isAdvancing || isThinking ? 'not-allowed' : 'pointer', opacity: isAdvancing || isThinking ? 0.5 : 1, whiteSpace: 'nowrap' }}
               >
                 {isAdvancing ? '⏳ Advancing…' : '⏭️ Skip Round'}
               </button>
             )}
             <button onClick={() => router.push('/recruiter')} style={STYLES.endBtn}>Abort</button>
          </div>
        </div>
      </div>

      {/* Terminal Verdict Overlay */}
      <AnimatePresence>
        {verdict && (
          <motion.div className="iv-verdict" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={STYLES.verdictOverlay}>
            <div style={{ fontSize: 72, marginBottom: 10 }}>{verdict === 'PASSED' ? '🎉' : '📉'}</div>
            <h1 style={{ margin: '0 0 10px 0', color: '#fff', fontSize: 'clamp(28px, 4vw, 40px)' }}>
              {verdict === 'PASSED' ? 'Offer Extended' : 'Loop Concluded'}
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.7)', maxWidth: 480, lineHeight: 1.7, marginBottom: 30 }}>
              {verdict === 'PASSED'
                ? 'You cleared every round of the interview loop. The full transcript and telemetry have been archived to your profile.'
                : 'The panel decided not to move forward this time. Review the transcript below your telemetry to see exactly where the loop broke down.'}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 35, width: '100%', maxWidth: 420 }}>
              {session.rounds.map((r: any) => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 14 }}>
                  <span>Round {r.order}: {String(r.type).replace(/_/g, ' ')}</span>
                  <strong style={{ color: r.passed === true ? '#4ade80' : r.passed === false ? '#ef4444' : 'rgba(255,255,255,0.4)' }}>
                    {r.passed === true ? `PASSED ${r.finalScore != null ? `· ${r.finalScore}` : ''}` : r.passed === false ? `FAILED ${r.finalScore != null ? `· ${r.finalScore}` : ''}` : 'NOT REACHED'}
                  </strong>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button onClick={() => router.push(`/recruiter/report/${session.id}`)} style={{ padding: '16px 36px', borderRadius: 999, border: 0, background: 'linear-gradient(135deg, #a5b4fc, #22d3ee)', color: '#020617', fontWeight: 900, fontSize: 16, cursor: 'pointer' }}>
                📊 View Full Debrief Report
              </button>
              <button onClick={() => router.push('/recruiter')} style={{ padding: '16px 36px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: '#fff', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}>
                Return to Gateway
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
