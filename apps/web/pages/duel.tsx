/**
 * @file duel.tsx
 * @author Rahul Kumar Sahoo
 * @description Page-level experience and view logic.
 */

import { CSSProperties, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchApi } from '../lib/api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || API_BASE_URL;
const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

type DuelMode = 'menu' | 'custom_menu' | 'random_waiting' | 'custom_host_waiting' | 'playing';

export default function DuelPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const socketRef = useRef<Socket | null>(null);

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('Connect and enter the arena.');
  const [duelMode, setDuelMode] = useState<DuelMode>('menu');
  
  const [question, setQuestion] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [joined, setJoined] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [time, setTime] = useState(20);
  
  const [customRoomCode, setCustomRoomCode] = useState<string>('');
  const [joinInputCode, setJoinInputCode] = useState<string>('');

  const [availableQuestions, setAvailableQuestions] = useState<any[]>([]);
  const [useCustomQuestions, setUseCustomQuestions] = useState(false);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>(Array(7).fill(''));
  
  const [myAttempts, setMyAttempts] = useState(0);
  const [lockedOptions, setLockedOptions] = useState<number[]>([]);

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const [voiceStatus, setVoiceStatus] = useState<'disconnected'|'connecting'|'connected'>('disconnected');
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<{ [socketId: string]: RTCPeerConnection }>({});

  useEffect(() => {
    if (router.query.mode === 'custom') setDuelMode('custom_menu');
    
    if (session) {
      fetchApi(`/api/v2/interview/questions`)
        .then(data => { if (Array.isArray(data)) setAvailableQuestions(data); })
        .catch(console.error);
    }
  }, [router.query, session]);

  const cleanupAudioElement = (socketId: string) => {
    const audio = document.getElementById(`audio-${socketId}`) as HTMLAudioElement;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio.remove();
    }
  };

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'], reconnection: true, reconnectionDelayMax: 5000, timeout: 10000 });
    socketRef.current = socket;
    
    socket.on('connect', () => { setConnected(true); setStatus('Connected. Ready for matchmaking.'); });
    socket.on('disconnect', () => { setConnected(false); setStatus('Disconnected from duel server.'); });
    
    socket.on('duel:waiting', (data) => setStatus(data.message || 'Waiting for opponent...'));
    
    socket.on('duel:customCreated', (data) => {
      setCustomRoomCode(data.roomCode);
      setDuelMode('custom_host_waiting');
      setStatus('Waiting for opponent to join...');
    });

    socket.on('duel:error', (data) => {
      alert(data.message);
      setDuelMode('menu');
      setJoined(false);
    });

    socket.on('duel:start', (data) => { 
      setRoomId(data.roomId); 
      setPlayers(data.players); 
      setDuelMode('playing');
      setStatus('Duel started!'); 
      setTime(20); 
    });
    
    socket.on('duel:state', (state) => { 
      setRoomId(state.roomId); 
      setPlayers(state.players); 
      setFinished(state.finished); 
      
      setQuestion((prevQ: any) => {
        if (prevQ?.id !== state.question?.id) {
          setTime(20); 
          setMyAttempts(0);
          setLockedOptions([]);
        }
        return state.question;
      });

      if (!state.finished && state.question) setStatus('Answer before the timer burns out.'); 
      if (state.finished) setStatus('Duel finished. Rankings synced.'); 
    });
    
    socket.on('duel:feedback', (data) => {
      if (data.playerId === socketRef.current?.id && !data.correct) {
        setMyAttempts(2 - (data.attemptsLeft || 0));
      }
      setFeedback(`${data.playerName} answered ${data.correct ? 'correctly ✅' : 'wrong ❌'} (${data.attemptsLeft || 0} chances left)`); 
    });

    socket.on('chat:message', (msg) => {
      setMessages(prev => [...prev, { ...msg, type: 'text' }]);
    });

    socket.on('chat:image', (msg) => {
      setMessages(prev => [...prev, { ...msg, type: 'image' }]);
    });

    socket.on('webrtc:offer', async ({ senderId, offer }) => {
      if (!localStreamRef.current) return; 

      const pc = new RTCPeerConnection(ICE_SERVERS);
      peersRef.current[senderId] = pc;
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current!));

      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('webrtc:ice-candidate', { roomId: stateRoomIdRef.current, candidate: e.candidate });
      };

      pc.ontrack = (e) => {
        let audio = document.getElementById(`audio-${senderId}`) as HTMLAudioElement;
        if (!audio) {
          audio = document.createElement('audio');
          audio.id = `audio-${senderId}`;
          audio.autoplay = true;
          document.body.appendChild(audio);
        }
        audio.srcObject = e.streams[0];
      };

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc:answer', { roomId: stateRoomIdRef.current, answer });
    });

    socket.on('webrtc:answer', async ({ senderId, answer }) => {
      const pc = peersRef.current[senderId];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('webrtc:ice-candidate', async ({ senderId, candidate }) => {
      const pc = peersRef.current[senderId];
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
    });

    socket.on('webrtc:leave', ({ senderId }) => {
      if (peersRef.current[senderId]) {
        peersRef.current[senderId].close();
        delete peersRef.current[senderId];
      }
      cleanupAudioElement(senderId);
    });
    
    return () => { 
      socket.disconnect(); 
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      Object.entries(peersRef.current).forEach(([id, pc]) => {
        pc.close();
        cleanupAudioElement(id);
      });
    };
  }, []);

  const stateRoomIdRef = useRef(roomId);
  useEffect(() => { stateRoomIdRef.current = roomId; }, [roomId]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function answer(index: number) { 
    if (!socketRef.current || !roomId || !question || myAttempts >= 2 || lockedOptions.includes(index) || time <= 0) return; 
    setLockedOptions(prev => [...prev, index]); 
    socketRef.current.emit('duel:answer', { roomId, questionId: question.id, answerIndex: index }); 
  }

  // Timer Syncer
  useEffect(() => { 
    if (!question || finished) return; 
    const t = setInterval(() => {
      setTime((v) => {
        if (v <= 1) setStatus("Time's up! Syncing with server...");
        return Math.max(0, v - 1);
      });
    }, 1000); 
    return () => clearInterval(t); 
  }, [question, finished]);

  function joinRandom() { 
    if (!socketRef.current || joined) return; 
    const name = session?.user?.name || session?.user?.email || `Player-${Math.floor(Math.random() * 1000)}`; 
    const userEmail = session?.user?.email; 

    socketRef.current.emit('duel:join', { name, userEmail }); 
    setJoined(true); 
    setDuelMode('random_waiting');
    setStatus('Analyzing Elo rating and searching for a worthy opponent...'); 
  }

  function createCustom() {
    if (!socketRef.current || joined) return;
    
    const filteredIds = selectedQuestionIds.filter(id => id !== '');
    if (useCustomQuestions && filteredIds.length < 7) {
      return alert("Please select exactly 7 questions for your custom loadout.");
    }

    const name = session?.user?.name || session?.user?.email || `Player-${Math.floor(Math.random() * 1000)}`; 
    const userEmail = session?.user?.email; 
    
    socketRef.current.emit('duel:createCustom', { 
      name, 
      userEmail,
      questionIds: useCustomQuestions ? filteredIds : undefined 
    });
    setJoined(true);
  }

  function joinCustom() {
    if (!socketRef.current || joined || !joinInputCode.trim()) return;
    
    const name = session?.user?.name || session?.user?.email || `Player-${Math.floor(Math.random() * 1000)}`; 
    const userEmail = session?.user?.email; 

    socketRef.current.emit('duel:joinCustom', { name, userEmail, roomCode: joinInputCode });
    setJoined(true);
  }

  const handleSendMessage = () => {
    if (!chatInput.trim() || !socketRef.current || !roomId) return;
    socketRef.current.emit('chat:message', { roomId, message: chatInput.trim() });
    setChatInput('');
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !socketRef.current || !roomId) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      socketRef.current!.emit('chat:image', { roomId, imageUrl: base64 });
    };
    reader.readAsDataURL(file);
  };

  const toggleVoice = async () => {
    if (!socketRef.current || !roomId) return alert("Must be in a duel to connect voice.");

    if (voiceStatus === 'connected' || voiceStatus === 'connecting') {
      setVoiceStatus('disconnected');
      socketRef.current.emit('webrtc:leave', { roomId });
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      Object.entries(peersRef.current).forEach(([socketId, pc]) => {
        pc.close();
        cleanupAudioElement(socketId);
      });
      peersRef.current = {};
    } else {
      setVoiceStatus('connecting');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream;
        setVoiceStatus('connected');
        
        const pc = new RTCPeerConnection(ICE_SERVERS);
        
        const opponent = players.find(p => p.id !== socketRef.current?.id);
        const opponentId = opponent?.id || 'opponent';

        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        pc.onicecandidate = (e) => {
          if (e.candidate) socketRef.current!.emit('webrtc:ice-candidate', { roomId, candidate: e.candidate });
        };

        pc.ontrack = (e) => {
          let audio = document.getElementById(`audio-${opponentId}`) as HTMLAudioElement;
          if (!audio) {
            audio = document.createElement('audio');
            audio.id = `audio-${opponentId}`;
            audio.autoplay = true;
            document.body.appendChild(audio);
          }
          audio.srcObject = e.streams[0];
        };
        
        peersRef.current[opponentId] = pc;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current.emit('webrtc:offer', { roomId, offer });

      } catch (err: any) {
        setVoiceStatus('disconnected');
        alert("Microphone access denied or unavailable.");
      }
    }
  };

  const leader = [...players].sort((a, b) => b.score - a.score)[0];

  return (
    <main style={page}>
     <nav style={nav}>
        <a href="/" style={brand}>
          <img src="/logo.png" alt="DivineCode Logo" style={{ width: 32, height: 32, objectFit: 'contain' }} />
          DivineCode Duel
        </a>
        <div style={userPill}>{session?.user?.name || session?.user?.email || 'Guest Player'}</div>
      </nav>
      
      <section style={arena}>
        <div style={hud}>
          <span style={connected ? online : offline}>{connected ? 'SERVER ONLINE' : 'SERVER OFFLINE'}</span>
          <strong style={{ flex: '1 1 auto', textAlign: 'center', color: time <= 0 ? '#ef4444' : 'var(--text-main)' }}>{status}</strong>
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{roomId || 'Match not started'}</span>
        </div>
        
        <div style={versusContainer}>
          {players.length ? (
            <>
              <div style={players[0].id === leader?.id ? leaderCard : playerCard}>
                <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 'bold' }}>{players[0].id === leader?.id ? 'LEADING' : 'PLAYER 1'}</span>
                <strong style={{ fontSize: 'clamp(24px, 4vw, 32px)', color: 'var(--text-main)' }}>{players[0].name}</strong>
                <b style={{ fontSize: 'clamp(40px, 6vw, 52px)', color: 'var(--text-main)' }}>{players[0].score}</b>
                <small style={{ color: 'var(--text-muted)' }}>battle score</small>
              </div>

              <div style={vsBadgeContainer}>
                <div style={vsBadge}>VS</div>
              </div>

              <div style={players[1]?.id === leader?.id ? leaderCard : playerCard}>
                <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 'bold' }}>{players[1]?.id === leader?.id ? 'LEADING' : 'PLAYER 2'}</span>
                <strong style={{ fontSize: 'clamp(24px, 4vw, 32px)', color: 'var(--text-main)' }}>{players[1]?.name || 'Waiting...'}</strong>
                <b style={{ fontSize: 'clamp(40px, 6vw, 52px)', color: 'var(--text-main)' }}>{players[1]?.score || 0}</b>
                <small style={{ color: 'var(--text-muted)' }}>battle score</small>
              </div>
            </>
          ) : (
            <>
              <div style={playerCard}>
                <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 'bold' }}>Waiting Player 1</span>
                <strong style={{ fontSize: 'clamp(40px, 6vw, 52px)', color: 'var(--text-main)' }}>0</strong>
                <small style={{ color: 'var(--text-muted)' }}>battle score</small>
              </div>

              <div style={vsBadgeContainer}>
                <div style={vsBadge}>VS</div>
              </div>

              <div style={playerCard}>
                <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 'bold' }}>Waiting Player 2</span>
                <strong style={{ fontSize: 'clamp(40px, 6vw, 52px)', color: 'var(--text-main)' }}>0</strong>
                <small style={{ color: 'var(--text-muted)' }}>battle score</small>
              </div>
            </>
          )}
        </div>

        <div style={controlsContainer}>
          {!joined && duelMode === 'menu' && (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', width: '100%', maxWidth: 500, margin: '0 auto' }}>
              <button onClick={joinRandom} disabled={!connected} style={{...joinBtn, flex: 1}}>🌍 Random Match</button>
              <button onClick={() => setDuelMode('custom_menu')} disabled={!connected} style={{...ghostBtn, flex: 1, padding: 16, fontSize: 18}}>🔒 Custom Match</button>
            </div>
          )}

          {!joined && duelMode === 'custom_menu' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%', maxWidth: 600, margin: '0 auto' }}>
              <div style={configCard}>
                <h3 style={{ margin: '0 0 10px', color: 'var(--accent-primary)' }}>Room Settings</h3>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontWeight: 'bold', marginBottom: 16, color: 'var(--text-main)' }}>
                  <input type="checkbox" checked={useCustomQuestions} onChange={(e) => setUseCustomQuestions(e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
                  Build Custom Question Loadout
                </label>

                {useCustomQuestions ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Select exactly 7 questions for the duel:</p>
                    {selectedQuestionIds.map((val, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ color: '#fbbf24', fontWeight: 'bold', width: 20 }}>{idx + 1}.</span>
                        <select 
                          value={val} 
                          onChange={(e) => {
                            const newIds = [...selectedQuestionIds];
                            newIds[idx] = e.target.value;
                            setSelectedQuestionIds(newIds);
                          }}
                          style={selectInput}
                        >
                          <option value="" disabled>-- Select a Question --</option>
                          {availableQuestions.map(q => (
                            <option key={q.id} value={q.id}>[{q.track?.title || 'General'}] {q.title || q.prompt.substring(0, 40)}...</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>The system will draw 7 random questions from the database.</p>
                )}
              </div>

              <button onClick={createCustom} disabled={!connected} style={joinBtn}>Create Private Room</button>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
                <span style={{ color: 'var(--text-muted)', fontWeight: 'bold', fontSize: 12 }}>OR</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <input 
                  value={joinInputCode} 
                  onChange={e => setJoinInputCode(e.target.value.toUpperCase())} 
                  placeholder="Enter 6-Digit Room Code" 
                  style={codeInput} 
                />
                <button onClick={joinCustom} disabled={!connected || !joinInputCode.trim()} style={{...ghostBtn, padding: '0 24px', fontSize: 16}}>Join</button>
              </div>
              <button onClick={() => setDuelMode('menu')} style={backBtn}>← Back to Matchmaking</button>
            </div>
          )}

          {duelMode === 'custom_host_waiting' && (
            <div style={{ textAlign: 'center', padding: 24, background: 'var(--accent-glow)', borderRadius: 20, border: '1px solid var(--accent-primary)' }}>
              <p style={{ margin: '0 0 10px 0', color: 'var(--accent-primary)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 2 }}>Room Created</p>
              <p style={{ margin: 0, color: 'var(--text-main)' }}>Share this code with your opponent:</p>
              <h1 style={{ fontSize: 54, margin: '10px 0', letterSpacing: 6, color: 'var(--text-main)' }}>{customRoomCode}</h1>
            </div>
          )}
        </div>
        
        {feedback && <div style={feedbackBox}>{feedback}</div>}
        
        {finished && (
          <section style={questionCard}>
            <h2 style={{ margin: '0 0 10px 0', color: 'var(--text-main)' }}>Duel Finished</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>Winner: <b style={{ color: 'var(--text-main)' }}>{leader?.name || 'No winner'}</b></p>
            <button onClick={() => window.location.reload()} style={primaryLink}>Leave Arena</button>
          </section>
        )}
        
        {!finished && question && duelMode === 'playing' && (
          <section style={questionCard}>
            <div style={progress}>
              <span style={{ color: 'var(--accent-primary)' }}>Question {question.number}/{question.total} · {question.concept}</span>
              <span style={timer}>{time}s</span>
            </div>
            <div style={bar}>
              <span style={{ ...barFill, width: `${(time / 20) * 100}%`, transition: 'width 1s linear' }} />
            </div>
            
            <h1 style={{ fontSize: 'clamp(20px, 4vw, 28px)', margin: '24px 0', color: 'var(--text-main)' }}>{question.question}</h1>
            
            <div style={optionGrid}>
              {question.options.map((opt: string, index: number) => {
                const isLocked = lockedOptions.includes(index);
                const isOutOfAttempts = myAttempts >= 2 || time <= 0;
                const isDisabled = isLocked || isOutOfAttempts;

                return (
                  <button 
                    key={opt} 
                    onClick={() => answer(index)} 
                    disabled={isDisabled}
                    style={{
                      ...optionBtn,
                      opacity: isDisabled ? 0.6 : 1,
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      background: isLocked ? 'rgba(239, 68, 68, 0.15)' : optionBtn.background,
                      border: isLocked ? '1px solid #ef4444' : optionBtn.border
                    }}
                  >
                    <span style={{...letter, color: isLocked ? '#ef4444' : 'var(--accent-primary)', background: isLocked ? 'rgba(239, 68, 68, 0.15)' : letter.background}}>
                      {String.fromCharCode(65 + index)}
                    </span>
                    <span style={{ flex: 1, wordBreak: 'break-word', color: isLocked ? '#fca5a5' : 'var(--text-main)' }}>{opt}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </section>

      {duelMode === 'playing' && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 999 }}>
          {isChatOpen ? (
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} style={{ width: 'clamp(280px, 90vw, 320px)', height: 'clamp(300px, 80vh, 400px)', background: 'var(--bg-panel-solid)', border: '1px solid var(--accent-primary)', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
              
              <div style={{ background: 'var(--bg-panel)', padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
                <strong style={{ color: 'var(--accent-primary)' }}>Duel Comm Link</strong>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={toggleVoice} style={{ background: voiceStatus === 'connected' ? 'rgba(74,222,128,0.2)' : 'var(--bg-card)', color: voiceStatus === 'connected' ? '#4ade80' : 'var(--text-main)', border: `1px solid ${voiceStatus === 'connected' ? '#4ade80' : 'transparent'}`, borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>
                    {voiceStatus === 'connected' ? '🟢 Voice On' : voiceStatus === 'connecting' ? '⏳ Connecting...' : '🎤 Join Voice'}
                  </button>
                  <button onClick={() => setIsChatOpen(false)} style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 18 }}>✖</button>
                </div>
              </div>

              <div style={{ flex: 1, padding: 12, overflowY: 'auto', color: 'var(--text-muted)', fontSize: 14 }}>
                {messages.length === 0 ? (
                  <p style={{ textAlign: 'center', marginTop: '40%', color: 'var(--text-muted)' }}>No messages yet. Say hi! 👋</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {messages.map((msg: any, i) => {
                      const isMe = msg.senderId === socketRef.current?.id;
                      return (
                        <motion.div initial={{ opacity: 0, x: isMe ? 10 : -10 }} animate={{ opacity: 1, x: 0 }} key={i} style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', background: isMe ? 'var(--accent-glow)' : 'var(--bg-card)', border: isMe ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)', padding: '8px 12px', borderRadius: 8, maxWidth: '85%' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11, gap: 10 }}>
                            <strong style={{ color: isMe ? 'var(--accent-primary)' : 'var(--text-main)' }}>{isMe ? 'You' : msg.senderName}</strong>
                            <span style={{ color: 'var(--text-muted)' }}>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          
                          {msg.type === 'text' ? (
                            <div style={{ color: 'var(--text-main)', wordBreak: 'break-word' }}>{msg.message}</div>
                          ) : (
                            <img src={msg.imageUrl} alt="Shared" style={{ maxWidth: '100%', borderRadius: 6, marginTop: 4 }} />
                          )}
                        </motion.div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>
              
              <div style={{ padding: 12, borderTop: '1px solid var(--border-color)', display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg-panel)' }}>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, background: 'var(--bg-card)', borderRadius: 6, border: '1px solid var(--border-color)', fontSize: 16 }}>
                  📷<input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
                </label>
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} placeholder="Type message..." style={{ flex: 1, padding: '8px 10px', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border-color)', outline: 'none' }} />
                <button onClick={handleSendMessage} style={{ background: 'var(--accent-primary)', color: '#000', border: 'none', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' }}>↑</button>
              </div>
            </motion.div>
          ) : (
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setIsChatOpen(true)} style={{ background: 'var(--accent-primary)', color: '#000', border: 'none', borderRadius: '50%', width: 56, height: 56, cursor: 'pointer', boxShadow: '0 4px 12px var(--accent-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
            </motion.button>
          )}
        </div>
      )}
    </main>
  );
}

const page: CSSProperties = { minHeight: '100vh', padding: 'clamp(16px, 4vw, 32px)', fontFamily: 'Inter, Arial, sans-serif', color: 'var(--text-main)', background: 'var(--bg-main-gradient)', backgroundColor: 'var(--bg-main)', boxSizing: 'border-box' };
const nav: CSSProperties = { maxWidth: 1180, margin: '0 auto 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' };
const brand: CSSProperties = { color: 'var(--text-main)', textDecoration: 'none', fontWeight: 950, fontSize: 'clamp(18px, 4vw, 24px)' };
const userPill: CSSProperties = { padding: '10px 14px', borderRadius: 999, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', fontSize: 14 };
const arena: CSSProperties = { maxWidth: 1180, margin: '0 auto', padding: 'clamp(16px, 4vw, 26px)', borderRadius: 32, background: 'var(--bg-panel-solid)', border: '1px solid var(--border-color)', boxShadow: '0 30px 100px rgba(0,0,0,.1)', boxSizing: 'border-box' };
const hud: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: 16, borderRadius: 22, background: 'var(--bg-panel)' };
const online: CSSProperties = { color: '#22c55e', fontWeight: 900, fontSize: 13 };
const offline: CSSProperties = { color: '#ef4444', fontWeight: 900, fontSize: 13 };
const versusContainer: CSSProperties = { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 16, margin: '24px 0' };
const playerCard: CSSProperties = { flex: '1 1 250px', padding: 'clamp(16px, 3vw, 24px)', borderRadius: 26, background: 'var(--bg-card)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8, boxSizing: 'border-box' };
const leaderCard: CSSProperties = { ...playerCard, border: '1px solid var(--accent-primary)', background: 'var(--accent-glow)' };
const vsBadgeContainer: CSSProperties = { display: 'flex', justifyContent: 'center', flex: '0 0 auto', padding: '10px 0' };
const vsBadge: CSSProperties = { width: 64, height: 64, borderRadius: 999, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'linear-gradient(135deg,#f97316,#22d3ee)', color: '#020617', fontWeight: 950, boxShadow: '0 15px 50px rgba(0,0,0,.2)', fontSize: 20 };
const controlsContainer: CSSProperties = { marginTop: 20 };
const configCard: CSSProperties = { padding: 20, borderRadius: 20, background: 'var(--bg-panel)', border: '1px solid var(--border-color)' };
const selectInput: CSSProperties = { flex: 1, padding: 12, borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-main)', fontSize: 14, outline: 'none' };
const joinBtn: CSSProperties = { width: '100%', padding: 16, borderRadius: 18, border: 'none', background: 'linear-gradient(135deg,#f97316,#22d3ee)', color: '#020617', fontWeight: 950, cursor: 'pointer', fontSize: 18, transition: 'transform 0.1s' };
const ghostBtn: CSSProperties = { border: '1px solid var(--button-ghost-border)', background: 'var(--button-ghost-bg)', color: 'var(--text-main)', fontWeight: 900, borderRadius: 18, cursor: 'pointer', padding: 16, transition: 'background 0.2s' };
const codeInput: CSSProperties = { flex: 1, padding: '16px 20px', borderRadius: 18, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-main)', fontSize: 18, letterSpacing: 2, fontWeight: 'bold', outline: 'none' };
const backBtn: CSSProperties = { background: 'transparent', border: 'none', color: 'var(--text-muted)', fontWeight: 'bold', cursor: 'pointer', marginTop: 10, padding: 10 };
const feedbackBox: CSSProperties = { marginTop: 16, padding: 15, borderRadius: 18, background: 'var(--accent-glow)', border: '1px solid var(--accent-primary)', color: 'var(--text-main)', textAlign: 'center', fontWeight: 'bold' };
const questionCard: CSSProperties = { marginTop: 24, padding: 'clamp(16px, 4vw, 26px)', borderRadius: 28, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', boxSizing: 'border-box' };
const progress: CSSProperties = { fontWeight: 900, marginBottom: 12, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 14 };
const timer: CSSProperties = { color: '#fbbf24' };
const bar: CSSProperties = { height: 8, borderRadius: 999, background: 'var(--border-color)', overflow: 'hidden' };
const barFill: CSSProperties = { display: 'block', height: '100%', background: 'linear-gradient(135deg,#f97316,#22d3ee)' };
const optionGrid: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 14 };
const optionBtn: CSSProperties = { flex: '1 1 200px', padding: 16, borderRadius: 18, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-main)', textAlign: 'left', fontWeight: 800, cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center', boxSizing: 'border-box', transition: 'all 0.2s ease-in-out' };
const letter: CSSProperties = { flex: '0 0 32px', height: 32, borderRadius: 10, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'var(--accent-glow)', color: 'var(--accent-primary)' };
const primaryLink: CSSProperties = { display: 'inline-block', padding: '11px 20px', borderRadius: 999, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', textDecoration: 'none', fontWeight: 900, border: 'none', cursor: 'pointer' };