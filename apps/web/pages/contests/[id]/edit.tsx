import { CSSProperties, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import toast, { Toaster } from 'react-hot-toast';

export async function getServerSideProps() { return { props: {} }; }

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

function viewerQuery(session: any) {
  const query = new URLSearchParams();
  if (session?.user?.email) query.set('viewerEmail', session.user.email);
  if (session?.user?.name) query.set('viewerName', session.user.name);
  const value = query.toString();
  return value ? `?${value}` : '';
}

function viewerHeaders(session: any) {
  return { 
    'Content-Type': 'application/json', 
    'x-user-email': session?.user?.email || '', 
    'x-user-name': session?.user?.name || '' 
  };
}

export default function ContestEditPage() {
  const router = useRouter();
  const { id } = router.query;
  const { data: session, status } = useSession();
  const [contest, setContest] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [startTimeStr, setStartTimeStr] = useState('');
  
  const [newProblemCode, setNewProblemCode] = useState('');
  const [newProblemPlatform, setNewProblemPlatform] = useState('Codeforces');
  const [newProblemUrl, setNewProblemUrl] = useState(''); 
  const [urlGenerateAiTests, setUrlGenerateAiTests] = useState(true);
  
  const [customTitle, setCustomTitle] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customTimeLimit, setCustomTimeLimit] = useState<number>(0);
  const [customGenerateAiTests, setCustomGenerateAiTests] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function loadContest() {
    if (!id || status === 'loading') return;
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}${viewerQuery(session)}`);
   let data;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const errorText = await res.text();
        console.error("Server Error:", errorText);
        return toast.error(`Server Error (${res.status}): Please check backend logs.`);
      }
    if (!res.ok) { setError(data.error || 'Contest not found'); return; }
    setContest(data);
    setTitle(data.title || '');
    setDescription(data.description || '');
    setDurationMinutes(data.durationMinutes || 120);
    
    if (data.startTime) {
      const dt = new Date(data.startTime);
      dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
      setStartTimeStr(dt.toISOString().slice(0, 16));
    }
  }

  useEffect(() => { loadContest(); }, [id, status, session?.user?.email, session?.user?.name]);

  async function saveSettings() {
    if (!id || !session) return;
    setSaving(true);
    const bodyPayload: any = { title, description, durationMinutes };
    if (startTimeStr) bodyPayload.startTime = new Date(startTimeStr).toISOString();
    
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}`, { 
      method: 'PUT', 
      headers: viewerHeaders(session), 
      body: JSON.stringify(bodyPayload) 
    });
   let data;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const errorText = await res.text();
        console.error("Server Error:", errorText);
        return toast.error(`Server Error (${res.status}): Please check backend logs.`);
      }
    setSaving(false);
    if (!res.ok) return toast.error(data.error || 'Could not save contest');
    setContest(data);
    toast.success('Settings saved successfully!');
  }

  async function lookupProblem(platform: string, code: string) {
    const res = await fetch(`${API_BASE_URL}/api/problems/lookup?platform=${encodeURIComponent(platform)}&code=${encodeURIComponent(code)}`);
   let data;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const errorText = await res.text();
        console.error("Server Error:", errorText);
        return toast.error(`Server Error (${res.status}): Please check backend logs.`);
      }
    if (!res.ok) throw new Error(data.error || 'Lookup failed');
    return data;
  }

  async function addProblem() {
    if (!id || !session || !newProblemCode.trim()) return toast.error('Enter a problem code.');
    try {
      const cleanCode = newProblemCode.replace(/\s+/g, '').toUpperCase();
      const p = await lookupProblem(newProblemPlatform, cleanCode);
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems`, { 
        method: 'POST', 
        headers: viewerHeaders(session), 
        body: JSON.stringify(p) 
      });
      
      const contentType = res.headers.get("content-type");
      let data;
      if (contentType && contentType.indexOf("application/json") !== -1) {
        data = await res.json();
      } else {
        const errorText = await res.text();
        return toast.error(`Server Error (${res.status}): ${errorText.slice(0, 50)}...`);
      }

      if (!res.ok) return toast.error(data.error || 'Could not add problem');
      setContest(data);
      setNewProblemCode('');
      toast.success('Problem added!');
    } catch (e: any) { toast.error(e.message || 'Could not add problem'); }
  }

  async function addProblemFromUrl() {
    if (!id || !session || !newProblemUrl.trim()) return toast.error('Enter a problem URL.');
    
    let finalUrl = newProblemUrl.trim();
    if (!finalUrl.startsWith('http') && /^\d+\s*[a-zA-Z][0-9]?$/.test(finalUrl)) {
       const clean = finalUrl.replace(/\s+/g, '').toUpperCase();
       const num = clean.match(/^\d+/)?.[0];
       const letter = clean.match(/[A-Z0-9]+$/)?.[0];
       finalUrl = `https://codeforces.com/problemset/problem/${num}/${letter}`;
    } else if (!finalUrl.startsWith('http')) {
       return toast.error('Enter a valid URL or Codeforces code');
    }

    try {
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems/mashup`, { 
        method: 'POST', 
        headers: viewerHeaders(session), 
        body: JSON.stringify({ type: 'URL', url: finalUrl, generateAiTests: urlGenerateAiTests }) 
      });

     let data;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const errorText = await res.text();
        console.error("Backend Error Response:", errorText);
        return toast.error(`Server Error (${res.status}): Please check backend console.`);
      }
      if (!res.ok) return toast.error(data.error || 'Could not scrape problem. Check URL.');
      setContest(data);
      setNewProblemUrl('');
      toast.success('Problem scraped and added!');
    } catch (e: any) { toast.error(e.message || 'Scrape failed'); }
  }

  const addCustomProblem = async () => {
    if (!id || !session || !customTitle.trim()) return toast.error('Enter a title for your custom problem.');
    try {
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems/mashup`, {
        method: 'POST',
        headers: viewerHeaders(session),
        body: JSON.stringify({
          type: 'CUSTOM',
          customData: {
            title: customTitle,
            description: customDescription,
            time: customTimeLimit,
            generateAiTests: customGenerateAiTests,
            testcases: [] 
          }
        })
      });

     let data;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const errorText = await res.text();
        console.error("Server Error:", errorText);
        return toast.error(`Server Error (${res.status}): Please check backend logs.`);
      }

      if (!res.ok) return toast.error(data.error || 'Could not add custom problem');
      
      setCustomTitle('');
      setCustomDescription('');
      setCustomTimeLimit(0);
      toast.success('Custom problem added successfully!');
      loadContest(); 
    } catch (e: any) { toast.error(e.message || 'Custom add failed'); }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('image', file);

    setUploadingImage(true);
    try {
      const res = await fetch(`${API_V2_BASE_URL}/upload-image`, {
        method: 'POST',
        body: formData 
      });
     let data;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const errorText = await res.text();
        console.error("Server Error:", errorText);
        return toast.error(`Server Error (${res.status}): Please check backend logs.`);
      }
      if (data.success) {
        setCustomDescription(prev => prev + `\n<br /><img src="${API_BASE_URL}${data.url}" alt="Problem Image" style="max-width: 100%; border-radius: 8px;" />\n<br />`);
        toast.success("Image uploaded & appended to description!");
      } else {
        toast.error("Image upload failed.");
      }
    } catch (err) {
      toast.error("Image upload failed.");
    } finally {
      setUploadingImage(false);
      e.target.value = ''; 
    }
  };

  async function replaceProblem(problemId: string) {
    const code = prompt('Enter new problem code (e.g. 1500A):');
    if (!code) return;
    try {
      const cleanCode = code.replace(/\s+/g, '').toUpperCase();
      const p = await lookupProblem(newProblemPlatform, cleanCode);
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems/${problemId}`, {
        method: 'PUT',
        headers: viewerHeaders(session),
        body: JSON.stringify(p)
      });
     let data;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const errorText = await res.text();
        console.error("Server Error:", errorText);
        return toast.error(`Server Error (${res.status}): Please check backend logs.`);
      }
      if (!res.ok) return toast.error(data.error || 'Could not replace problem');
      setContest(data);
      toast.success('Problem replaced successfully!');
    } catch (e: any) { toast.error(e.message || 'Could not replace problem'); }
  }

  async function removeProblem(problemId: string) {
    if (!confirm('Are you sure you want to remove this problem?')) return;
    try {
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems/${problemId}`, {
        method: 'DELETE',
        headers: viewerHeaders(session)
      });
     let data;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const errorText = await res.text();
        console.error("Server Error:", errorText);
        return toast.error(`Server Error (${res.status}): Please check backend logs.`);
      }
      if (!res.ok) return toast.error(data.error || 'Could not remove problem');
      setContest(data);
      toast.success('Problem removed!');
    } catch (e: any) { toast.error(e.message || 'Could not remove problem'); }
  }

  async function moveProblem(problemId: string, direction: 'UP' | 'DOWN') {
    try {
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems/${problemId}/reorder`, {
        method: 'PUT',
        headers: viewerHeaders(session),
        body: JSON.stringify({ direction })
      });
     let data;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const errorText = await res.text();
        console.error("Server Error:", errorText);
        return toast.error(`Server Error (${res.status}): Please check backend logs.`);
      }
      if (!res.ok) return toast.error(data.error || 'Could not reorder problem');
      setContest(data);
      toast.success('Reordered successfully!');
    } catch (e: any) {
      toast.error('Network error during reordering');
    }
  }

  async function deleteContest() {
    if (!confirm('Are you sure you want to completely delete this contest?')) return;
    try {
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}`, {
        method: 'DELETE',
        headers: viewerHeaders(session)
      });
      if (res.ok) router.push('/contests');
      else {
       let data;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const errorText = await res.text();
        console.error("Server Error:", errorText);
        return toast.error(`Server Error (${res.status}): Please check backend logs.`);
      }
        toast.error(data.error || 'Could not delete contest');
      }
    } catch (e: any) { toast.error(e.message || 'Could not delete contest'); }
  }

  if (status === 'loading') return <main style={page}>Checking account...</main>;
  if (!session) return <main style={page}><section style={panel}><h1>Sign in required</h1><a href="/signin" style={primary}>Sign in</a></section></main>;
  if (error) return <main style={page}><section style={panel}><h1>{error}</h1><a href="/contests" style={link}>Back to contests</a></section></main>;
  if (!contest) return <main style={page}>Loading editor...</main>;
  if (!contest.canManage) return <main style={page}><section style={panel}><h1>Owner only</h1><p style={{ color: '#94a3b8' }}>Only the contest creator can open the editing page.</p><a href={`/contests/${id}`} style={primary}>Back to contest</a></section></main>;

  return (
    <main style={page}>
      <Toaster position="top-center" toastOptions={{ style: { background: '#1e293b', color: '#fff', border: '1px solid #475569' } }} />
      <section style={{ maxWidth: 1120, margin: '0 auto' }}>
        <nav style={nav}>
          <a href={`/contests/${id}`} style={link}>← Back to live room</a>
          <button onClick={deleteContest} style={danger}>Delete mashup</button>
        </nav>
        
        <div style={hero}>
          <p style={eyebrow}>Owner editing page</p>
          <h1 style={{ margin: 0, fontSize: 44 }}>{contest.title}</h1>
        </div>

        <section style={panel}>
          <h2>Contest settings</h2>
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={input} />
          
          <label>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...input, minHeight: 90 }} />
          
          <label>Duration minutes</label>
          <input type="number" value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} style={{ ...input, maxWidth: 180 }} />
          
          <label style={{display: 'block', marginTop: 10}}>Scheduled Start Time</label>
          <input type="datetime-local" value={startTimeStr} onChange={(e) => setStartTimeStr(e.target.value)} style={{ ...input, maxWidth: 220 }} />
          
          <button onClick={saveSettings} disabled={saving} style={primary}>{saving ? 'Saving...' : 'Save settings'}</button>
        </section>

        <section style={panel}>
          <h2>Add problem</h2>
          
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 5, color: '#94a3b8' }}>Option 1: Add by Platform & Code</label>
            <div style={inline}>
              <select value={newProblemPlatform} onChange={(e) => setNewProblemPlatform(e.target.value)} style={{...input, width: 'auto', marginBottom: 0}}>
                <option>Codeforces</option><option>LeetCode</option><option>AtCoder</option><option>CodeChef</option>
              </select>
              <input value={newProblemCode} onChange={(e) => setNewProblemCode(e.target.value)} placeholder="1805A" style={{...input, flex: 1, marginBottom: 0}} />
              <button onClick={addProblem} style={primary}>Add</button>
            </div>
          </div>

          <div style={{ borderTop: '1px solid #1e293b', paddingTop: 20, marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 5, color: '#94a3b8' }}>Option 2: Smart Scrape via URL (Extracts Code & Test Cases)</label>
            <div style={{ display: 'flex', gap: 12 }}>
              <input value={newProblemUrl} onChange={(e) => setNewProblemUrl(e.target.value)} placeholder="https://codeforces.com/problemset/problem/..." style={{ ...input, flex: 1, margin: 0 }} />
              <button onClick={addProblemFromUrl} style={primary}>Scrape & Add</button>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#94a3b8', marginTop: 10 }}>
               <input type="checkbox" checked={urlGenerateAiTests} onChange={e => setUrlGenerateAiTests(e.target.checked)} />
               🤖 Check scraped tests AND automatically generate tougher hidden system tests via AI
            </label>
          </div>

          <div style={{ borderTop: '1px solid #1e293b', paddingTop: 20 }}>
            <label style={{ display: 'block', marginBottom: 5, color: '#94a3b8' }}>Option 3: Create Custom Problem</label>
            <input value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} placeholder="Custom Problem Title" style={input} />
            
            <div style={{ background: '#020617', padding: 10, borderRadius: '12px 12px 0 0', border: '1px solid #334155', borderBottom: 'none', display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>Insert Image:</span>
              <input 
                type="file" 
                accept="image/*" 
                onChange={handleImageUpload} 
                style={{ fontSize: 13, color: '#e2e8f0', width: 220 }} 
                disabled={uploadingImage}
              />
              {uploadingImage && <span style={{ color: '#38bdf8', fontSize: 12 }}>Uploading...</span>}
            </div>
            <textarea 
              value={customDescription} 
              onChange={(e) => setCustomDescription(e.target.value)} 
              placeholder="Write your HTML/Text description here. Use the image uploader above to automatically inject images." 
              style={{ ...input, minHeight: 140, borderRadius: '0 0 12px 12px' }} 
            />
            
            <div>
               <label style={{ fontSize: 13, color: '#94a3b8', fontWeight: 'bold' }}>Time Limit (Seconds, 0 for infinite)</label>
               <input type="number" placeholder="e.g. 120" value={customTimeLimit} onChange={e => setCustomTimeLimit(Number(e.target.value))} style={input} />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#94a3b8', marginTop: 5, marginBottom: 15 }}>
               <input type="checkbox" checked={customGenerateAiTests} onChange={e => setCustomGenerateAiTests(e.target.checked)} />
               🤖 Automatically generate tougher hidden system tests for this problem via AI
            </label>

            <button onClick={addCustomProblem} style={primary}>Create Custom Problem</button>
          </div>

        </section>

        <section style={panel}>
          <h2>Problems</h2>
          {contest.problems.map((problem: any, index: number) => (
            <div key={problem.id} style={row}>
              <strong style={{ fontSize: 24, color: '#e2e8f0', minWidth: 30 }}>{String.fromCharCode(65 + index)}</strong>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginRight: 15 }}>
                 <button onClick={() => moveProblem(problem.id, 'UP')} disabled={index === 0} style={{...ghost, padding: '2px 6px', fontSize: 10}}>▲</button>
                 <button onClick={() => moveProblem(problem.id, 'DOWN')} disabled={index === contest.problems.length - 1} style={{...ghost, padding: '2px 6px', fontSize: 10}}>▼</button>
              </div>

              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 18 }}>{problem.titleSnapshot || problem.title}</b>
                <p style={{ margin: '4px 0 0', color: '#94a3b8' }}>{problem.platform} - Rating {problem.rating || problem.difficulty || 'Practice'}</p>
              </div>
              <button onClick={() => replaceProblem(problem.id)} style={ghost}>Replace</button>
              <button onClick={() => removeProblem(problem.id)} style={danger}>Remove</button>
            </div>
          ))}
          {contest.problems.length === 0 && <p style={{ color: '#64748b' }}>No problems added yet.</p>}
        </section>

        <section style={panel}>
          <h2>Players</h2>
          <div style={{...playerRow, fontWeight: 'bold', color: '#fff', borderBottom: '2px solid #1e293b'}}>
            <span>Name</span><span>Team</span><span>Handle</span>
          </div>
          {contest.members?.map((member: any) => (
            <div key={member.id} style={playerRow}>
              <span>{member.name || member.displayName}</span>
              <span>{member.teamName || member.team?.name || 'Individuals'}</span>
              <span>{member.codeforcesHandle || member.externalHandle?.handle || 'missing handle'}</span>
            </div>
          ))}
          {(!contest.members || contest.members.length === 0) && <p style={{ color: '#64748b', marginTop: 15 }}>No players registered yet.</p>}
        </section>
      </section>
    </main>
  );
}

