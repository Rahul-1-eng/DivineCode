import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import toast, { Toaster } from 'react-hot-toast';
import { fetchApi } from '../lib/api';
import VoiceInterviewer from '../components/VoiceInterviewer';

export default function InterviewPage() {
  const { data: session, status } = useSession();
  
  const [profile, setProfile] = useState<any>(null);
  const [tracks, setTracks] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [pendingQs, setPendingQs] = useState<any[]>([]);
  const [progress, setProgress] = useState<Record<string, string>>({});
  
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'PRACTICE' | 'ADMIN'>('PRACTICE');
  
  // Filters
  const [selectedTrack, setSelectedTrack] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All'); 
  
  // Pagination & MCQ State
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);

  // Conversational AI State
  const [isMockMode, setIsMockMode] = useState(false);
  
  // Contribution Modal State
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [newQ, setNewQ] = useState({ trackId: '', title: '', prompt: '', opt0: '', opt1: '', opt2: '', opt3: '', correctIndex: 0, explanation: '' });

  const isPlatformOwner = profile?.role === 'ADMIN';

  useEffect(() => {
    if (status === 'loading') return;

    if (session?.user) {
      fetchApi('/api/v2/profile/me')
        .then(p => {
          if (!p.error) {
            setProfile(p);
            if (p.role === 'ADMIN') fetchPending();
          }
        }).catch(() => null);
    }

    Promise.all([
      fetchApi('/api/v2/interview/tracks', { requireAuth: false }).catch(() => []),
      fetchApi('/api/v2/interview/questions', { requireAuth: false }).catch(() => []),
      session?.user ? fetchApi('/api/v2/interview/progress').catch(() => []) : Promise.resolve([])
    ]).then(([trackData, qData, progData]) => {
      setTracks(Array.isArray(trackData) ? trackData : []);
      setQuestions(Array.isArray(qData) ? qData : []);
      
      const progMap: Record<string, string> = {};
      if (Array.isArray(progData)) {
        progData.forEach((p: any) => progMap[p.questionId] = p.status);
      }
      setProgress(progMap);

      if (Array.isArray(trackData) && trackData.length > 0) {
        setNewQ(prev => ({ ...prev, trackId: trackData[0].id }));
      }
      setLoading(false);
    }).catch(console.error);
  }, [session, status]);

  const fetchPending = () => {
    fetchApi('/api/v2/interview/pending')
      .then(d => { if (d.success) setPendingQs(d.questions); })
      .catch(() => null);
  };

  const filtered = useMemo(() => {
    let list = selectedTrack === 'All' ? questions : questions.filter(q => q.trackId === selectedTrack);
    
    if (filterStatus !== 'All') {
      list = list.filter(q => {
        const stat = progress[q.id] || 'NOT_STARTED';
        if (filterStatus === 'WEAK') return stat === 'NOT_STARTED' || stat === 'REVIEWING';
        return stat === filterStatus;
      });
    }
    return list;
  }, [questions, selectedTrack, filterStatus, progress]);

  // 👉 FIXED: Extracted 'currentIndex' to break the endless reset feedback loop
  useEffect(() => { 
    setCurrentIndex(0); 
    setSelectedOption(null); 
    setIsMockMode(false); 
  }, [selectedTrack, filterStatus]);

  const currentQ = filtered[currentIndex];

  const updateProgress = async (qId: string, progressStatus: string) => {
    setProgress(prev => ({ ...prev, [qId]: progressStatus }));
    if (!session?.user) return; 
    
    try {
      await fetchApi(`/api/v2/interview/progress/${qId}`, {
        method: 'POST',
        body: JSON.stringify({ status: progressStatus })
      });
    } catch (e) {
      console.error("Failed to update progress", e);
    }
  };

  const approveQuestion = async (qId: string) => {
    try {
      await fetchApi(`/api/v2/interview/questions/${qId}/approve`, { method: 'PATCH' });
      toast.success("Question approved and live!");
      setPendingQs(prev => prev.filter(q => q.id !== qId));
      
      const refreshedQuestions = await fetchApi('/api/v2/interview/questions', { requireAuth: false });
      setQuestions(Array.isArray(refreshedQuestions) ? refreshedQuestions : []);
    } catch (err: any) {
      toast.error(err.message || "Failed to approve");
    }
  };

  // 👉 ADDED: Delete question endpoint execution hook
  const handleDeleteQuestion = async (qId: string) => {
    if (!confirm("Completely wipe this interview question from the database? This action is absolute.")) return;
    try {
      await fetchApi(`/api/v2/interview/questions/${qId}`, { method: 'DELETE' });
      toast.success("Question removed permanently.");
      setQuestions(prev => prev.filter(q => q.id !== qId));
      setSelectedOption(null);
      if (currentIndex > 0) setCurrentIndex(c => c - 1);
    } catch (err: any) {
      toast.error(err.message || "Delete request failed.");
    }
  };

  async function submitContribution(e: React.FormEvent) {
    e.preventDefault();
    if (!session?.user) return toast.error("Must be logged in to contribute.");
    
    const payload = {
      trackId: newQ.trackId,
      title: newQ.title,
      prompt: newQ.prompt,
      options: [newQ.opt0, newQ.opt1, newQ.opt2, newQ.opt3],
      correctIndices: [Number(newQ.correctIndex)],
      expectedAnswer: newQ.explanation,
      difficulty: 'Medium',
      tags: []
    };

    try {
      await fetchApi('/api/v2/interview/questions', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      toast.success("Thanks! Your question is pending owner approval.");
      setShowSubmitModal(false);
      setNewQ(prev => ({...prev, title: '', prompt: '', opt0: '', opt1: '', opt2: '', opt3: '', explanation: ''}));
    } catch (err: any) {
      toast.error(err.message || "Failed to submit question.");
    }
  }

  const handleAiSuccess = () => {
    toast.success('AI FAANG Interviewer passed your response! Marked as Mastered.', { icon: '💼' });
    updateProgress(currentQ.id, 'MASTERED');
  };

  return (
    <main style={page}>
      <Toaster position="top-center" toastOptions={{ style: { background: 'var(--bg-panel-solid)', color: 'var(--text-main)', border: '1px solid var(--border-color)' } }} />
      
      <section style={{ maxWidth: 1000, margin: '0 auto' }}>
        <nav style={nav}>
          <a href="/" style={brand}>DivineCode Interview Arena</a>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {profile?.role === 'ADMIN' && (
              <button onClick={() => setViewMode(viewMode === 'ADMIN' ? 'PRACTICE' : 'ADMIN')} style={{...pill, background: viewMode === 'ADMIN' ? 'var(--accent-primary)' : 'var(--bg-panel-solid)', color: viewMode === 'ADMIN' ? '#000' : 'var(--text-main)', cursor: 'pointer'}}>
                🛡️ Admin ({pendingQs.length})
              </button>
            )}
            <button onClick={() => setShowSubmitModal(true)} style={ghostBtn}>+ Contribute</button>
            <a href="/duel?mode=custom" style={pill}>Host Custom Duel</a>
          </div>
        </nav>

        {viewMode === 'ADMIN' ? (
          <div style={hero}>
            <h2 style={{marginTop: 0, color: 'var(--accent-primary)'}}>Questions Pending Approval</h2>
            {pendingQs.length === 0 ? <p style={{color: 'var(--text-muted)'}}>Queue is clean! No questions pending.</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {pendingQs.map(q => (
                  <div key={q.id} style={card}>
                    <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 10}}>
                        <h3 style={{ margin: 0, color: 'var(--text-main)' }}>{q.title}</h3>
                        <span style={tag}>{q.track?.title || 'Unknown Track'}</span>
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: 16, marginBottom: 15 }}>{q.prompt}</p>
                    <div style={optionGrid}>
                      {q.options.map((opt: string, i: number) => (
                        <div key={i} style={{...option, border: q.correctIndex === i ? '1px solid #4ade80' : option.border, background: q.correctIndex === i ? 'rgba(34,197,94,.1)' : option.background }}>
                          {String.fromCharCode(65+i)}. {opt}
                        </div>
                      ))}
                    </div>
                    <div style={{marginTop: 15, padding: 15, background: 'var(--bg-panel-solid)', borderRadius: 12, border: '1px solid var(--border-color)'}}>
                        <strong style={{color: 'var(--text-muted)'}}>Expected Answer / Explanation:</strong>
                        <p style={{margin: '5px 0 0 0', color: 'var(--text-main)'}}>{q.expectedAnswer || 'None provided'}</p>
                    </div>
                    <button onClick={() => approveQuestion(q.id)} style={{...button, width: '100%', marginTop: 15}}>✅ Approve & Publish</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={hero}>
              <p style={eyebrow}>Database-Backed Rated MCQs & Mocks</p>
              <h1 style={{ fontSize: 'clamp(32px, 5vw, 58px)', margin: '10px 0', color: 'var(--text-main)' }}>Master Core CSE Topics.</h1>
              <p style={{ color: 'var(--text-muted)' }}>Focus on one question at a time. Track your mastery and drill down into your weak points.</p>
            </div>

            <div style={filters}>
              <select value={selectedTrack} onChange={(e) => setSelectedTrack(e.target.value)} style={{...input, width: 'auto', minWidth: 200, flex: '1 1 200px'}}>
                <option value="All">All Topics</option>
                {tracks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{...input, width: 'auto', minWidth: 200, flex: '1 1 200px'}}>
                <option value="All">All Progress</option>
                <option value="NOT_STARTED">Not Started</option>
                <option value="WEAK">Focus: Weak / Reviewing</option>
                <option value="MASTERED">Mastered</option>
              </select>
              <strong style={{ marginLeft: 'auto', fontSize: 16, color: 'var(--accent-primary)', background: 'var(--accent-glow)', padding: '8px 16px', borderRadius: 12, border: '1px solid var(--accent-primary)', whiteSpace: 'nowrap' }}>
                {filtered.length > 0 ? `Q ${currentIndex + 1} of ${filtered.length}` : '0 Questions'}
              </strong>
            </div>

            <div style={{ display: 'grid', gap: 16 }}>
              {loading ? (
                <div style={{...card, minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)'}}>Loading curriculum...</div>
              ) : filtered.length === 0 ? (
                <div style={{...card, textAlign: 'center', color: 'var(--text-muted)', padding: 60}}>No questions match your current filters.</div>
              ) : (
                <section style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <span style={tag}>{currentQ.track?.title || 'Core CS'}</span>
                    
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      {/* 👉 ADDED: Admin/Owner destructive capability trigger */}
                      {isPlatformOwner && (
                        <button 
                          onClick={() => handleDeleteQuestion(currentQ.id)}
                          style={{ background: 'transparent', border: '1px solid #f87171', color: '#f87171', borderRadius: 999, padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 'bold' }}
                        >
                          🗑️ Delete Question
                        </button>
                      )}
                      <button 
                        onClick={() => updateProgress(currentQ.id, 'REVIEWING')} 
                        style={{...statusBtn, background: progress[currentQ.id] === 'REVIEWING' ? 'rgba(251,191,36,.15)' : 'transparent', color: progress[currentQ.id] === 'REVIEWING' ? '#fbbf24' : 'var(--text-muted)', borderColor: progress[currentQ.id] === 'REVIEWING' ? '#fbbf24' : 'var(--border-color)'}}
                      >⚠️ Needs Review</button>
                      <button 
                        onClick={() => updateProgress(currentQ.id, 'MASTERED')} 
                        style={{...statusBtn, background: progress[currentQ.id] === 'MASTERED' ? 'rgba(34,197,94,.15)' : 'transparent', color: progress[currentQ.id] === 'MASTERED' ? '#4ade80' : 'var(--text-muted)', borderColor: progress[currentQ.id] === 'MASTERED' ? '#4ade80' : 'var(--border-color)'}}
                      >✅ Mastered</button>
                    </div>
                  </div>
                  
                  <h2 style={{ fontSize: 'clamp(20px, 4vw, 24px)', margin: '0 0 30px 0', lineHeight: 1.5, color: 'var(--text-main)' }}>{currentQ.prompt}</h2>

                  <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                    <button onClick={() => setIsMockMode(false)} style={{...pill, background: !isMockMode ? 'var(--accent-primary)' : 'var(--bg-panel-solid)', color: !isMockMode ? '#000' : 'var(--text-main)', border: `1px solid ${!isMockMode ? 'var(--accent-primary)' : 'var(--border-color)'}`}}>MCQ Drill</button>
                    <button onClick={() => setIsMockMode(true)} style={{...pill, background: isMockMode ? '#818cf8' : 'var(--bg-panel-solid)', color: isMockMode ? '#fff' : 'var(--text-main)', border: `1px solid ${isMockMode ? '#818cf8' : 'var(--border-color)'}`}}>Voice Mock 🎙️</button>
                  </div>

                  {!isMockMode ? (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {(currentQ.options || []).map((opt: string, i: number) => {
                          const isSelected = selectedOption === i;
                          const isCorrect = currentQ.correctIndex === i;
                          const reveal = selectedOption !== null;

                          let styleToUse = option;
                          if (reveal && isCorrect) styleToUse = {...option, border: '1px solid #4ade80', background: 'rgba(34,197,94,.1)'};
                          else if (reveal && isSelected && !isCorrect) styleToUse = {...option, border: '1px solid #f87171', background: 'rgba(248,113,113,.1)'};
                          else if (isSelected) styleToUse = selected;

                          return (
                            <button key={i} disabled={reveal} onClick={() => setSelectedOption(i)} style={{...styleToUse, opacity: reveal && !isCorrect && !isSelected ? 0.6 : 1}}>
                              <span style={{ fontWeight: 'bold', marginRight: 15, color: reveal && isCorrect ? '#4ade80' : 'var(--accent-primary)', fontSize: 16 }}>{String.fromCharCode(65 + i)}.</span> 
                              <span style={{ fontSize: 16 }}>{opt}</span>
                            </button>
                          );
                        })}
                      </div>
                      
                      {selectedOption !== null && (
                        <div style={{ marginTop: 24, padding: 20, borderRadius: 16, background: selectedOption === currentQ.correctIndex ? 'rgba(34,197,94,.1)' : 'rgba(248,113,113,.1)', border: `1px solid ${selectedOption === currentQ.correctIndex ? 'rgba(34,197,94,.3)' : 'rgba(248,113,113,.3)'}` }}>
                          <strong style={{ color: selectedOption === currentQ.correctIndex ? '#4ade80' : '#f87171', fontSize: 18 }}>
                            {selectedOption === currentQ.correctIndex ? '✅ Correct! Marking as Mastered.' : `❌ Incorrect. The correct answer was ${String.fromCharCode(65 + currentQ.correctIndex)}.`}
                          </strong>
                          {currentQ.expectedAnswer && (
                            <p style={{ marginTop: 12, color: 'var(--text-main)', fontSize: 15, lineHeight: 1.6 }}><b>Explanation:</b> {currentQ.expectedAnswer}</p>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <VoiceInterviewer currentQuestion={currentQ} onSuccess={handleAiSuccess} />
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 35, borderTop: '1px solid var(--border-color)', paddingTop: 25, flexWrap: 'wrap', gap: 15 }}>
                    <button 
                      disabled={currentIndex === 0} 
                      onClick={() => { if(currentIndex > 0) { setCurrentIndex(c => c - 1); setSelectedOption(null); } }} 
                      style={{...ghostBtn, padding: '12px 24px', fontSize: 16, opacity: currentIndex === 0 ? 0.3 : 1}}
                    >← Previous</button>
                    
                    <button 
                      disabled={currentIndex === filtered.length - 1} 
                      onClick={() => { 
                         if (!isMockMode && selectedOption === currentQ.correctIndex && progress[currentQ.id] !== 'REVIEWING') {
                            updateProgress(currentQ.id, 'MASTERED');
                         }
                         setCurrentIndex(c => c + 1); 
                         setSelectedOption(null); 
                      }} 
                      style={{...button, padding: '12px 24px', fontSize: 16, opacity: currentIndex === filtered.length - 1 ? 0.3 : 1}}
                    >Next Question →</button>
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </section>

      {showSubmitModal && (
        <div style={modalOverlay}>
          <div style={modalContent}>
            <h2 style={{ color: 'var(--text-main)', marginTop: 0 }}>Submit Interview Question</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 }}>Your question will be reviewed by platform owners before becoming public or available in Duels.</p>
            
            <form onSubmit={submitContribution} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <select value={newQ.trackId} onChange={e => setNewQ({...newQ, trackId: e.target.value})} style={input} required>
                {tracks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
              
              <input placeholder="Question Title (e.g. TCP Handshake)" value={newQ.title} onChange={e => setNewQ({...newQ, title: e.target.value})} style={input} required />
              <textarea placeholder="Actual Question Prompt" value={newQ.prompt} onChange={e => setNewQ({...newQ, prompt: e.target.value})} style={{...input, minHeight: 80, resize: 'vertical'}} required />
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
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

              <textarea placeholder="Explanation (Optional)" value={newQ.explanation} onChange={e => setNewQ({...newQ, explanation: e.target.value})} style={{...input, minHeight: 60, resize: 'vertical'}} />

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

const page: CSSProperties = { minHeight: '100vh', padding: 'clamp(16px, 4vw, 32px)', fontFamily: 'Inter, Arial, sans-serif', color: 'var(--text-main)', background: 'var(--bg-main-gradient)', backgroundColor: 'var(--bg-main)', boxSizing: 'border-box' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 24 };
const brand: CSSProperties = { color: 'var(--text-main)', textDecoration: 'none', fontWeight: 950, fontSize: 'clamp(18px, 4vw, 24px)' };
const pill: CSSProperties = { color: 'var(--text-main)', textDecoration: 'none', padding: '10px 16px', borderRadius: 999, border: '1px solid var(--border-color)', background: 'var(--bg-panel-solid)', fontSize: 14, fontWeight: 'bold' };
const ghostBtn: CSSProperties = { ...pill, background: 'transparent', cursor: 'pointer' };
const statusBtn: CSSProperties = { padding: '6px 12px', borderRadius: 999, border: '1px solid var(--border-color)', background: 'transparent', cursor: 'pointer', fontWeight: 'bold', fontSize: 13, transition: '0.2s' };
const hero: CSSProperties = { padding: 'clamp(20px, 4vw, 40px)', borderRadius: 30, border: '1px solid var(--border-color)', background: 'var(--bg-panel)', marginBottom: 18, boxSizing: 'border-box' };
const eyebrow: CSSProperties = { color: 'var(--accent-primary)', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase', margin: 0 };
const filters: CSSProperties = { display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', padding: 18, borderRadius: 22, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', marginBottom: 18 };
const input: CSSProperties = { padding: 12, borderRadius: 14, background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border-color)', width: '100%', boxSizing: 'border-box', outline: 'none' };
const button: CSSProperties = { padding: '11px 18px', borderRadius: 999, border: 0, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#000', fontWeight: 900, cursor: 'pointer' };
const card: CSSProperties = { padding: 'clamp(20px, 4vw, 30px)', borderRadius: 24, border: '1px solid var(--border-color)', background: 'var(--bg-panel)', boxSizing: 'border-box', boxShadow: '0 20px 40px rgba(0,0,0,0.1)' };
const tag: CSSProperties = { color: '#000', background: 'var(--accent-primary)', padding: '6px 12px', borderRadius: 999, fontWeight: 900, fontSize: 13 };
const optionGrid: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const option: CSSProperties = { padding: 18, borderRadius: 16, background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border-color)', cursor: 'pointer', textAlign: 'left', fontSize: 15, transition: 'all 0.2s' };
const selected: CSSProperties = { ...option, border: '1px solid var(--accent-primary)', background: 'var(--accent-glow)', cursor: 'default' };

const modalOverlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(2,6,23,0.8)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: 20 };
const modalContent: CSSProperties = { background: 'var(--bg-panel-solid)', padding: 'clamp(20px, 4vw, 30px)', borderRadius: 24, width: '100%', maxWidth: 500, border: '1px solid var(--border-color)', maxHeight: '90vh', overflowY: 'auto' };