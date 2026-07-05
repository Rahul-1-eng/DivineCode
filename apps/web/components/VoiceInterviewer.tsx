/**
 * @file VoiceInterviewer.tsx
 * @author Rahul
 * @description Neural voice screening terminal utilizing native Web Speech API.
 * Handles hardware stream buffering, real-time transcript mutation, and inference gateway signaling.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { fetchApi } from '../lib/api';

// --- Structural Types ---
interface QuestionPayload {
  id: string;
  title?: string;
  prompt?: string;
  context?: string;
  track?: { title?: string };
  videoUrl?: string; // Explicit video reference if provided by the DB
}

// YouTube killed search-based embeds (listType=search) ages ago, they just show
// an error player now. So only embed when a real 11-char video id can be pulled
// out of the stored link; otherwise the UI shows the search-link card instead.
function buildReferenceVideoUrl(question: QuestionPayload): string | null {
  if (!question.videoUrl) return null;
  const match = question.videoUrl.trim().match(
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|shorts\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i
  );
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
}

function buildReferenceSearchUrl(question: QuestionPayload) {
  const seed = [question.title, question.prompt, question.context, question.track?.title]
    .filter(Boolean)
    .join(' ')
    .trim();
  const query = seed || 'software engineering interview explanation';
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

interface EvaluationMetrics {
  tech: number;
  fluency: number;
  tips: string;
}

interface ChatTranscript {
  role: 'interviewer' | 'candidate';
  text: string;
}

interface VoiceInterviewerProps {
  currentQuestion: QuestionPayload;
  code?: string;
  onSuccess: () => void;
}

// Augment Window for Webkit Speech API access without TS compiler errors
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function VoiceInterviewer({ currentQuestion, code, onSuccess }: VoiceInterviewerProps) {
  // Application State
  const [isListening, setIsListening] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [chatLog, setChatLog] = useState<ChatTranscript[]>([]);
  const [isSupported, setIsSupported] = useState(true);
  const [metrics, setMetrics] = useState<EvaluationMetrics | null>(null);
  const [videoError, setVideoError] = useState(false);
  
  // Hardware Interface Refs
  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesis | null>(null);
  const transcriptBuffer = useRef('');

  const activeVideoUrl = buildReferenceVideoUrl(currentQuestion);
  const referenceSearchUrl = buildReferenceSearchUrl(currentQuestion);
  const hasQuestionContext = Boolean(currentQuestion?.title || currentQuestion?.prompt || currentQuestion?.context);

  useEffect(() => {
    setVideoError(false);
  }, [currentQuestion?.id, currentQuestion?.title]);

  // 1. Hardware Initialization Pipeline
  useEffect(() => {
    if (typeof window === 'undefined') return;

    synthesisRef.current = window.speechSynthesis;
    
    // Force voice allocation on mount to prevent rendering latency on first synthetic utterance
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = () => synthesisRef.current?.getVoices();
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true; 
    recognition.interimResults = true;
    // Set to en-IN to ensure maximum fidelity for local accents based on target demographic
    recognition.lang = 'en-IN'; 
    
    recognition.onresult = (event: any) => {
      let currentTranscript = '';
      for (let i = 0; i < event.results.length; i++) {
        currentTranscript += event.results[i][0].transcript;
      }
      // Mutate ref directly to avoid dependency cycle re-renders during high-frequency audio polling
      transcriptBuffer.current = currentTranscript;
      setTranscript(currentTranscript);
    };

    recognition.onerror = (event: any) => {
      // Safely ignore no-speech timeouts, but alert on hard hardware/permission faults
      if (event.error === 'not-allowed') {
        toast.error("Hardware constraint: Microphone access denied.");
        setIsListening(false);
      } else if (event.error !== 'no-speech') {
        console.warn(`Speech recognition fault: ${event.error}`);
      }
    };

    recognition.onend = () => {
      // The Web Speech API natively stops on long pauses. 
      // Only UI state is updated here to prevent prematurely submitting incomplete algorithmic thoughts.
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    // Critical cleanup: ensure no hanging audio hardware allocations survive unmount
    return () => {
      if (recognitionRef.current) recognitionRef.current.abort();
      if (synthesisRef.current) synthesisRef.current.cancel();
    };
  }, []);

  // 2. Inference & Evaluation Pipeline
  const processAudioToAi = useCallback(async (userText: string) => {
    if (userText.trim().length < 10) {
      toast.error("Audio buffer insufficient for technical evaluation.");
      return;
    }

    setChatLog(prev => [...prev, { role: 'candidate', text: userText }]);
    setTranscript('');
    transcriptBuffer.current = '';
    setIsAiSpeaking(true);

    try {
      const data = await fetchApi(`/api/v2/interview/questions/${currentQuestion.id}/mock`, {
        method: 'POST',
        body: JSON.stringify({ 
            userResponse: userText, 
            history: chatLog, 
            code: code || "" // Force empty string if code is undefined
        })
      });
      
      if (data?.evaluation) {
        const aiResponseText = `${data.evaluation.feedback} ${data.evaluation.followUpQuestion || ""}`;
        setChatLog(prev => [...prev, { role: 'interviewer', text: aiResponseText }]);
        
        setMetrics({
          tech: data.evaluation.technicalScore || 0,
          fluency: data.evaluation.fluencyScore || 0,
          tips: data.evaluation.pronunciationTips || "Execution clear."
        });

        // Trigger upstream success callback if algorithmic thresholds are satisfied
        if (data.evaluation.isPassed) {
          toast.success("Technical Module Resolved Successfully", { icon: '🏆' });
          setTimeout(() => onSuccess(), 2000);
        }
        
        executeSpeechSynthesis(aiResponseText);
      } else {
        const fallbackText = 'The voice evaluation service is temporarily unavailable, but your response has been recorded. Please summarize the core idea, the complexity, and a small example.';
        setChatLog(prev => [...prev, { role: 'interviewer', text: fallbackText }]);
        setMetrics({ tech: 60, fluency: 60, tips: 'AI evaluation unavailable. Focus on clarity and complexity.' });
        executeSpeechSynthesis(fallbackText);
      }
    } catch (err) {
      const fallbackText = 'The voice evaluation service is temporarily unavailable, but your response has been recorded. Please summarize your thought process and time complexity.';
      setChatLog(prev => [...prev, { role: 'interviewer', text: fallbackText }]);
      setMetrics({ tech: 60, fluency: 60, tips: 'Fallback mode enabled while the AI service is unavailable.' });
      executeSpeechSynthesis(fallbackText);
      setIsAiSpeaking(false);
    }
  }, [chatLog, currentQuestion.id, code, onSuccess]);

  // 3. Audio Synthesis Execution
  const executeSpeechSynthesis = (text: string) => {
    if (!synthesisRef.current) return;
    
    // Halt input stream while AI is broadcasting to prevent recursive microphone feedback loops
    if (recognitionRef.current) recognitionRef.current.abort();

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = synthesisRef.current.getVoices();
    
    // Prioritize high-fidelity neural voices if available in the host OS
    let premiumVoice = voices.find(v => 
      v.name.includes('Google UK English') || 
      v.name.includes('Microsoft Ava') || 
      v.name.includes('Samantha')
    );

    if (!premiumVoice && voices.length > 0) {
      premiumVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
    }
    
    if (premiumVoice) utterance.voice = premiumVoice;
    utterance.rate = 1.0; 
    utterance.pitch = 1.05; 
    
    utterance.onend = () => setIsAiSpeaking(false);
    synthesisRef.current.speak(utterance);
  };

  // 4. Hardware Input Toggle
  const toggleMic = () => {
    if (isListening) {
      // User explicitly stopped. Finalize buffer and route to neural screening.
      recognitionRef.current?.stop();
      setIsListening(false);
      processAudioToAi(transcriptBuffer.current);
    } else {
      // Clear previous states and engage microphone hardware
      if (synthesisRef.current) synthesisRef.current.cancel();
      setIsAiSpeaking(false);
      setTranscript('');
      transcriptBuffer.current = '';
      
      try {
        recognitionRef.current?.start();
        setIsListening(true);
      } catch (e) {
        // Handle cases where the mic is already silently listening in the background OS layer
        console.warn("Hardware initialization overlapping:", e);
      }
    }
  };

  if (!isSupported) {
    return (
      <div style={STYLES.unsupportedPane}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🎙️</div>
        <h3 style={{ color: 'var(--text-main)', fontSize: 20, marginBottom: 8 }}>API Compatibility Fault</h3>
        <p style={{ color: 'var(--text-muted)', maxWidth: 400, margin: '0 auto', lineHeight: 1.5 }}>
          The real-time neural audio processing engine requires Chromium-based native Web Speech API support (Chrome, Edge, or Arc).
        </p>
      </div>
    );
  }

  return (
    <div style={STYLES.container}>
      {/* Active Recording State Visualizer */}
      <AnimatePresence>
        {isListening && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            style={STYLES.recordingAura} 
          />
        )}
      </AnimatePresence>

      <div style={STYLES.headerRow}>
        <h3 style={{ color: 'var(--accent-primary)', margin: 0, fontSize: 20 }}>Neural Voice Screening</h3>
        <div style={STYLES.badge}>
          <span style={{ color: '#fbbf24' }}>★</span> Fluency & Logic Evaluator
        </div>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', position: 'relative', zIndex: 2 }}>
        {/* Left Column: AI Avatar */}
        <div style={STYLES.avatarWrapper}>
          {isAiSpeaking ? (
            <motion.div 
              animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }} 
              transition={{ repeat: Infinity, duration: 1.5 }} 
              style={STYLES.aiAvatar}
            >
              🤖
            </motion.div>
          ) : (
             <motion.div 
               animate={isListening ? { scale: [1, 1.05, 1], borderColor: ['var(--border-color)', '#ef4444', 'var(--border-color)'] } : {}} 
               transition={{ repeat: Infinity, duration: 2 }} 
               style={{ ...STYLES.idleAvatar, boxShadow: isListening ? '0 0 30px rgba(239,68,68,0.3)' : 'none' }}
             >
               {isListening ? '🎙️' : '💼'}
             </motion.div>
          )}
        </div>

        {/* Right Column: Reference Video (only when a real video is linked) */}
        <div style={STYLES.videoWrapper}>
          {activeVideoUrl && !videoError ? (
            <iframe
              src={activeVideoUrl}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ width: '100%', height: '100%', border: 'none', borderRadius: '12px' }}
              title="Reference Material"
              onError={() => setVideoError(true)}
            />
          ) : (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-main)' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🎥</div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{videoError ? 'Reference video unavailable' : 'No editorial video linked yet'}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>The voice coach still works; open a YouTube lesson instead.</div>
              <a href={referenceSearchUrl} target="_blank" rel="noreferrer" style={STYLES.referenceLink}>Open matching lesson</a>
            </div>
          )}
        </div>
      </div>

      <div style={STYLES.referenceBar}>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{hasQuestionContext ? 'Reference search ready for this topic.' : 'Reference material is being prepared for the selected practice problem.'}</span>
        <a href={referenceSearchUrl} target="_blank" rel="noreferrer" style={STYLES.referenceLink}>
          Open matching YouTube lesson
        </a>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', position: 'relative', zIndex: 2 }}>
      </div>

      <div style={{ minHeight: 60, marginBottom: 20, position: 'relative', zIndex: 2 }}>
        <p style={{ color: isListening ? 'var(--text-main)' : 'var(--text-muted)', fontSize: 18, margin: 0, fontStyle: isListening ? 'normal' : 'italic', transition: 'color 0.3s' }}>
          {isAiSpeaking ? "Executing response synthesis..." : isListening ? (transcript || "Awaiting audio input...") : "Initialize microphone to record matrix."}
        </p>
      </div>

      <button 
        onClick={toggleMic} 
        disabled={isAiSpeaking}
        style={{ ...STYLES.toggleBtn, background: isListening ? '#ef4444' : 'var(--accent-primary)', color: isListening ? '#fff' : '#020617', boxShadow: isListening ? '0 10px 30px rgba(239,68,68,0.4)' : '0 10px 30px var(--accent-glow)', opacity: isAiSpeaking ? 0.5 : 1 }}
      >
        {isListening ? '🛑 Finalize & Submit Transmission' : '🎤 Initialize Audio Stream'}
      </button>

      {/* Post-Inference Telemetry */}
      {metrics && (
        <div style={STYLES.metricsGrid}>
          <div style={STYLES.metricCardPrimary}>
            <div style={STYLES.metricLabel}>Technical Logic</div>
            <div style={{ fontSize: 28, color: 'var(--accent-primary)', fontWeight: 'bold' }}>{metrics.tech}/100</div>
          </div>
          <div style={STYLES.metricCardSecondary}>
            <div style={STYLES.metricLabel}>English Fluency</div>
            <div style={{ fontSize: 28, color: '#a855f7', fontWeight: 'bold' }}>{metrics.fluency}/100</div>
          </div>
          <div style={STYLES.evaluationBlock}>
            <strong style={{ color: '#a855f7' }}>Execution Log:</strong> {metrics.tips}
          </div>
        </div>
      )}

      {/* Synchronized Transcript Buffer */}
      <div style={STYLES.chatContainer}>
        {chatLog.length === 0 && <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontStyle: 'italic', padding: '20px 0' }}>Telemetry logs will append dynamically during the screening.</div>}
        {chatLog.map((log, i) => (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} key={i} style={{ marginBottom: 20, color: log.role === 'interviewer' ? 'var(--accent-primary)' : 'var(--text-main)', lineHeight: 1.6, background: log.role === 'interviewer' ? 'transparent' : 'var(--table-hover)', padding: log.role === 'interviewer' ? 0 : '12px 16px', borderRadius: 12 }}>
            <strong style={{ display: 'block', marginBottom: 6, color: log.role === 'interviewer' ? 'var(--accent-primary)' : 'var(--text-muted)', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>{log.role === 'interviewer' ? 'Neural Recruiter' : 'Candidate Vector'}</strong>
            {log.text}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Component Style Dictionary
// -----------------------------------------------------------------------------
const STYLES: Record<string, React.CSSProperties> = {
  unsupportedPane: { background: 'var(--bg-panel-solid)', padding: 40, borderRadius: 24, textAlign: 'center', border: '1px solid rgba(248, 113, 113, 0.4)' },
  container: { background: 'var(--bg-panel-solid)', borderRadius: 24, padding: 'clamp(20px, 4vw, 30px)', border: '1px solid var(--border-color)', textAlign: 'center', position: 'relative', overflow: 'hidden' },
  recordingAura: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'radial-gradient(circle at center, rgba(239,68,68,0.1) 0%, transparent 70%)', pointerEvents: 'none' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, position: 'relative', zIndex: 2, flexWrap: 'wrap', gap: 10 },
  badge: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 'bold', color: 'var(--text-muted)', background: 'var(--bg-card)', padding: '6px 12px', borderRadius: 999, border: '1px solid var(--border-color)' },
  avatarWrapper: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: 160 },
  videoWrapper: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: 160, background: '#000', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-color)' },
  referenceBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, margin: '10px 0 20px', padding: '10px 14px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border-color)', position: 'relative', zIndex: 2, flexWrap: 'wrap' },
  referenceLink: { color: 'var(--accent-primary)', fontWeight: 700, textDecoration: 'none' },
  aiAvatar: { width: 100, height: 100, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-primary), #818cf8)', display: 'grid', placeItems: 'center', boxShadow: '0 0 40px var(--accent-glow)', fontSize: 40 },
  idleAvatar: { width: 100, height: 100, borderRadius: '50%', background: 'var(--bg-main)', border: '2px solid var(--border-color)', display: 'grid', placeItems: 'center', fontSize: 40 },
  toggleBtn: { position: 'relative', zIndex: 2, border: 'none', padding: '16px 32px', borderRadius: 999, fontSize: 15, fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s' },
  metricsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginTop: 30, position: 'relative', zIndex: 2 },
  metricCardPrimary: { background: 'var(--accent-glow)', padding: 15, borderRadius: 12, border: '1px solid var(--accent-primary)' },
  metricCardSecondary: { background: 'rgba(168,85,247,0.1)', padding: 15, borderRadius: 12, border: '1px solid rgba(168,85,247,0.3)' },
  metricLabel: { fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 },
  evaluationBlock: { gridColumn: '1 / -1', background: 'var(--bg-card)', padding: 12, borderRadius: 12, fontSize: 13, color: 'var(--text-main)', textAlign: 'left', border: '1px solid var(--border-color)' },
  chatContainer: { marginTop: 25, textAlign: 'left', maxHeight: 300, overflowY: 'auto', background: 'var(--bg-card)', padding: 20, borderRadius: 16, border: '1px solid var(--border-color)', position: 'relative', zIndex: 2 }
};