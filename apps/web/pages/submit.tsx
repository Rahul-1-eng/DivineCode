import { CSSProperties, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import toast, { Toaster } from 'react-hot-toast';

export async function getServerSideProps() { return { props: {} }; }

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

const starter = `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    return 0;\n}\n`;

function viewerQuery(session: any) {
  const query = new URLSearchParams();
  if (session?.user?.email) query.set('viewerEmail', session.user.email);
  if (session?.user?.name) query.set('viewerName', session.user.name);
  return query.toString() ? `?${query.toString()}` : '';
}

function viewerHeaders(session: any) {
  return { 'Content-Type': 'application/json', 'x-user-email': session?.user?.email || '', 'x-user-name': session?.user?.name || '' };
}

export default function SubmitPage() {
  const router = useRouter();
  const { contestId, problemId } = router.query;
  const { data: session, status } = useSession();
  
  const [contest, setContest] = useState<any>(null);
  const [problem, setProblem] = useState<any>(null);
  const [proxiedHtml, setProxiedHtml] = useState<string>('');
  const [code, setCode] = useState(starter);
  const [language, setLanguage] = useState('cpp');
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [timeLeft, setTimeLeft] = useState(120); // 2 minute default timer for MCQs
  
  useEffect(() => {
    if (!contestId || status === 'loading') return;
    fetch(`${API_V2_BASE_URL}/contests/${contestId}${viewerQuery(session)}`)
      .then((r) => r.json())
      .then((data) => { 
        setContest(data); 
        const p = data.problems?.find((p: any) => p.id === problemId);
        
        // 👉 FIX: Map the backend's 'interviewQuestion' to frontend's 'mcqData'
        if (p && p.interviewQuestion) {
          p.mcqData = p.interviewQuestion;
        }
        
        setProblem(p);
        if (p?.externalUrl && p?.requiresRedirect) {
           fetch(`${API_V2_BASE_URL}/proxy/problem?url=${encodeURIComponent(p.externalUrl)}`)
             .then(res => res.text()).then(html => setProxiedHtml(html)).catch(() => {});
        }
      })
      .catch(() => null);
  }, [contestId, problemId, session, status]);

  const isMCQ = !!problem?.interviewQuestionId;
  const requiresRedirect = problem?.requiresRedirect === true || problem?.platform === 'OTHER';

  // MCQ Timer Logic
  useEffect(() => {
    if (isMCQ && timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(prev => prev - 1), 1000);
      return () => clearTimeout(timer);
    } else if (isMCQ && timeLeft === 0 && !submitting && !verdict) {
      toast.error("Time's up!");
      submitCode();
    }
  }, [isMCQ, timeLeft, submitting, verdict]);

  async function submitCode() {
    // 👉 External Platform Redirection Logic
   if (requiresRedirect && problem?.externalUrl) {
    // Optionally trigger a silent 'Started' submission to track user activity
    toast.success("Redirecting to external platform...");
    window.location.href = problem.externalUrl; // Use this to force redirect in same tab if preferred, or window.open
    return;
}

    setSubmitting(true);
    try {
      const res = await fetch(`${API_V2_BASE_URL}/contests/${contestId}/submissions`, { 
        method: 'POST', 
        headers: viewerHeaders(session), 
        body: JSON.stringify({ code: isMCQ ? String(selectedOption) : code, language: isMCQ ? 'mcq' : language, contestProblemId: problemId }) 
      });
      const data = await res.json();
      if (res.ok) {
         const judge = await fetch(`${API_V2_BASE_URL}/submissions/${data.id}/judge?wait=true`, { method: 'POST', headers: viewerHeaders(session) });
         const jData = await judge.json();
         setVerdict({ verdict: jData.submission.verdict, message: jData.submission.judgeMessage, testResults: jData.testResults });
      } else {
         toast.error(data.error || "Submission failed");
      }
    } catch (e) { toast.error("Network Error during submission"); }
    finally { setSubmitting(false); }
  }

  if (status === 'loading') return <main style={page}>Checking auth...</main>;

  return (
    <main style={page}>
      <Toaster />
      <div style={splitLayout}>
       <aside style={leftPanelStyle}>
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <h1>{problem?.title || 'Problem Description'}</h1>
  </div>
   
  <div style={problemArea}>
    {/* 1. Display Prompt/Description */}
    <h2 style={{ color: '#fff' }}>{isMCQ ? problem?.mcqData?.prompt : 'Description'}</h2>
    
    {!isMCQ && (
       <div dangerouslySetInnerHTML={{ __html: proxiedHtml || problem?.customDescription || problem?.description || problem?.problem?.description || 'No description provided.' }} />
    )}

    {/* 2. Display Image if exists for both MCQ and Coding */}
    {problem?.imageUrl && (
      <img src={problem.imageUrl} alt="Problem" style={{ width: '100%', borderRadius: 8, marginTop: 15 }} />
    )}
    
    {requiresRedirect && (
      <div style={{ marginTop: 20, padding: 15, background: 'rgba(56, 189, 248, 0.1)', border: '1px solid #38bdf8', borderRadius: 8, textAlign: 'center' }}>
        <a href={problem.externalUrl} target="_blank" rel="noreferrer" style={{ color: '#fff', textDecoration: 'underline' }}>View Original Problem ↗</a>
      </div>
    )}
  </div>
</aside>

<section style={rightPanelStyle}>
  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
    {isMCQ ? (
      <div style={{ padding: '20px', background: '#020617', borderRadius: '8px', border: '1px solid #334155' }}>
        <h3 style={{ color: '#67e8f9', display: 'flex', justifyContent: 'space-between' }}>
            Select Answer 
            <span style={{ color: timeLeft < 30 ? '#ef4444' : '#fbbf24' }}>⏳ {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</span>
        </h3>
        {problem?.mcqData?.options?.map((opt: string, i: number) => (
           <button key={i} onClick={() => setSelectedOption(i)} style={selectedOption === i ? selectedOptionStyle : optionStyle}>{opt}</button>
        ))}
      </div>
    ) : (
      <div style={{ flex: 1 }}>
        <h3 style={{ color: '#67e8f9', padding: '10px 0' }}>Coding Workspace</h3>
        {!requiresRedirect && <textarea value={code} onChange={(e) => setCode(e.target.value)} style={editor} />}
      </div>
    )}
  </div>
   
  <button onClick={submitCode} style={submitBtn} disabled={submitting}>
    {requiresRedirect ? 'Open Platform to Submit ↗' : submitting ? 'Processing...' : 'Submit Response'}
  </button>
  
  {verdict && (
    <div style={{...verdictBox, borderColor: verdict.verdict === 'ACCEPTED' ? '#22c55e' : '#ef4444'}}>
      <h3 style={{ color: verdict.verdict === 'ACCEPTED' ? '#22c55e' : '#ef4444' }}>{verdict.verdict}</h3>
      <p>{verdict.message}</p>
    </div>
  )}
</section>
      </div>
    </main>
  );
}

const page: CSSProperties = { minHeight: '100vh', background: '#020617', color: '#fff', padding: 20 };
const splitLayout: CSSProperties = { display: 'flex', gap: 20 };
const leftPanelStyle: CSSProperties = { flex: 1 };
const rightPanelStyle: CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column' };
const problemArea: CSSProperties = { background: '#0f172a', padding: 20, borderRadius: 12 };
const editor: CSSProperties = { height: '300px', background: '#020617', color: '#fff', width: '100%', marginTop: 20, padding: 10, fontFamily: 'monospace', borderRadius: 8, border: '1px solid #334155' };
const submitBtn: CSSProperties = { background: '#38bdf8', color: '#020617', padding: 12, border: 'none', cursor: 'pointer', marginTop: 10, borderRadius: 8, fontWeight: 'bold', fontSize: 16 };
const verdictBox: CSSProperties = { padding: 15, border: '1px solid #334155', marginTop: 15, borderRadius: 8, background: '#0f172a' };
const optionStyle: CSSProperties = { display: 'block', margin: '8px 0', padding: 12, background: '#1e293b', border: '1px solid #334155', color: '#fff', borderRadius: 8, cursor: 'pointer', textAlign: 'left', width: '100%' };
const selectedOptionStyle: CSSProperties = { ...optionStyle, background: 'rgba(56, 189, 248, 0.2)', borderColor: '#38bdf8' };