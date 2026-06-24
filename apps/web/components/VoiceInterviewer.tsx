import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';

export default function VoiceInterviewer({ 
  currentQuestion, 
  code,              // Received exact code snapshot
  onSuccess 
}: { 
  currentQuestion: any, 
  code?: string,     // Type added
  onSuccess: () => void 
}) {
  const [isListening, setIsListening] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [chatLog, setChatLog] = useState<{role: string, text: string}[]>([]);
  const [isSupported, setIsSupported] = useState(true);
  
  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesis | null>(null);
  
  // Ref buffer to prevent stale state closures inside the onend event
  const transcriptBuffer = useRef('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      synthesisRef.current = window.speechSynthesis;
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      
      if (!SpeechRecognition) {
        setIsSupported(false);
        return;
      }

      recognitionRef.current = new SpeechRecognition();
      // Keep listening even if the user pauses to think
      recognitionRef.current.continuous = true; 
      recognitionRef.current.interimResults = true;
      // Optimized for precise English pronunciation and fluency tracking
      recognitionRef.current.lang = 'en-IN'; 
      
      recognitionRef.current.onresult = (event: any) => {
        let currentTranscript = '';
        for (let i = 0; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }
        transcriptBuffer.current = currentTranscript;
        setTranscript(currentTranscript);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech Rec Error:", event.error);
        setIsListening(false);
        if (event.error === 'not-allowed') {
          toast.error("Microphone access denied. Please allow permissions in your browser.");
        } else if (event.error !== 'no-speech') {
          toast.error("Audio capture failed. Please check your microphone connection.");
        }
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
        const finalBuffer = transcriptBuffer.current.trim();
        
        // Only trigger AI if the user actually said a meaningful sentence
        if (finalBuffer.length > 10) {
          processAudioToAi(finalBuffer);
        } else if (finalBuffer.length > 0) {
          toast.error("Didn't catch enough. Please speak a full sentence.");
          setTranscript('');
          transcriptBuffer.current = '';
        }
      };
    }

    // Cleanup to prevent memory leaks or ghost audio when navigating away
    return () => {
      if (recognitionRef.current) recognitionRef.current.abort();
      if (synthesisRef.current) synthesisRef.current.cancel();
    };
  }, []);

  const processAudioToAi = async (userText: string) => {
    setChatLog(prev => [...prev, { role: 'candidate', text: userText }]);
    setTranscript('');
    transcriptBuffer.current = '';
    setIsAiSpeaking(true);

    try {
      const res = await fetch(`/api/v2/interview/questions/${currentQuestion.id}/mock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Passing the code explicitly here along with the voice input
        body: JSON.stringify({ userResponse: userText, history: chatLog, code })
      });
      const data = await res.json();
      
      if (data.evaluation) {
        const aiResponseText = data.evaluation.feedback + " " + (data.evaluation.followUpQuestion || "");
        setChatLog(prev => [...prev, { role: 'interviewer', text: aiResponseText }]);
        
        if (data.evaluation.isPassed) {
          toast.success("Module Passed!", { icon: '🏆' });
          setTimeout(() => onSuccess(), 2000);
        }
        
        speakText(aiResponseText);
      }
    } catch (err) {
      console.error("Voice AI Error", err);
      toast.error("Failed to reach Interviewer AI.");
      setIsAiSpeaking(false);
    }
  };

  const speakText = (text: string) => {
    if (!synthesisRef.current) return;
    
    // Explicitly abort any active microphone streams to absolutely prevent Echo feedback
    if (recognitionRef.current) recognitionRef.current.abort();

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = synthesisRef.current.getVoices();
    const proVoice = voices.find(v => v.lang === 'en-US' && (v.name.includes('Google') || v.name.includes('Samantha'))) || voices[0];
    
    if (proVoice) utterance.voice = proVoice;
    
    utterance.rate = 1.05; 
    utterance.pitch = 0.95; 
    
    utterance.onend = () => {
      setIsAiSpeaking(false);
    };

    synthesisRef.current.speak(utterance);
  };

  const toggleMic = () => {
    if (isListening) {
      // Manually stopping triggers the onend event which processes the buffer
      recognitionRef.current?.stop();
    } else {
      // Force kill any residual AI voice before opening the mic to prevent Echo
      if (synthesisRef.current) synthesisRef.current.cancel();
      setIsAiSpeaking(false);
      
      setTranscript('');
      transcriptBuffer.current = '';
      try {
        recognitionRef.current?.start();
        setIsListening(true);
      } catch (e) {
        // Fallback if SpeechRecognition engine is already starting
        console.warn(e);
      }
    }
  };

  if (!isSupported) {
    return (
      <div style={{ background: '#0f172a', padding: 40, borderRadius: 24, textAlign: 'center', border: '1px solid #ef4444' }}>
        <h3 style={{ color: '#ef4444' }}>Browser Not Supported</h3>
        <p style={{ color: '#94a3b8' }}>Voice interviews require a Chromium-based browser (Chrome, Edge, Arc). Please switch browsers to take this module.</p>
      </div>
    );
  }

  return (
    <div style={{ background: '#020617', borderRadius: 24, padding: 30, border: '1px solid #1e293b', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
      
      {/* Background glow when listening */}
      <AnimatePresence>
        {isListening && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'radial-gradient(circle at center, rgba(239,68,68,0.1) 0%, transparent 70%)', pointerEvents: 'none' }} />
        )}
      </AnimatePresence>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, position: 'relative', zIndex: 2 }}>
        <h3 style={{ color: '#67e8f9', margin: 0, fontSize: 20 }}>Voice-to-Voice Technical Screen</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 'bold', color: '#94a3b8', background: '#0f172a', padding: '6px 12px', borderRadius: 999, border: '1px solid #334155' }}>
          <span style={{ color: '#fbbf24' }}>★</span> Fluency & Logic Evaluator
        </div>
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 140, marginBottom: 20, position: 'relative', zIndex: 2 }}>
        {isAiSpeaking ? (
          <motion.div animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }} transition={{ repeat: Infinity, duration: 1.5 }} style={{ width: 100, height: 100, borderRadius: '50%', background: 'linear-gradient(135deg, #a5b4fc, #38bdf8)', display: 'grid', placeItems: 'center', boxShadow: '0 0 40px rgba(56,189,248,0.5)', fontSize: 40 }}>
            🤖
          </motion.div>
        ) : (
           <motion.div animate={isListening ? { scale: [1, 1.05, 1], borderColor: ['#334155', '#ef4444', '#334155'] } : {}} transition={{ repeat: Infinity, duration: 2 }} style={{ width: 100, height: 100, borderRadius: '50%', background: '#0f172a', border: '2px solid #334155', display: 'grid', placeItems: 'center', fontSize: 40, boxShadow: isListening ? '0 0 30px rgba(239,68,68,0.3)' : 'none' }}>
             {isListening ? '🎙️' : '💼'}
           </motion.div>
        )}
      </div>

      <div style={{ minHeight: 60, marginBottom: 20, position: 'relative', zIndex: 2 }}>
        <p style={{ color: isListening ? '#fff' : '#94a3b8', fontSize: 18, margin: 0, fontStyle: isListening ? 'normal' : 'italic', transition: 'color 0.3s' }}>
          {isAiSpeaking ? "Interviewer is speaking..." : isListening ? (transcript || "Listening...") : "Click the microphone to record your answer. Speak clearly."}
        </p>
      </div>

      <button 
        onClick={toggleMic} 
        disabled={isAiSpeaking}
        style={{ position: 'relative', zIndex: 2, background: isListening ? '#ef4444' : '#22d3ee', color: isListening ? '#fff' : '#020617', border: 'none', padding: '16px 32px', borderRadius: 999, fontSize: 18, fontWeight: 'bold', cursor: isAiSpeaking ? 'not-allowed' : 'pointer', boxShadow: isListening ? '0 10px 30px rgba(239,68,68,0.4)' : '0 10px 30px rgba(34,211,238,0.3)', transition: 'all 0.2s', opacity: isAiSpeaking ? 0.5 : 1 }}
      >
        {isListening ? '🛑 Stop & Submit Answer' : '🎤 Start Speaking'}
      </button>

      <div style={{ marginTop: 40, textAlign: 'left', maxHeight: 300, overflowY: 'auto', background: 'rgba(15,23,42,0.6)', padding: 20, borderRadius: 16, border: '1px solid #1e293b', position: 'relative', zIndex: 2 }}>
        {chatLog.length === 0 && <div style={{ color: '#64748b', textAlign: 'center', fontStyle: 'italic', padding: '20px 0' }}>Conversation transcript will appear here. The system will evaluate your technical logic and communication clarity.</div>}
        {chatLog.map((log, i) => (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} key={i} style={{ marginBottom: 20, color: log.role === 'interviewer' ? '#38bdf8' : '#e2e8f0', lineHeight: 1.6, background: log.role === 'interviewer' ? 'transparent' : 'rgba(255,255,255,0.03)', padding: log.role === 'interviewer' ? 0 : '12px 16px', borderRadius: 12 }}>
            <strong style={{ display: 'block', marginBottom: 6, color: log.role === 'interviewer' ? '#a5b4fc' : '#94a3b8', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>{log.role === 'interviewer' ? 'FAANG Recruiter' : 'You'}</strong>
            {log.text}
          </motion.div>
        ))}
      </div>
    </div>
  );
}