// Styles
const page: CSSProperties = { minHeight: '100vh', width: '100%', maxWidth: '100vw', overflowX: 'hidden', padding: 'clamp(16px, 4vw, 32px)', fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.15), transparent 34rem), #070a16', boxSizing: 'border-box' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 };
const link: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 900, fontSize: 16 };
const danger: CSSProperties = { background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#f87171', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' };
const primary: CSSProperties = { display: 'inline-block', padding: '12px 24px', borderRadius: 8, background: 'linear-gradient(135deg,#38bdf8,#818cf8)', color: '#020617', textDecoration: 'none', fontWeight: 900, border: 'none', textAlign: 'center', cursor: 'pointer' };
const ghost: CSSProperties = { background: 'transparent', color: '#cbd5e1', border: '1px solid #334155', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' };
const hero: CSSProperties = { padding: 'clamp(20px, 4vw, 30px)', borderRadius: 24, background: 'rgba(15,23,42,.82)', border: '1px solid rgba(148,163,184,.15)', marginBottom: 24 };
const eyebrow: CSSProperties = { color: '#67e8f9', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase', margin: '0 0 10px 0' };
const panel: CSSProperties = { background: 'rgba(15,23,42,.82)', padding: 'clamp(16px, 4vw, 24px)', borderRadius: 24, border: '1px solid rgba(148,163,184,.15)', marginBottom: 24, boxShadow: '0 10px 30px rgba(0,0,0,.2)' };
const input: CSSProperties = { width: '100%', padding: 14, borderRadius: 12, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(2,6,23,.55)', color: '#eef2ff', marginBottom: 16, outline: 'none', boxSizing: 'border-box' };
const inline: CSSProperties = { display: 'flex', gap: 12, alignItems: 'center' };
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 16, padding: '16px 0', borderBottom: '1px solid rgba(148,163,184,.1)' };
const playerRow: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '16px 0', borderBottom: '1px solid rgba(148,163,184,.1)', color: '#cbd5e1', fontSize: 15 };