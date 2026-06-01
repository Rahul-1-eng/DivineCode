import { CSSProperties, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

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

  useEffect(() => {
    if (router.query.mode === 'custom') setDuelMode('custom_menu');
  }, [router.query]);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    
    socket.on('connect', () => { setConnected(true); setStatus('Connected. Ready for matchmaking.'); });
    socket.on('disconnect', () => { setConnected(false); setStatus('Disconnected from duel server.'); });
    
    socket.on('duel:waiting', (data) => setStatus(data.message || 'Waiting for opponent...'));
    
    // 👉 NEW: Custom Room Created Successfully
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
      setQuestion(state.question); 
      setFinished(state.finished); 
      setTime(20); 
      if (!state.finished && state.question) setStatus('Answer before the timer burns out.'); 
      if (state.finished) setStatus('Duel finished.'); 
    });
    
    socket.on('duel:feedback', (data) => { 
      setFeedback(`${data.playerName} answered ${data.correct ? 'correctly ✅' : 'wrong ❌'} · ${data.concept}`); 
    });
    
    return () => { socket.disconnect(); };
  }, []);

  useEffect(() => { 
    if (!question || finished) return; 
    const t = setInterval(() => setTime((v) => Math.max(0, v - 1)), 1000); 
    return () => clearInterval(t); 
  }, [question, finished]);

  function joinRandom() { 
    if (!socketRef.current || joined) return; 
    const name = session?.user?.name || session?.user?.email || `Player-${Math.floor(Math.random() * 1000)}`; 
    socketRef.current.emit('duel:join', { name }); 
    setJoined(true); 
    setDuelMode('random_waiting');
    setStatus('Searching the globe for a worthy opponent...'); 
  }

  function createCustom() {
    if (!socketRef.current || joined) return;
    const name = session?.user?.name || session?.user?.email || `Player-${Math.floor(Math.random() * 1000)}`; 
    socketRef.current.emit('duel:createCustom', { name });
    setJoined(true);
  }

  function joinCustom() {
    if (!socketRef.current || joined || !joinInputCode.trim()) return;
    const name = session?.user?.name || session?.user?.email || `Player-${Math.floor(Math.random() * 1000)}`; 
    socketRef.current.emit('duel:joinCustom', { name, roomCode: joinInputCode });
    setJoined(true);
  }

  function answer(index: number) { 
    if (!socketRef.current || !roomId || !question) return; 
    socketRef.current.emit('duel:answer', { roomId, questionId: question.id, answerIndex: index }); 
  }

  const leader = [...players].sort((a, b) => b.score - a.score)[0];

  return (
    <main style={page}>
      <nav style={nav}>
        <a href="/" style={brand}>⚔️ DivineCode Duel</a>
        <div style={userPill}>{session?.user?.name || session?.user?.email || 'Guest Player'}</div>
      </nav>
      
      <section style={arena}>
        <div style={hud}>
          <span style={connected ? online : offline}>{connected ? 'SERVER ONLINE' : 'SERVER OFFLINE'}</span>
          <strong style={{ flex: '1 1 auto', textAlign: 'center' }}>{status}</strong>
          <span style={{ fontSize: 14, color: '#94a3b8' }}>{roomId || 'Match not started'}</span>
        </div>
        
        <div style={versusContainer}>
          {players.length ? (
            <>
              <div style={players[0].id === leader?.id ? leaderCard : playerCard}>
                <span style={{ color: '#94a3b8', fontSize: 13, fontWeight: 'bold' }}>{players[0].id === leader?.id ? 'LEADING' : 'PLAYER 1'}</span>
                <strong style={{ fontSize: 'clamp(24px, 4vw, 32px)' }}>{players[0].name}</strong>
                <b style={{ fontSize: 'clamp(40px, 6vw, 52px)' }}>{players[0].score}</b>
                <small style={{ color: '#64748b' }}>battle score</small>
              </div>

              <div style={vsBadgeContainer}>
                <div style={vsBadge}>VS</div>
              </div>

              <div style={players[1]?.id === leader?.id ? leaderCard : playerCard}>
                <span style={{ color: '#94a3b8', fontSize: 13, fontWeight: 'bold' }}>{players[1]?.id === leader?.id ? 'LEADING' : 'PLAYER 2'}</span>
                <strong style={{ fontSize: 'clamp(24px, 4vw, 32px)' }}>{players[1]?.name || 'Waiting...'}</strong>
                <b style={{ fontSize: 'clamp(40px, 6vw, 52px)' }}>{players[1]?.score || 0}</b>
                <small style={{ color: '#64748b' }}>battle score</small>
              </div>
            </>
          ) : (
            <>
              <div style={playerCard}>
                <span style={{ color: '#94a3b8', fontSize: 13, fontWeight: 'bold' }}>Waiting Player 1</span>
                <strong style={{ fontSize: 'clamp(40px, 6vw, 52px)' }}>0</strong>
                <small style={{ color: '#64748b' }}>battle score</small>
              </div>

              <div style={vsBadgeContainer}>
                <div style={vsBadge}>VS</div>
              </div>

              <div style={playerCard}>
                <span style={{ color: '#94a3b8', fontSize: 13, fontWeight: 'bold' }}>Waiting Player 2</span>
                <strong style={{ fontSize: 'clamp(40px, 6vw, 52px)' }}>0</strong>
                <small style={{ color: '#64748b' }}>battle score</small>
              </div>
            </>
          )}
        </div>

        {/* 👉 DYNAMIC UI: Controls Menu */}
        <div style={controlsContainer}>
          {!joined && duelMode === 'menu' && (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', width: '100%', maxWidth: 500, margin: '0 auto' }}>
              <button onClick={joinRandom} disabled={!connected} style={{...joinBtn, flex: 1}}>🌍 Random Match</button>
              <button onClick={() => setDuelMode('custom_menu')} disabled={!connected} style={{...ghostBtn, flex: 1, padding: 16, fontSize: 18}}>🔒 Custom Match</button>
            </div>
          )}

          {!joined && duelMode === 'custom_menu' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%', maxWidth: 500, margin: '0 auto' }}>
              <button onClick={createCustom} disabled={!connected} style={joinBtn}>Create Private Room</button>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(148,163,184,.2)' }} />
                <span style={{ color: '#94a3b8', fontWeight: 'bold', fontSize: 12 }}>OR</span>
                <div style={{ flex: 1, height: 1, background: 'rgba(148,163,184,.2)' }} />
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
            <div style={{ textAlign: 'center', padding: 24, background: 'rgba(34,211,238,.08)', borderRadius: 20, border: '1px solid rgba(34,211,238,.3)' }}>
              <p style={{ margin: '0 0 10px 0', color: '#67e8f9', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 2 }}>Room Created</p>
              <p style={{ margin: 0, color: '#eef2ff' }}>Share this code with your opponent:</p>
              <h1 style={{ fontSize: 54, margin: '10px 0', letterSpacing: 6, color: '#fff' }}>{customRoomCode}</h1>
            </div>
          )}
        </div>
        
        {feedback && <div style={feedbackBox}>{feedback}</div>}
        
        {finished && (
          <section style={questionCard}>
            <h2 style={{ margin: '0 0 10px 0' }}>Duel Finished</h2>
            <p style={{ color: '#a8b3c7', marginBottom: 20 }}>Winner: <b>{leader?.name || 'No winner'}</b></p>
            <button onClick={() => window.location.reload()} style={primaryLink}>Leave Arena</button>
          </section>
        )}
        
        {!finished && question && duelMode === 'playing' && (
          <section style={questionCard}>
            <div style={progress}>
              <span>Question {question.number}/{question.total} · {question.concept}</span>
              <span style={timer}>{time}s</span>
            </div>
            <div style={bar}>
              <span style={{ ...barFill, width: `${(time / 20) * 100}%`, transition: 'width 1s linear' }} />
            </div>
            
            <h1 style={{ fontSize: 'clamp(20px, 4vw, 28px)', margin: '24px 0' }}>{question.question}</h1>
            
            <div style={optionGrid}>
              {question.options.map((opt: string, index: number) => (
                <button key={opt} onClick={() => answer(index)} style={optionBtn}>
                  <span style={letter}>{String.fromCharCode(65 + index)}</span>
                  <span style={{ flex: 1, wordBreak: 'break-word' }}>{opt}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

// STYLES
const page: CSSProperties = { minHeight: '100vh', padding: '4vw', fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(239,68,68,.22), transparent 32rem), radial-gradient(circle at top right, rgba(34,211,238,.2), transparent 30rem), #070a16', boxSizing: 'border-box' };
const nav: CSSProperties = { maxWidth: 1180, margin: '0 auto 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' };
const brand: CSSProperties = { color: '#fff', textDecoration: 'none', fontWeight: 950, fontSize: 24 };
const userPill: CSSProperties = { padding: '10px 14px', borderRadius: 999, background: 'rgba(15,23,42,.82)', border: '1px solid rgba(148,163,184,.22)', fontSize: 14 };
const arena: CSSProperties = { maxWidth: 1180, margin: '0 auto', padding: 'clamp(16px, 4vw, 26px)', borderRadius: 32, background: 'linear-gradient(180deg,rgba(15,23,42,.9),rgba(2,6,23,.72))', border: '1px solid rgba(148,163,184,.22)', boxShadow: '0 30px 100px rgba(0,0,0,.38)', boxSizing: 'border-box' };
const hud: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: 16, borderRadius: 22, background: 'rgba(2,6,23,.55)' };
const online: CSSProperties = { color: '#22c55e', fontWeight: 900, fontSize: 13 };
const offline: CSSProperties = { color: '#ef4444', fontWeight: 900, fontSize: 13 };
const versusContainer: CSSProperties = { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 16, margin: '24px 0' };
const playerCard: CSSProperties = { flex: '1 1 250px', padding: 'clamp(16px, 3vw, 24px)', borderRadius: 26, background: 'rgba(15,23,42,.85)', border: '1px solid rgba(148,163,184,.18)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8, boxSizing: 'border-box' };
const leaderCard: CSSProperties = { ...playerCard, border: '1px solid rgba(34,211,238,.8)', background: 'linear-gradient(180deg,rgba(34,211,238,.18),rgba(15,23,42,.86))' };
const vsBadgeContainer: CSSProperties = { display: 'flex', justifyContent: 'center', flex: '0 0 auto', padding: '10px 0' };
const vsBadge: CSSProperties = { width: 64, height: 64, borderRadius: 999, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'linear-gradient(135deg,#f97316,#22d3ee)', color: '#020617', fontWeight: 950, boxShadow: '0 15px 50px rgba(0,0,0,.4)', fontSize: 20 };
const controlsContainer: CSSProperties = { marginTop: 20 };
const joinBtn: CSSProperties = { width: '100%', padding: 16, borderRadius: 18, border: 0, background: 'linear-gradient(135deg,#f97316,#22d3ee)', color: '#020617', fontWeight: 950, cursor: 'pointer', fontSize: 18, transition: 'transform 0.1s' };
const ghostBtn: CSSProperties = { border: '1px solid rgba(148,163,184,.25)', background: 'rgba(2,6,23,.55)', color: '#eef2ff', fontWeight: 900, borderRadius: 18, cursor: 'pointer', padding: 16, transition: 'background 0.2s' };
const codeInput: CSSProperties = { flex: 1, padding: '16px 20px', borderRadius: 18, border: '1px solid rgba(148,163,184,.3)', background: 'rgba(2,6,23,.7)', color: '#fff', fontSize: 18, letterSpacing: 2, fontWeight: 'bold', outline: 'none' };
const backBtn: CSSProperties = { background: 'transparent', border: 0, color: '#94a3b8', fontWeight: 'bold', cursor: 'pointer', marginTop: 10, padding: 10 };
const feedbackBox: CSSProperties = { marginTop: 16, padding: 15, borderRadius: 18, background: 'rgba(34,211,238,.1)', border: '1px solid rgba(34,211,238,.24)', textAlign: 'center', fontWeight: 'bold' };
const questionCard: CSSProperties = { marginTop: 24, padding: 'clamp(16px, 4vw, 26px)', borderRadius: 28, background: 'rgba(2,6,23,.62)', border: '1px solid rgba(148,163,184,.2)', boxSizing: 'border-box' };
const progress: CSSProperties = { color: '#67e8f9', fontWeight: 900, marginBottom: 12, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 14 };
const timer: CSSProperties = { color: '#fbbf24' };
const bar: CSSProperties = { height: 8, borderRadius: 999, background: 'rgba(148,163,184,.18)', overflow: 'hidden' };
const barFill: CSSProperties = { display: 'block', height: '100%', background: 'linear-gradient(135deg,#f97316,#22d3ee)' };
const optionGrid: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 14 };
const optionBtn: CSSProperties = { flex: '1 1 200px', padding: 16, borderRadius: 18, border: '1px solid rgba(148,163,184,.24)', background: 'rgba(15,23,42,.88)', color: '#eef2ff', textAlign: 'left', fontWeight: 800, cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center', boxSizing: 'border-box' };
const letter: CSSProperties = { flex: '0 0 32px', height: 32, borderRadius: 10, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'rgba(34,211,238,.16)', color: '#67e8f9' };
const primaryLink: CSSProperties = { display: 'inline-block', padding: '11px 20px', borderRadius: 999, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', textDecoration: 'none', fontWeight: 900, border: 'none', cursor: 'pointer' };