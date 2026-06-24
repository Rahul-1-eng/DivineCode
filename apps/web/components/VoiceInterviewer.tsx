import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

export default function VoiceInterviewer({ 
  currentQuestion, 
  onSuccess 
}: { 
  currentQuestion: any, 
  onSuccess: () => void 
}) {
  const [isListening, setIsListening] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [chatLog, setChatLog] = useState<{role: string, text: string}[]>([]);
  
  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesis | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      synthesisRef.current = window.speechSynthesis;
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = true;
        
        recognitionRef.current.onresult = (event: any) => {
          let currentTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            currentTranscript += event.results[i][0].transcript;
          }
          setTranscript(currentTranscript);
        };

        recognitionRef.current.onend = () => {
          setIsListening(false);
          // Auto-send to AI when the user stops talking
          if (transcript.trim().length > 5) {
             processAudioToAi(transcript);
          }
        };
      }
    }
  }, [transcript]);

  const processAudioToAi = async (userText: string) => {
    setChatLog(prev => [...prev, { role: 'candidate', text: userText }]);
    setTranscript('');
    setIsAiSpeaking(true);

    try {
      const res = await fetch(`/api/v2/interview/questions/${currentQuestion.id}/mock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userResponse: userText, history: chatLog })
      });
      const data = await res.json();
      
      if (data.evaluation) {
        const aiResponseText = data.evaluation.feedback + " " + (data.evaluation.followUpQuestion || "");
        setChatLog(prev => [...prev, { role: 'interviewer', text: aiResponseText }]);
        
        if (data.evaluation.isPassed) {
          onSuccess();
        }
        
        speakText(aiResponseText);
      }
    } catch (err) {
      console.error("Voice AI Error", err);
      setIsAiSpeaking(false);
    }
  };

  const speakText = (text: string) => {
    if (!synthesisRef.current) return;
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Attempt to pick a natural-sounding English voice
    const voices = synthesisRef.current.getVoices();
    const proVoice = voices.find(v => v.lang === 'en-US' && (v.name.includes('Google') || v.name.includes('Samantha'))) || voices[0];
    if (proVoice) utterance.voice = proVoice;
    
    utterance.rate = 1.05; 
    utterance.pitch = 0.95; 
    
    utterance.onend = () => setIsAiSpeaking(false);
    synthesisRef.current.speak(utterance);
  };

  const toggleMic = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setTranscript('');
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  return (
    <div style={{ background: '#020617', borderRadius: 24, padding: 30, border: '1px solid #1e293b', textAlign: 'center' }}>
      <h3 style={{ color: '#67e8f9', margin: '0 0 20px 0' }}>Voice-to-Voice Technical Screen</h3>
      
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 120, marginBottom: 30 }}>
        {isAiSpeaking ? (
          <motion.div animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }} transition={{ repeat: Infinity, duration: 1.5 }} style={{ width: 100, height: 100, borderRadius: '50%', background: 'linear-gradient(135deg, #a5b4fc, #38bdf8)', display: 'grid', placeItems: 'center', boxShadow: '0 0 40px rgba(56,189,248,0.5)', fontSize: 40 }}>
            🤖
          </motion.div>
        ) : (
           <div style={{ width: 100, height: 100, borderRadius: '50%', background: '#0f172a', border: '2px solid #334155', display: 'grid', placeItems: 'center', fontSize: 40, transition: '0.3s' }}>
             💼
           </div>
        )}
      </div>

      <p style={{ color: '#eef2ff', fontSize: 18, minHeight: 50, fontStyle: 'italic' }}>
        {isAiSpeaking ? "Interviewer is speaking..." : isListening ? `"${transcript}"` : "Click the microphone to start your answer."}
      </p>

      <button 
        onClick={toggleMic} 
        disabled={isAiSpeaking}
        style={{ background: isListening ? '#ef4444' : '#22d3ee', color: isListening ? '#fff' : '#020617', border: 'none', padding: '16px 32px', borderRadius: 999, fontSize: 18, fontWeight: 'bold', cursor: isAiSpeaking ? 'not-allowed' : 'pointer', boxShadow: isListening ? '0 0 20px rgba(239,68,68,0.5)' : 'none', transition: '0.2s' }}
      >
        {isListening ? '🛑 Stop Recording' : '🎤 Start Speaking'}
      </button>

      <div style={{ marginTop: 30, textAlign: 'left', maxHeight: 250, overflowY: 'auto', background: 'rgba(15,23,42,0.5)', padding: 20, borderRadius: 16, border: '1px solid #1e293b' }}>
        {chatLog.length === 0 && <div style={{ color: '#64748b', textAlign: 'center', fontStyle: 'italic' }}>Conversation log will appear here...</div>}
        {chatLog.map((log, i) => (
          <div key={i} style={{ marginBottom: 16, color: log.role === 'interviewer' ? '#38bdf8' : '#e2e8f0', lineHeight: 1.6 }}>
            <strong style={{ display: 'block', marginBottom: 4, color: log.role === 'interviewer' ? '#a5b4fc' : '#94a3b8' }}>{log.role === 'interviewer' ? 'FAANG Recruiter: ' : 'You: '}</strong>
            {log.text}
          </div>
        ))}
      </div>
    </div>
  );
}