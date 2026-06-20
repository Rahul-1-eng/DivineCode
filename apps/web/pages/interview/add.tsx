import { CSSProperties, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function AddQuestionPage() {
  const { data: session } = useSession();
  const [tracks, setTracks] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [trackId, setTrackId] = useState('');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correctIndex, setCorrectIndex] = useState<number>(0);
  const [expectedAnswer, setExpectedAnswer] = useState('');

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/v2/interview/tracks`)
      .then(r => r.json())
      .then(data => {
        // Handle the nested structure from our new backend route
        const trackList = data.tracks || data;
        if (Array.isArray(trackList)) {
          setTracks(trackList);
          if (trackList.length > 0) setTrackId(trackList[0].id);
        }
      })
      .catch(console.error);
  }, []);

  function handleOptionChange(index: number, value: string) {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session?.user?.email) return alert('You must be signed in.');

    setIsSubmitting(true);
    try {
      // 👉 FIX: Pointing to the correct /questions endpoint
      const res = await fetch(`${API_BASE_URL}/api/v2/interview/questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': session.user.email
        },
        body: JSON.stringify({
          trackId,
          title,
          prompt,
          options,
          // 👉 FIX: The backend expects an array called correctIndices
          correctIndices: [correctIndex], 
          difficulty: 'Medium', // Defaulting to medium for user submissions
          tags: [],
          sourceCompany: ''
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit question');
      
      alert(data.message);
      
      // Clear form on success
      setTitle('');
      setPrompt('');
      setOptions(['', '', '', '']);
      setExpectedAnswer('');
      setCorrectIndex(0);

    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main style={page}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <a href="/duel" style={topLink}>← Back to Arena</a>
        
        <h1 style={{ fontSize: 32, margin: '20px 0 10px 0' }}>Add Interview Question</h1>
        <p style={{ color: '#a8b3c7', marginBottom: 30 }}>Construct a new MCQ for the Duel and Mashup databases.</p>

        <form onSubmit={handleSubmit} style={formCard}>
          <div style={formGroup}>
            <label style={label}>Interview Track</label>
            <select value={trackId} onChange={e => setTrackId(e.target.value)} style={inputStyle} required>
              {tracks.map(t => (
                <option key={t.id} value={t.id}>{t.title} ({t.type})</option>
              ))}
            </select>
          </div>

          <div style={formGroup}>
            <label style={label}>Question Title (Short)</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. TCP Handshake Flags" style={inputStyle} required />
          </div>

          <div style={formGroup}>
            <label style={label}>Question Prompt</label>
            <textarea 
              value={prompt} 
              onChange={e => setPrompt(e.target.value)} 
              placeholder="What is the time complexity of..." 
              style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }} 
              required 
            />
          </div>

          <div style={formGroup}>
            <label style={label}>Multiple Choice Options</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {options.map((opt, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(2,6,23,.5)', padding: 12, borderRadius: 12, border: '1px solid rgba(148,163,184,.15)' }}>
                  <input 
                    type="radio" 
                    name="correctAnswer" 
                    checked={correctIndex === idx} 
                    onChange={() => setCorrectIndex(idx)} 
                    style={{ width: 20, height: 20, cursor: 'pointer' }}
                  />
                  <input 
                    value={opt} 
                    onChange={e => handleOptionChange(idx, e.target.value)} 
                    placeholder={`Option ${String.fromCharCode(65 + idx)}`} 
                    style={{ ...inputStyle, margin: 0, flex: 1 }} 
                    required 
                  />
                  {correctIndex === idx && <span style={{ color: '#22c55e', fontWeight: 'bold', fontSize: 14 }}>CORRECT</span>}
                </div>
              ))}
            </div>
          </div>

          <div style={formGroup}>
            <label style={label}>Detailed Explanation (Optional)</label>
            <textarea 
              value={expectedAnswer} 
              onChange={e => setExpectedAnswer(e.target.value)} 
              placeholder="Explain why the answer is correct for post-duel review..." 
              style={{ ...inputStyle, minHeight: 80 }} 
            />
          </div>

          <div style={{ marginTop: 30, borderTop: '1px solid rgba(148,163,184,.2)', paddingTop: 24, textAlign: 'right' }}>
            <button type="submit" disabled={isSubmitting} style={primaryBtn}>
              {isSubmitting ? 'Submitting...' : 'Submit to Database'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

// STYLES
const page: CSSProperties = { minHeight: '100vh', padding: '4vw', fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.2), transparent 36rem), #070a16', boxSizing: 'border-box' };
const topLink: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 900 };
const formCard: CSSProperties = { padding: 'clamp(20px, 4vw, 40px)', borderRadius: 24, background: 'rgba(15,23,42,.85)', border: '1px solid rgba(148,163,184,.22)', boxSizing: 'border-box' };
const formGroup: CSSProperties = { marginBottom: 24 };
const label: CSSProperties = { display: 'block', fontWeight: 'bold', color: '#94a3b8', marginBottom: 8, fontSize: 14, textTransform: 'uppercase', letterSpacing: 1 };
const inputStyle: CSSProperties = { width: '100%', padding: 16, borderRadius: 14, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(2,6,23,.55)', color: '#fff', fontSize: 16, outline: 'none', boxSizing: 'border-box' };
const primaryBtn: CSSProperties = { padding: '16px 32px', borderRadius: 999, border: 0, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontWeight: 900, cursor: 'pointer', fontSize: 16 };