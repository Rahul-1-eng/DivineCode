import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import toast, { Toaster } from 'react-hot-toast';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

function shuffle<T>(items: T[]) { return [...items].sort(() => Math.random() - 0.5); }

export default function InterviewPage() {
  const { data: session } = useSession();
  const [tracks, setTracks] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedTrack, setSelectedTrack] = useState('All');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [attempt, setAttempt] = useState(1);
  const [seed, setSeed] = useState(Date.now());
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  const [newQ, setNewQ] = useState({ trackId: '', title: '', prompt: '', opt0: '', opt1: '', opt2: '', opt3: '', correctIndex: 0, explanation: '' });

  useEffect(() => {
    const headers = { 'x-user-email': session?.user?.email || '' };

    Promise.all([
      fetch(`${API_BASE_URL}/api/v2/interview/tracks`, { headers }).then(r => r.json()),
      fetch(`${API_BASE_URL}/api/v2/interview/questions`, { headers }).then(r => r.json())
    ]).then(([trackData, qData]) => {
      setTracks(Array.isArray(trackData) ? trackData : []);
      setQuestions(Array.isArray(qData) ? qData : []);
      if (Array.isArray(trackData) && trackData.length > 0) {
        setNewQ(prev => ({ ...prev, trackId: trackData[0].id }));
      }
      setLoading(false);
    }).catch(console.error);
  }, [session]);

  const filtered = useMemo(() => {
    let list = selectedTrack === 'All' ? questions : questions.filter(q => q.trackId === selectedTrack);
    return shuffle(list);
  }, [questions, selectedTrack, seed]);

  const score = filtered.filter((q) => answers[q.id] === q.correctIndex).length;

  function newAttempt() { setAttempt((v) => v + 1); setAnswers({}); setSeed(Date.now()); }
  function answer(qid: string, index: number) { 
    setAnswers({ ...answers, [qid]: index }); 
    setTimeout(() => setSeed(Date.now()), 600); 
  }

  async function submitContribution(e: React.FormEvent) {
    e.preventDefault();
    if (!session?.user?.email) return toast.error("Must be logged in to contribute.");
    
    const payload = {
      trackId: newQ.trackId,
      title: newQ.title,
      prompt: newQ.prompt,
      options: [newQ.opt0, newQ.opt1, newQ.opt2, newQ.opt3],
      correctIndex: Number(newQ.correctIndex),
      expectedAnswer: newQ.explanation
    };

    const res = await fetch(`${API_BASE_URL}/api/v2/interview/submit-question`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-email': session.user.email },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      toast.success("Thanks! Your question is pending owner approval.");
      setShowSubmitModal(false);
      setNewQ(prev => ({...prev, title: '', prompt: '', opt0: '', opt1: '', opt2: '', opt3: '', explanation: ''}));
    } else {
      toast.error("Failed to submit question.");
    }
  }

  return (
    <main style={page}>
      <Toaster position="top-center" toastOptions={{ style: { background: '#1e293b', color: '#fff', border: '1px solid #475569' } }} />
      
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: .4; }
        }
        .skeleton-pulse {
          animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}</style>

      <section style={{ maxWidth: 1160, margin: '0 auto' }}>
        <nav style={nav}>
          <a href="/" style={brand}>DivineCode Interview Arena</a>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={() => setShowSubmitModal(true)} style={ghostBtn}>+ Contribute Question</button>
            <a href="/duel?mode=custom" style={pill}>Host Custom Duel</a>
            <a href="/contests/create" style={pill}>Create Mashup</a>
          </div>
        </nav>

        <div style={hero}>
          <p style={eyebrow}>Database-Backed Rated MCQs</p>
          <h1 style={{ fontSize: 'clamp(32px, 5vw, 58px)', margin: '10px 0' }}>Master Core CSE Topics.</h1>
          <p style={{ color: '#a8b3c7' }}>Questions are drawn from the live database. Build custom duels using these tracks, or add specific MCQs to your Mashup contests.</p>
        </div>

        <div style={filters}>
          <select value={selectedTrack} onChange={(e) => { setSelectedTrack(e.target.value); setAnswers({}); setSeed(Date.now()); }} style={input}>
            <option value="All">All Topics</option>
            {tracks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <strong style={{ marginLeft: 'auto' }}>Attempt {attempt}</strong>
          <span style={{ padding: '8px 16px', background: 'rgba(34,211,238,.1)', color: '#67e8f9', borderRadius: 12, fontWeight: 'bold' }}>
            Score {score}/{filtered.length}
          </span>
          <button onClick={newAttempt} style={button}>New Shuffle</button>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          {loading ? (
            <>
              {[1, 2, 3].map((i) => (
                <section key={i} className="skeleton-pulse" style={{...card, minHeight: 200}}>
                  <div style={{ height: 24, width: '60%', background: 'rgba(255,255,255,0.05)', borderRadius: 8, marginBottom: 20 }} />
                  <div style={optionGrid}>
                    <div style={{ height: 50, background: 'rgba(255,255,255,0.03)', borderRadius: 12 }} />
                    <div style={{ height: 50, background: 'rgba(255,255,255,0.03)', borderRadius: 12 }} />
                    <div style={{ height: 50, background: 'rgba(255,255,255,0.03)', borderRadius: 12 }} />
                    <div style={{ height: 50, background: 'rgba(255,255,255,0.03)', borderRadius: 12 }} />
                  </div>
                </section>
              ))}
            </>
          ) : filtered.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>No approved questions in this track yet.</p>
          ) : (
            filtered.map((q) => {
              const opts = q.options || [];
              const isAnswered = answers[q.id] !== undefined;
              const isCorrect = answers[q.id] === q.correctIndex;

              return (
                <section key={`${attempt}-${q.id}`} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={tag}>{q.track?.title || 'General'}</span>
                    <span style={rating}>{q.difficultyLabel || q.difficulty || 'Medium'}</span>
                  </div>
                  
                  <h2 style={{ fontSize: 20, margin: '0 0 16px 0', lineHeight: 1.5 }}>{q.prompt}</h2>
                  
                  <div style={optionGrid}>
                    {opts.map((opt: string, i: number) => (
                      <button 
                        key={i} 
                        disabled={isAnswered}
                        onClick={() => answer(q.id, i)} 
                        style={answers[q.id] === i ? selected : option}
                      >
                        <span style={{ fontWeight: 'bold', marginRight: 8, color: '#67e8f9' }}>{String.fromCharCode(65 + i)}.</span> {opt}
                      </button>
                    ))}
                  </div>

                  {isAnswered && (
                    <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: isCorrect ? 'rgba(34,197,94,.1)' : 'rgba(248,113,113,.1)', border: `1px solid ${isCorrect ? 'rgba(34,197,94,.3)' : 'rgba(248,113,113,.3)'}` }}>
                      <strong style={{ color: isCorrect ? '#4ade80' : '#f87171' }}>
                        {isCorrect ? '✅ Correct!' : `❌ Incorrect. The correct answer was ${String.fromCharCode(65 + q.correctIndex)}.`}
                      </strong>
                      {q.expectedAnswer && (
                        <p style={{ marginTop: 8, color: '#eef2ff', fontSize: 14 }}><b>Explanation:</b> {q.expectedAnswer}</p>
                      )}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>
      </section>

      {showSubmitModal && (
        <div style={modalOverlay}>
          <div style={modalContent}>
            <h2>Submit Interview Question</h2>
            <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 20 }}>Your question will be reviewed by platform owners before becoming public or available in Duels.</p>
            
            <form onSubmit={submitContribution} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <select value={newQ.trackId} onChange={e => setNewQ({...newQ, trackId: e.target.value})} style={input} required>
                {tracks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
              
              <input placeholder="Question Title (e.g. TCP Handshake)" value={newQ.title} onChange={e => setNewQ({...newQ, title: e.target.value})} style={input} required />
              <textarea placeholder="Actual Question Prompt" value={newQ.prompt} onChange={e => setNewQ({...newQ, prompt: e.target.value})} style={{...input, minHeight: 80}} required />
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input placeholder="Option A" value={newQ.opt0} onChange={e => setNewQ({...newQ, opt0: e.target.value})} style={input} required />
                <input placeholder="Option B" value={newQ.opt1} onChange={e => setNewQ({...newQ, opt1: e.target.value})} style={input} required />
                <input placeholder="Option C" value={newQ.opt2} onChange={e => setNewQ({...newQ, opt2: e.target.value})} style={input} required />
                <input placeholder="Option D" value={newQ.opt3} onChange={e => setNewQ({...newQ, opt3: e.target.value})} style={input} required />
              </div>

              <select value={newQ.correctIndex} onChange={e => setNewQ({...newQ, correctIndex: Number(e.target.value)})} style={input}>
                <option value={0}>Option A is Correct</option>
                <option value={1}>Option B is Correct</option>
                <option value={2}>Option C is Correct</option>
                <option value={3}>Option D is Correct</option>
              </select>

              <textarea placeholder="Explanation (Optional)" value={newQ.explanation} onChange={e => setNewQ({...newQ, explanation: e.target.value})} style={{...input, minHeight: 60}} />

              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button type="button" onClick={() => setShowSubmitModal(false)} style={{...ghostBtn, flex: 1}}>Cancel</button>
                <button type="submit" style={{...button, flex: 1}}>Submit for Review</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

const page: CSSProperties = { minHeight: '100vh', padding: '4vw', fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(34,211,238,.2), transparent 34rem), #070a16', boxSizing: 'border-box' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 24 };
const brand: CSSProperties = { color: '#eef2ff', textDecoration: 'none', fontWeight: 950, fontSize: 'clamp(18px, 4vw, 24px)' };
const pill: CSSProperties = { color: '#dbeafe', textDecoration: 'none', padding: '10px 16px', borderRadius: 999, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(15,23,42,.72)', fontSize: 14, fontWeight: 'bold' };
const ghostBtn: CSSProperties = { ...pill, background: 'transparent', cursor: 'pointer' };
const hero: CSSProperties = { padding: 'clamp(20px, 4vw, 30px)', borderRadius: 30, border: '1px solid rgba(148,163,184,.22)', background: 'rgba(15,23,42,.82)', marginBottom: 18, boxSizing: 'border-box' };
const eyebrow: CSSProperties = { color: '#67e8f9', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase', margin: 0 };
const filters: CSSProperties = { display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', padding: 18, borderRadius: 22, background: 'rgba(15,23,42,.82)', marginBottom: 18 };
const input: CSSProperties = { padding: 12, borderRadius: 14, background: 'rgba(2,6,23,.55)', color: '#eef2ff', border: '1px solid rgba(148,163,184,.25)', width: '100%', boxSizing: 'border-box' };
const button: CSSProperties = { padding: '11px 18px', borderRadius: 999, border: 0, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontWeight: 900, cursor: 'pointer' };
const card: CSSProperties = { padding: 'clamp(16px, 4vw, 24px)', borderRadius: 24, border: '1px solid rgba(148,163,184,.2)', background: 'rgba(15,23,42,.82)', boxSizing: 'border-box' };
const tag: CSSProperties = { color: '#020617', background: '#67e8f9', padding: '6px 12px', borderRadius: 999, fontWeight: 900, fontSize: 13 };
const rating: CSSProperties = { color: '#fbbf24', fontWeight: 900, fontSize: 14, background: 'rgba(251,191,36,.1)', padding: '6px 12px', borderRadius: 999 };
const optionGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 12 };
const option: CSSProperties = { padding: 16, borderRadius: 16, background: 'rgba(2,6,23,.55)', color: '#eef2ff', border: '1px solid rgba(148,163,184,.24)', cursor: 'pointer', textAlign: 'left', fontSize: 15, transition: 'all 0.2s' };
const selected: CSSProperties = { ...option, border: '1px solid rgba(34,211,238,.8)', background: 'rgba(34,211,238,.12)', cursor: 'default' };

const modalOverlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(2,6,23,0.8)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: 20 };
const modalContent: CSSProperties = { background: '#0f172a', padding: 30, borderRadius: 24, width: '100%', maxWidth: 500, border: '1px solid rgba(148,163,184,.2)', maxHeight: '90vh', overflowY: 'auto' };