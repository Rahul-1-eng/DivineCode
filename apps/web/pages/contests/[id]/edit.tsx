import { CSSProperties, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';

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
  return { 'Content-Type': 'application/json', 'x-user-email': session?.user?.email || '', 'x-user-name': session?.user?.name || '' };
}

export default function ContestEditPage() {
  const router = useRouter();
  const { id } = router.query;
  const { data: session, status } = useSession();
  const [contest, setContest] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [newProblemCode, setNewProblemCode] = useState('');
  const [newProblemPlatform, setNewProblemPlatform] = useState('Codeforces');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function loadContest() {
    if (!id || status === 'loading') return;
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}${viewerQuery(session)}`);
    const data = await res.json();
    if (!res.ok) { setError(data.error || 'Contest not found'); return; }
    setContest(data);
    setTitle(data.title || '');
    setDescription(data.description || '');
    setDurationMinutes(data.durationMinutes || 120);
  }

  useEffect(() => { loadContest(); }, [id, status, session?.user?.email, session?.user?.name]);

  async function saveSettings() {
    if (!id || !session) return;
    setSaving(true);
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}`, { method: 'PUT', headers: viewerHeaders(session), body: JSON.stringify({ title, description, durationMinutes }) });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) return alert(data.error || 'Could not save contest');
    setContest(data);
  }

  async function lookupProblem(platform: string, code: string) {
    const res = await fetch(`${API_BASE_URL}/api/problems/lookup?platform=${encodeURIComponent(platform)}&code=${encodeURIComponent(code)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lookup failed');
    return data;
  }

  async function addProblem() {
    if (!id || !session || !newProblemCode.trim()) return alert('Enter a problem code.');
    try {
      const p = await lookupProblem(newProblemPlatform, newProblemCode);
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems`, { method: 'POST', headers: viewerHeaders(session), body: JSON.stringify(p) });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Could not add problem');
      setContest(data);
      setNewProblemCode('');
    } catch (e: any) {
      alert(e.message || 'Could not add problem');
    }
  }

  async function replaceProblem(problemId: string) {
    if (!id || !session) return;
    const code = prompt('Replacement Codeforces code, e.g. 1805A');
    if (!code) return;
    try {
      const p = await lookupProblem('Codeforces', code);
      const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems/${problemId}`, { method: 'PUT', headers: viewerHeaders(session), body: JSON.stringify(p) });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Could not replace problem');
      setContest(data);
    } catch (e: any) {
      alert(e.message || 'Could not replace problem');
    }
  }

  async function removeProblem(problemId: string) {
    if (!id || !session || !confirm('Remove this problem and exclude its solves?')) return;
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}/problems/${problemId}`, { method: 'DELETE', headers: viewerHeaders(session) });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Could not remove problem');
    setContest(data);
  }

  async function deleteContest() {
    if (!id || !session || !confirm('Delete this live mashup permanently?')) return;
    const res = await fetch(`${API_V2_BASE_URL}/contests/${id}`, { method: 'DELETE', headers: viewerHeaders(session) });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Could not delete contest');
    router.push('/contests');
  }

  if (status === 'loading') return <main style={page}>Checking account...</main>;
  if (!session) return <main style={page}><section style={panel}><h1>Sign in required</h1><a href="/signin" style={primary}>Sign in</a></section></main>;
  if (error) return <main style={page}><section style={panel}><h1>{error}</h1><a href="/contests" style={link}>Back to contests</a></section></main>;
  if (!contest) return <main style={page}>Loading editor...</main>;
  if (!contest.canManage) return <main style={page}><section style={panel}><h1>Owner only</h1><p style={{ color: '#94a3b8' }}>Only the contest creator can open the editing page.</p><a href={`/contests/${id}`} style={primary}>Back to contest</a></section></main>;

  return <main style={page}><section style={{ maxWidth: 1120, margin: '0 auto' }}><nav style={nav}><a href={`/contests/${id}`} style={link}>Back to live room</a><button onClick={deleteContest} style={danger}>Delete mashup</button></nav><div style={hero}><p style={eyebrow}>Owner editing page</p><h1 style={{ margin: 0, fontSize: 44 }}>{contest.title}</h1><p style={{ color: '#a8b3c7' }}>Only the creator can see this page. Problems added here are rejected if any player has already solved them on Codeforces.</p></div><section style={panel}><h2>Contest settings</h2><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} style={input} /><label>Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...input, minHeight: 90 }} /><label>Duration minutes</label><input type="number" value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} style={{ ...input, maxWidth: 180 }} /><button onClick={saveSettings} disabled={saving} style={primary}>{saving ? 'Saving...' : 'Save settings'}</button></section><section style={panel}><h2>Add problem</h2><div style={inline}><select value={newProblemPlatform} onChange={(e) => setNewProblemPlatform(e.target.value)} style={input}><option>Codeforces</option><option>LeetCode</option><option>AtCoder</option><option>CodeChef</option></select><input value={newProblemCode} onChange={(e) => setNewProblemCode(e.target.value)} placeholder="1805A" style={input} /><button onClick={addProblem} style={primary}>Add</button></div></section><section style={panel}><h2>Problems</h2>{contest.problems.map((problem: any, index: number) => <div key={problem.id} style={row}><strong>{String.fromCharCode(65 + index)}</strong><div><b>{problem.title}</b><p style={{ margin: '4px 0 0', color: '#94a3b8' }}>{problem.platform} - Rating {problem.rating || problem.difficulty || 'Practice'}</p></div><button onClick={() => replaceProblem(problem.id)} style={ghost}>Replace</button><button onClick={() => removeProblem(problem.id)} style={ghost}>Remove</button></div>)}</section><section style={panel}><h2>Players</h2>{contest.members.map((member: any) => <div key={member.id} style={playerRow}><span>{member.name}</span><span>{member.team || 'Individuals'}</span><span>{member.codeforcesHandle || member.handle || 'missing handle'}</span></div>)}</section></section></main>;
}

