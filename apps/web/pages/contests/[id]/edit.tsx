/**
 * @file edit.tsx
 * @description Contest Administration Control Plane.
 * Implements optimistic UI rendering, unified state reconciliation, and atomic REST mutations
 * to guarantee a zero-latency UX during high-frequency contest management operations.
 */
import { CSSProperties, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import toast, { Toaster } from 'react-hot-toast';

export async function getServerSideProps() { return { props: {} }; }

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

// --- Utility: Network Telemetry & Hydration ---
function viewerQuery(session: any) {
  const query = new URLSearchParams();
  if (session?.user?.id) query.set('viewerId', session.user.id);
  if (session?.user?.email) query.set('viewerEmail', session.user.email);
  if (session?.user?.name) query.set('viewerName', session.user.name);
  const value = query.toString();
  return value ? `?${value}` : '';
}

function viewerHeaders(session: any) {
  return { 
    'Content-Type': 'application/json',
    'x-user-id': session?.user?.id || '', 
    'x-user-email': session?.user?.email || '', 
    'x-user-name': session?.user?.name || '' 
  };
}

/**
 * Standardized Fetch Wrapper to enforce strict JSON parsing and 
 * catch silent HTTP failures across all REST mutations.
 */
async function fetchWithErrorBoundary(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  const contentType = res.headers.get("content-type");
  
  if (contentType && contentType.includes("application/json")) {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}: Operation rejected by server`);
    return data;
  }
  
  const errorText = await res.text();
  console.error("[API Boundary Error]:", errorText);
  throw new Error(`Upstream Error (${res.status}): Inspect network payload.`);
}

// --- Main Component ---
export default function ContestEditPage() {
  const router = useRouter();
  const { id } = router.query;
  const { data: session, status } = useSession();
  
  // 1. Core Entity State
  const [contest, setContest] = useState<any>(null);
  const [initError, setInitError] = useState('');

  // 2. Unified Form States (Reduces cascading renders)
  const [settingsForm, setSettingsForm] = useState({
    title: '',
    description: '',
    durationMinutes: 120,
    startTimeStr: '',
    openEditing: false
  });

  const [mashupForm, setMashupForm] = useState({
    platform: 'Codeforces',
    code: '',
    url: '',
    generateAiTests: true
  });

  const [customForm, setCustomForm] = useState({
    title: '',
    description: '',
    timeLimit: 0,
    generateAiTests: true
  });

  // 3. Granular Execution Flags (Prevents UI lockups)
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [pendingOperations, setPendingOperations] = useState<Set<string>>(new Set());

  // --- Initialization Pipeline ---
  useEffect(() => { 
    if (!id || status === 'loading') return;

    const loadContest = async () => {
      try {
        const data = await fetchWithErrorBoundary(`${API_V2_BASE_URL}/contests/${id}${viewerQuery(session)}`);
        setContest(data);
        
        let formattedTime = '';
        if (data.startTime) {
          const dt = new Date(data.startTime);
          dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
          formattedTime = dt.toISOString().slice(0, 16);
        }

        setSettingsForm({
          title: data.title || '',
          description: data.description || '',
          durationMinutes: data.durationMinutes || 120,
          startTimeStr: formattedTime,
          openEditing: data.settings?.openEditing || data.openEditing || false
        });

      } catch (err: any) {
        setInitError(err.message || 'Contest reference not found');
      }
    };

    loadContest(); 
  }, [id, status, session]);

  // --- Handlers: Async Operations ---
  const addPendingOp = (opId: string) => setPendingOperations(prev => new Set(prev).add(opId));
  const removePendingOp = (opId: string) => setPendingOperations(prev => { const n = new Set(prev); n.delete(opId); return n; });

  const handleSettingsSave = async () => {
    if (!id || !session) return;
    setIsSavingSettings(true);
    
    try {
      const payload: any = { 
        title: settingsForm.title, 
        description: settingsForm.description, 
        durationMinutes: settingsForm.durationMinutes, 
        openEditing: settingsForm.openEditing 
      };
      
      if (settingsForm.startTimeStr) {
        payload.startTime = new Date(settingsForm.startTimeStr).toISOString();
      }

      const updatedContest = await fetchWithErrorBoundary(`${API_V2_BASE_URL}/contests/${id}`, {
        method: 'PUT',
        headers: viewerHeaders(session),
        body: JSON.stringify(payload)
      });

      setContest(updatedContest);
      toast.success('Global settings synchronized successfully!');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleToggleEditing = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.checked;
    setSettingsForm(prev => ({ ...prev, openEditing: newVal }));
    
    try {
      await fetchWithErrorBoundary(`${API_V2_BASE_URL}/contests/${id}`, {
        method: 'PUT',
        headers: viewerHeaders(session),
        body: JSON.stringify({ openEditing: newVal })
      });
      toast.success("Security permissions updated");
    } catch(err: any) {
      setSettingsForm(prev => ({ ...prev, openEditing: !newVal })); // Rollback on failure
      toast.error("Network fault: Failed to update permissions");
    }
  };

  const handleAddProblemDirect = async () => {
    if (!mashupForm.code.trim()) return toast.error('Problem identifier required.');
    addPendingOp('add_direct');
    
    try {
      const cleanCode = mashupForm.code.replace(/\s+/g, '').toUpperCase();
      const problemContext = await fetchWithErrorBoundary(
        `${API_V2_BASE_URL}/problems/lookup?platform=${encodeURIComponent(mashupForm.platform)}&code=${encodeURIComponent(cleanCode)}`, 
        { headers: viewerHeaders(session) }
      );
      
      const updatedContest = await fetchWithErrorBoundary(`${API_V2_BASE_URL}/contests/${id}/problems`, {
        method: 'POST',
        headers: viewerHeaders(session),
        body: JSON.stringify(problemContext)
      });

      setContest(updatedContest);
      setMashupForm(prev => ({ ...prev, code: '' }));
      toast.success('Node appended to problem set.');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      removePendingOp('add_direct');
    }
  };

  const handleAddProblemUrl = async () => {
    if (!mashupForm.url.trim()) return toast.error('Target vector URL required.');
    addPendingOp('add_url');
    
    let finalUrl = mashupForm.url.trim();
    if (!finalUrl.startsWith('http') && /^\d+\s*[a-zA-Z][0-9]?$/.test(finalUrl)) {
       const clean = finalUrl.replace(/\s+/g, '').toUpperCase();
       const num = clean.match(/^\d+/)?.[0];
       const letter = clean.match(/[A-Z0-9]+$/)?.[0];
       finalUrl = `https://codeforces.com/problemset/problem/${num}/${letter}`;
    }

    try {
      const updatedContest = await fetchWithErrorBoundary(`${API_V2_BASE_URL}/contests/${id}/problems/mashup`, {
        method: 'POST',
        headers: viewerHeaders(session),
        body: JSON.stringify({ type: 'URL', url: finalUrl, generateAiTests: mashupForm.generateAiTests })
      });

      setContest(updatedContest);
      setMashupForm(prev => ({ ...prev, url: '' }));
      toast.success('External resource scraped and mapped.');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      removePendingOp('add_url');
    }
  };

  const handleAddCustomProblem = async () => {
    if (!customForm.title.trim()) return toast.error('Entity title is required.');
    addPendingOp('add_custom');
    
    try {
      const updatedContest = await fetchWithErrorBoundary(`${API_V2_BASE_URL}/contests/${id}/problems/mashup`, {
        method: 'POST',
        headers: viewerHeaders(session),
        body: JSON.stringify({
          type: 'CUSTOM',
          customData: {
            title: customForm.title,
            description: customForm.description,
            time: customForm.timeLimit,
            generateAiTests: customForm.generateAiTests,
            testcases: [] 
          }
        })
      });

      setContest(updatedContest);
      setCustomForm({ title: '', description: '', timeLimit: 0, generateAiTests: true });
      toast.success('Custom isolated problem provisioned.');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      removePendingOp('add_custom');
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('image', file);

    setIsUploadingImage(true);
    try {
      const data = await fetchWithErrorBoundary(`${API_V2_BASE_URL}/upload-image`, {
        method: 'POST',
        body: formData 
      });
      
      if (data.success) {
        setCustomForm(prev => ({ ...prev, description: prev.description + `\n<br /><img src="${API_BASE_URL}${data.url}" alt="Problem Context" style="max-width: 100%; border-radius: 8px;" />\n<br />` }));
        toast.success("Binary uploaded to block storage.");
      }
    } catch (err: any) {
      toast.error("Upload gateway rejected payload.");
    } finally {
      setIsUploadingImage(false);
      e.target.value = ''; 
    }
  };

  // --- Optimistic Mutations ---
  
  const moveProblemOptimistic = async (problemId: string, direction: 'UP' | 'DOWN') => {
    // 1. Create a deep clone snapshot for potential rollback
    const previousProblems = [...contest.problems];
    
    // 2. Compute indices
    const currentIndex = previousProblems.findIndex(p => p.id === problemId);
    if (currentIndex === -1) return;
    if (direction === 'UP' && currentIndex === 0) return;
    if (direction === 'DOWN' && currentIndex === previousProblems.length - 1) return;

    // 3. Mutate local state instantly for Zero-Latency UX
    const newProblems = [...previousProblems];
    const targetIndex = direction === 'UP' ? currentIndex - 1 : currentIndex + 1;
    [newProblems[currentIndex], newProblems[targetIndex]] = [newProblems[targetIndex], newProblems[currentIndex]];
    setContest((prev: any) => ({ ...prev, problems: newProblems }));

    // 4. Dispatch actual network request
    addPendingOp(`move_${problemId}`);
    try {
      const updatedContest = await fetchWithErrorBoundary(`${API_V2_BASE_URL}/contests/${id}/problems/${problemId}/reorder`, {
        method: 'PUT',
        headers: viewerHeaders(session),
        body: JSON.stringify({ direction })
      });
      
      // Resync state to ensure authoritative data consistency
      setContest(updatedContest); 
    } catch (err: any) {
      // Rollback on failure
      setContest((prev: any) => ({ ...prev, problems: previousProblems }));
      toast.error('Desync error: State rolled back to maintain integrity.');
    } finally {
      removePendingOp(`move_${problemId}`);
    }
  };

  const removeProblemOptimistic = async (problemId: string) => {
    if (!confirm('Execute hard delete on this problem node?')) return;
    
    const previousProblems = [...contest.problems];
    setContest((prev: any) => ({ ...prev, problems: previousProblems.filter(p => p.id !== problemId) }));
    
    try {
      const updatedContest = await fetchWithErrorBoundary(`${API_V2_BASE_URL}/contests/${id}/problems/${problemId}`, {
        method: 'DELETE',
        headers: viewerHeaders(session)
      });
      setContest(updatedContest);
      toast.success('Node dereferenced.');
    } catch (err: any) {
      setContest((prev: any) => ({ ...prev, problems: previousProblems }));
      toast.error(err.message);
    }
  };

  const handleDeleteContest = async () => {
    if (!confirm('CRITICAL ACTION: Purge all data associated with this match?')) return;
    try {
      await fetchWithErrorBoundary(`${API_V2_BASE_URL}/contests/${id}`, {
        method: 'DELETE',
        headers: viewerHeaders(session)
      });
      router.push('/contests');
    } catch (err: any) { 
      toast.error(err.message); 
    }
  };

  // --- Render Guards ---
  if (status === 'loading') return <main style={page}>Booting workspace parameters...</main>;
  if (!session) return <main style={page}><section style={panel}><h1>Authentication Required</h1><a href="/signin" style={primary}>Sign in to Access Identity</a></section></main>;
  if (initError) return <main style={page}><section style={panel}><h1>{initError}</h1><a href="/contests" style={link}>Return to Registry</a></section></main>;
  if (!contest) return <main style={page}>Synchronizing states...</main>;
  if (!contest.canManage) return <main style={page}><section style={panel}><h1>Access Denied</h1><p style={{ color: 'var(--text-muted)' }}>Administrative clearance required to alter structural constraints.</p><a href={`/contests/${id}`} style={primary}>Return to Sandbox</a></section></main>;

  // --- Main Layout ---
  return (
    <main style={page}>
      <Toaster position="top-center" toastOptions={{ style: { background: 'var(--bg-panel-solid)', color: 'var(--text-main)', border: '1px solid var(--border-color)' } }} />
      <section style={{ maxWidth: 1120, margin: '0 auto' }}>
        
        <nav style={nav}>
          <a href={`/contests/${id}`} style={link}>← Disconnect & Return</a>
          <button onClick={handleDeleteContest} style={danger}>Execute Match Purge</button>
        </nav>
        
        <div style={hero}>
          <p style={eyebrow}>Orchestration Control Plane</p>
          <h1 style={{ margin: 0, fontSize: 44, color: 'var(--text-main)' }}>{contest.title}</h1>
        </div>

        {/* Global Configurations Block */}
        <section style={panel}>
          <h2 style={{ color: 'var(--text-main)' }}>Global Parameters</h2>
          
          <label style={{ color: 'var(--text-muted)' }}>Match Identifier</label>
          <input value={settingsForm.title} onChange={(e) => setSettingsForm(p => ({...p, title: e.target.value}))} style={input} />
          
          <label style={{ color: 'var(--text-muted)' }}>Rules & Context (Markdown enabled)</label>
          <textarea value={settingsForm.description} onChange={(e) => setSettingsForm(p => ({...p, description: e.target.value}))} style={{ ...input, minHeight: 90 }} />
          
          <label style={{ color: 'var(--text-muted)' }}>Execution Window (Minutes)</label>
          <input type="number" value={settingsForm.durationMinutes} onChange={(e) => setSettingsForm(p => ({...p, durationMinutes: Number(e.target.value)}))} style={{ ...input, maxWidth: 180 }} />
          
          <label style={{display: 'block', marginTop: 10, color: 'var(--text-muted)'}}>Automated Activation Time</label>
          <input type="datetime-local" value={settingsForm.startTimeStr} onChange={(e) => setSettingsForm(p => ({...p, startTimeStr: e.target.value}))} style={{ ...input, maxWidth: 220 }} />
          
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 15, marginBottom: 15, color: 'var(--text-main)' }}>
            <input type="checkbox" checked={settingsForm.openEditing} onChange={handleToggleEditing} />
            Open Editing Protocol (Allow peers to dynamically inject problems)
          </label>

          <button onClick={handleSettingsSave} disabled={isSavingSettings} style={primary}>
            {isSavingSettings ? 'Synchronizing Nodes...' : 'Commit Configuration'}
          </button>
        </section>

        {/* Entity Injection Block */}
        <section style={panel}>
          <h2 style={{ color: 'var(--text-main)' }}>Node Injection Modules</h2>
          
          {/* Internal Platform Lookup */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 5, color: 'var(--text-muted)' }}>Module 1: Direct Linkage via Platform Gateway</label>
            <div style={inline}>
              <select value={mashupForm.platform} onChange={(e) => setMashupForm(p => ({...p, platform: e.target.value}))} style={{...input, width: 'auto', marginBottom: 0}}>
                <option>Codeforces</option><option>LeetCode</option><option>AtCoder</option><option>CodeChef</option>
              </select>
              <input value={mashupForm.code} onChange={(e) => setMashupForm(p => ({...p, code: e.target.value}))} placeholder="Target ID (e.g. 1805A)" style={{...input, flex: 1, marginBottom: 0}} />
              <button onClick={handleAddProblemDirect} disabled={pendingOperations.has('add_direct')} style={primary}>
                {pendingOperations.has('add_direct') ? 'Binding...' : 'Mount Node'}
              </button>
            </div>
          </div>

          {/* External Scraper */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 20, marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 5, color: 'var(--text-muted)' }}>Module 2: Neural Scraper (Extracts AST & Cases dynamically)</label>
            <div style={{ display: 'flex', gap: 12 }}>
              <input value={mashupForm.url} onChange={(e) => setMashupForm(p => ({...p, url: e.target.value}))} placeholder="https://codeforces.com/problemset/problem/..." style={{ ...input, flex: 1, margin: 0 }} />
              <button onClick={handleAddProblemUrl} disabled={pendingOperations.has('add_url')} style={primary}>
                {pendingOperations.has('add_url') ? 'Scraping AST...' : 'Scrape & Mount'}
              </button>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--text-muted)', marginTop: 10 }}>
               <input type="checkbox" checked={mashupForm.generateAiTests} onChange={e => setMashupForm(p => ({...p, generateAiTests: e.target.checked}))} />
               🤖 Enable Neural Analyzer to generate advanced edge-case system tests globally
            </label>
          </div>

          {/* Custom Construction */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 20 }}>
            <label style={{ display: 'block', marginBottom: 5, color: 'var(--text-muted)' }}>Module 3: Bespoke Entity Construction</label>
            <input value={customForm.title} onChange={(e) => setCustomForm(p => ({...p, title: e.target.value}))} placeholder="Node Title Identifier" style={input} />
            
            <div style={{ background: 'var(--border-color)', padding: 10, borderRadius: '12px 12px 0 0', display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Inject Binary Image Asset:</span>
              <input 
                type="file" 
                accept="image/*" 
                onChange={handleImageUpload} 
                style={{ fontSize: 13, color: 'var(--text-main)', width: 220 }} 
                disabled={isUploadingImage}
              />
              {isUploadingImage && <span style={{ color: 'var(--accent-primary)', fontSize: 12 }}>Streaming to block storage...</span>}
            </div>
            <textarea 
              value={customForm.description} 
              onChange={(e) => setCustomForm(p => ({...p, description: e.target.value}))} 
              placeholder="Inject HTML/Markdown semantic rules. Use the binary uploader above for seamless CDN linking." 
              style={{ ...input, minHeight: 140, borderRadius: '0 0 12px 12px' }} 
            />
            
            <div>
               <label style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 'bold' }}>Execution Constraint (0 for unbound O(N))</label>
               <input type="number" placeholder="120s" value={customForm.timeLimit} onChange={e => setCustomForm(p => ({...p, timeLimit: Number(e.target.value)}))} style={input} />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--text-muted)', marginTop: 5, marginBottom: 15 }}>
               <input type="checkbox" checked={customForm.generateAiTests} onChange={e => setCustomForm(p => ({...p, generateAiTests: e.target.checked}))} />
               🤖 Synthesize comprehensive regression matrix tests via AI Engine
            </label>

            <button onClick={handleAddCustomProblem} disabled={pendingOperations.has('add_custom')} style={primary}>
              {pendingOperations.has('add_custom') ? 'Compiling Entity...' : 'Initialize Bespoke Problem'}
            </button>
          </div>

        </section>

        {/* Existing Data Graph View */}
        <section style={panel}>
          <h2 style={{ color: 'var(--text-main)' }}>Active Problem Graph</h2>
          {contest.problems.map((problem: any, index: number) => (
            <div key={problem.id} style={row}>
              <strong style={{ fontSize: 24, color: 'var(--text-main)', minWidth: 30 }}>{String.fromCharCode(65 + index)}</strong>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginRight: 15 }}>
                 <button onClick={() => moveProblemOptimistic(problem.id, 'UP')} disabled={index === 0 || pendingOperations.has(`move_${problem.id}`)} style={{...ghost, padding: '2px 6px', fontSize: 10}}>▲</button>
                 <button onClick={() => moveProblemOptimistic(problem.id, 'DOWN')} disabled={index === contest.problems.length - 1 || pendingOperations.has(`move_${problem.id}`)} style={{...ghost, padding: '2px 6px', fontSize: 10}}>▼</button>
              </div>

              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 18, color: 'var(--text-main)' }}>{problem.titleSnapshot || problem.title}</b>
                <p style={{ margin: '4px 0 0', color: 'var(--text-muted)' }}>{problem.platform} - Base Elo: {problem.rating || problem.difficulty || 'Unranked'}</p>
              </div>
              <button onClick={() => removeProblemOptimistic(problem.id)} style={danger}>Unlink Node</button>
            </div>
          ))}
          {contest.problems.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Graph is currently empty. Inject a problem to continue.</p>}
        </section>

        {/* Access List Tracker */}
        <section style={panel}>
          <h2 style={{ color: 'var(--text-main)' }}>Connected Identity Vectors</h2>
          <div style={{...playerRow, fontWeight: 'bold', color: 'var(--text-main)', borderBottom: '2px solid var(--border-color)'}}>
            <span>Display Name</span><span>Guild/Group</span><span>Terminal Reference</span>
          </div>
          {contest.members?.map((member: any) => (
            <div key={member.id} style={playerRow}>
              <span>{member.name || member.displayName}</span>
              <span>{member.teamName || member.team?.name || 'Local'}</span>
              <span>{member.codeforcesHandle || member.externalHandle?.handle || 'Anonymous'}</span>
            </div>
          ))}
          {(!contest.members || contest.members.length === 0) && <p style={{ color: 'var(--text-muted)', marginTop: 15 }}>No access vectors established yet.</p>}
        </section>
      </section>
    </main>
  );
}