const page: CSSProperties = { minHeight: '100vh', padding: 28, fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.32), transparent 34rem), #070a16' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 24 };
const hero: CSSProperties = { marginBottom: 18 };
const panel: CSSProperties = { padding: 24, borderRadius: 24, border: '1px solid rgba(148,163,184,.22)', background: 'rgba(15,23,42,.82)', marginBottom: 18 };
const eyebrow: CSSProperties = { color: '#67e8f9', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase' };
const link: CSSProperties = { color: '#67e8f9', textDecoration: 'none', fontWeight: 900 };
const input: CSSProperties = { width: '100%', padding: 12, margin: '8px 0 14px', borderRadius: 14, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(2,6,23,.55)', color: '#eef2ff' };
const primary: CSSProperties = { display: 'inline-block', padding: '12px 17px', borderRadius: 999, border: 0, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', textDecoration: 'none', fontWeight: 900, cursor: 'pointer' };
const danger: CSSProperties = { padding: '12px 17px', borderRadius: 999, border: '1px solid rgba(248,113,113,.45)', background: 'rgba(127,29,29,.25)', color: '#fecaca', fontWeight: 900, cursor: 'pointer' };
const ghost: CSSProperties = { padding: '10px 14px', borderRadius: 999, border: '1px solid rgba(148,163,184,.28)', background: 'rgba(2,6,23,.55)', color: '#e2e8f0', cursor: 'pointer' };
const inline: CSSProperties = { display: 'grid', gridTemplateColumns: '160px 1fr auto', gap: 12, alignItems: 'center' };
const row: CSSProperties = { display: 'grid', gridTemplateColumns: '42px 1fr auto auto', gap: 12, alignItems: 'center', padding: 14, borderRadius: 16, background: 'rgba(2,6,23,.45)', marginTop: 10 };
const playerRow: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 160px 180px', gap: 12, padding: 12, borderBottom: '1px solid rgba(148,163,184,.12)' };