// -----------------------------------------------------------------------------
// Component Style Dictionary (Strict Variables)
// -----------------------------------------------------------------------------
const page: CSSProperties = { minHeight: '100vh', width: '100%', maxWidth: '100vw', overflowX: 'hidden', padding: 'clamp(16px, 4vw, 32px)', fontFamily: 'Inter, Arial, sans-serif', color: 'var(--text-main)', background: 'var(--bg-main)', boxSizing: 'border-box' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 };
const link: CSSProperties = { color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 900, fontSize: 16 };
const danger: CSSProperties = { background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#f87171', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s' };
const primary: CSSProperties = { 
  display: 'inline-block', 
  padding: '12px 24px', 
  borderRadius: 8, 
  background: 'linear-gradient(135deg,#38bdf8,#818cf8)', 
  color: '#020617', 
  textDecoration: 'none', 
  fontWeight: 900, 
  border: 'none', 
  textAlign: 'center', 
  cursor: 'pointer', 
  transition: 'all 0.2s' 
};
const ghost: CSSProperties = { background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s' };
const hero: CSSProperties = { padding: 'clamp(20px, 4vw, 30px)', borderRadius: 24, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', marginBottom: 24 };
const eyebrow: CSSProperties = { color: 'var(--accent-primary)', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase', margin: '0 0 10px 0' };
const panel: CSSProperties = { background: 'var(--bg-panel)', padding: 'clamp(16px, 4vw, 24px)', borderRadius: 24, border: '1px solid var(--border-color)', marginBottom: 24, boxShadow: '0 10px 30px rgba(0,0,0,.1)' };
const input: CSSProperties = { width: '100%', padding: 14, borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-main)', marginBottom: 16, outline: 'none', boxSizing: 'border-box' };
const inline: CSSProperties = { display: 'flex', gap: 12, alignItems: 'center' };
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 16, padding: '16px 0', borderBottom: '1px solid var(--border-color)' };
const playerRow: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '16px 0', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: 15 };