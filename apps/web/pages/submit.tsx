import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';

export async function getServerSideProps() { return { props: {} }; }

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

// Wandbox API for the local Scratchpad/Run button
const WANDBOX_URL = 'https://wandbox.org/api/compile.json';
const languageMap: Record<string, string> = {
  cpp: 'gcc-head',
  c: 'gcc-head-c',
  java: 'openjdk-head',
  python: 'cpython-head',
  javascript: 'nodejs-head'
};

const starter = `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    // write your solution here\n    return 0;\n}\n`;

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

export default function SubmitPage() {
  const router = useRouter();
  const { contestId, problemId } = router.query;
  const { data: session, status } = useSession();
  
  const [contest, setContest] = useState<any>(null);
  const [problem, setProblem] = useState<any>(null);
  const [language, setLanguage] = useState('cpp');
  const [code, setCode] = useState(starter);
  
  // Audio State
  const [soundEnabled, setSoundEnabled] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Submission States
  const [verdict, setVerdict] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);

  // Terminal States
  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState('');
  const [testError, setTestError] = useState('');
  const [executing, setExecuting] = useState(false);
  const [activeTab, setActiveTab] = useState<'input' | 'output'>('input');

  useEffect(() => {
    if (!contestId || status === 'loading') return;
    fetch(`${API_V2_BASE_URL}/contests/${contestId}${viewerQuery(session)}`)
      .then((r) => r.json())
      .then((data) => { setContest(data); setProblem(data.problems?.find((p: any) => p.id === problemId)); })
      .catch(() => null);
  }, [contestId, problemId, session?.user?.email, session?.user?.name, status]);

  const isCodeforces = problem?.platform?.toLowerCase?.().includes('codeforces');
  const canSeeProblemMeta = Boolean(contest?.visibility?.canSeeProblemMeta);
  const problemIndex = Math.max(0, (contest?.problems || []).findIndex((p: any) => p.id === problem?.id));
  const problemLabel = problem ? String.fromCharCode(65 + problemIndex) : '';

  const playSuccessSound = () => {
    if (soundEnabled && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(e => console.log("Audio autoplay blocked by browser"));
    }
  };

  // 👉 UPDATED: Direct execution to Wandbox for the scratchpad
  async function runCustomTest() {
    setExecuting(true);
    setActiveTab('output');
    setTestOutput('Compiling and running in sandbox...');
    setTestError('');
    
    const compiler = languageMap[language];
    
    try {
      const response = await fetch(WANDBOX_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compiler, code, stdin: testInput || '' })
      });

      if (!response.ok) throw new Error('Execution failed');
      const data = await response.json();
      
      if (data.compiler_error) {
        setTestError(data.compiler_error);
      } else if (data.status !== '0') {
        setTestError(data.program_error || 'Runtime error occurred');
        setTestOutput(data.program_message || '');
      } else {
        setTestOutput(data.program_message || '');
        if (data.program_message) playSuccessSound(); // Little ding for a successful run!
      }
    } catch (e) {
      setTestError('Network error connecting to execution engine.');
    } finally {
      setExecuting(false);
    }
  }

  // Final Submit Logic (Hits your actual DivineCode backend)
  async function submitCode() {
    if (!session?.user?.email) return alert('Sign in first');
    if (!contest || !problem) return alert('Contest problem not loaded');
    const member = contest.viewerMember;
    if (!member && !contest?.canManage) return alert('Only registered contest players can submit.');
    if (isCodeforces) return alert('For Codeforces problems, submit on Codeforces first, then ask the owner to run Codeforces sync.');
    
    setSubmitting(true);
    setVerdict(null);
    
    const res = await fetch(`${API_V2_BASE_URL}/contests/${contestId}/submissions`, {
      method: 'POST',
      headers: viewerHeaders(session),
      body: JSON.stringify({ code, language, contestProblemId: problemId })
    });
    
    const submissionData = await res.json();
    
    if (!res.ok) {
      setSubmitting(false);
      setVerdict({ verdict: 'Rejected', message: submissionData.error || 'Could not create submission' });
      return;
    }
    
    const judgeRes = await fetch(`${API_V2_BASE_URL}/submissions/${submissionData.id}/judge?wait=true`, {
      method: 'POST',
      headers: viewerHeaders(session)
    });
    
    const data = await judgeRes.json();
    setSubmitting(false);
    
    const finalVerdict = data.submission?.verdict || 'Finished';
    setVerdict(judgeRes.ok ? { verdict: finalVerdict, message: data.submission?.judgeMessage || 'Judged' } : { verdict: 'Judge Error', message: data.error || 'Could not judge submission' });

    // Ding on actual Accepted Submission!
    if (finalVerdict === 'ACCEPTED' || finalVerdict === 'Accepted') {
      playSuccessSound();
    }
  }

  if (status === 'loading') return <main className="min-h-screen flex items-center justify-center bg-slate-950 text-white"><h1 className="text-2xl animate-pulse">Checking account...</h1></main>;
  if (!session) return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <section className="max-w-md w-full p-8 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl text-center">
        <h1 className="text-3xl font-bold text-white mb-6">Sign in required</h1>
        <a href="/signin" className="inline-block px-8 py-3 rounded-full bg-gradient-to-r from-indigo-300 to-cyan-400 text-slate-950 font-bold hover:scale-105 transition-transform">Sign In</a>
      </section>
    </main>
  );

  return (
    <main className="min-h-screen p-4 md:p-6 font-sans text-indigo-50 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,.15),transparent_36rem),#070a16] flex flex-col h-screen">
      
      {/* Hidden Audio Element */}
      <audio ref={audioRef} src="/accepted.mp3" preload="auto" />

      {/* Submitting Overlay Animation */}
      {submitting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="flex flex-col items-center p-8 bg-slate-900 border border-cyan-900/50 rounded-3xl shadow-2xl">
            <div className="w-16 h-16 mb-6 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
            <h2 className="text-2xl font-bold text-white mb-2 animate-pulse">Judging Submission...</h2>
            <p className="text-cyan-200 text-sm">Evaluating against system test cases</p>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 shrink-0 max-w-[1600px] w-full mx-auto">
        <a href={contestId ? `/contests/${contestId}` : '/contests'} className="text-cyan-400 font-black hover:text-cyan-300 transition-colors">
          ← Back to Contest
        </a>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-slate-700 bg-slate-900 hover:bg-slate-800 transition-colors text-sm"
          >
            {soundEnabled ? '🔊 Sound On' : '🔇 Muted'}
          </button>
          <div className="px-4 py-2 rounded-full bg-slate-900 border border-slate-700 text-sm font-bold">
            {session.user?.name || session.user?.email}
          </div>
        </div>
      </nav>

      {/* Main Workspace Layout */}
      <section className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0 max-w-[1600px] w-full mx-auto">
        
        {/* Left Meta Panel */}
        <aside className="w-full lg:w-1/3 xl:w-1/4 flex flex-col p-6 md:p-8 rounded-3xl bg-slate-900/80 border border-slate-800 shadow-xl overflow-y-auto shrink-0">
          <p className="text-cyan-400 font-black tracking-widest uppercase text-sm mb-2">
            {isCodeforces ? 'External verified submission' : 'DivineCode local judge'}
          </p>
          <h1 className="text-3xl md:text-4xl font-black mb-2">{canSeeProblemMeta ? problem?.title || 'Loading problem...' : `Problem ${problemLabel}`}</h1>
          <p className="text-slate-400 mb-6">{problem?.platform}</p>

          {isCodeforces && (
            <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200">
              <strong className="block mb-1 font-bold">Codeforces Problem</strong>
              <p className="text-sm opacity-90">Submit your solution on Codeforces. DivineCode updates standings only after Codeforces sync.</p>
            </div>
          )}
          
          {problem?.url && (
            <a href={problem.url} target="_blank" rel="noreferrer" className="text-center px-6 py-3 rounded-full border border-slate-700 bg-slate-800 hover:bg-slate-700 text-white font-bold transition-colors mb-8">
              {isCodeforces ? 'Open on Codeforces ↗' : 'Open Problem Statement ↗'}
            </a>
          )}
          
          <div className="mb-6">
            <label className="block text-sm font-bold mb-2 text-slate-300">Language</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="w-full p-3 rounded-xl border border-slate-700 bg-slate-950 text-white outline-none focus:border-cyan-400 cursor-pointer">
              <option value="cpp">C++</option>
              <option value="java">Java</option>
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
              <option value="c">C</option>
            </select>
          </div>
          
          <button 
            onClick={submitCode} 
            disabled={submitting || !contest?.viewerMember} 
            className="w-full p-4 rounded-2xl bg-gradient-to-r from-indigo-400 to-cyan-400 text-slate-950 font-black text-lg hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:scale-100 shadow-lg shadow-cyan-900/20"
          >
            {isCodeforces ? 'Store as Pending' : 'Final Submit to Judge'}
          </button>
          
          {!contest?.viewerMember && !contest?.canManage && (
            <p className="text-red-400 text-sm mt-4 text-center">Only registered players can submit.</p>
          )}

          {/* Verdict Box */}
          {verdict && (
            <div className={`mt-6 p-6 rounded-2xl border ${verdict.verdict === 'ACCEPTED' || verdict.verdict === 'Accepted' ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-400' : 'bg-red-950/30 border-red-500/30 text-red-400'}`}>
              <h2 className="text-xl font-black mb-1 uppercase tracking-wider">{verdict.verdict}</h2>
              <p className="text-sm opacity-90">{verdict.message}</p>
            </div>
          )}
        </aside>

        {/* Right Editor & Terminal Panel */}
        <section className="w-full lg:w-2/3 xl:w-3/4 rounded-3xl bg-[#0d1117] border border-slate-800 overflow-hidden flex flex-col lg:h-full shadow-2xl min-h-[600px]">
          
          {/* Editor Header */}
          <div className="flex justify-between items-center p-4 bg-slate-900 border-b border-slate-800 shrink-0">
            <strong className="text-slate-300">{isCodeforces ? 'Scratchpad only' : 'Code Editor'}</strong>
            <button 
              onClick={runCustomTest} 
              disabled={executing} 
              className="px-6 py-2 rounded-full bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 font-bold hover:bg-emerald-600/30 transition-colors flex items-center gap-2"
            >
              {executing ? (
                <><span className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"></span> Running...</>
              ) : (
                <>▶ Run Code</>
              )}
            </button>
          </div>
          
          {/* Code Area */}
          <textarea 
            value={code} 
            onChange={(e) => setCode(e.target.value)} 
            spellCheck={false} 
            className="flex-1 w-full p-6 bg-transparent text-slate-300 font-mono text-[15px] leading-relaxed outline-none resize-none"
            style={{ tabSize: 4 }}
          />
          
          {/* Bottom Terminal */}
          <div className="h-64 flex flex-col bg-slate-950 border-t border-slate-800 shrink-0">
            <div className="flex bg-slate-900 border-b border-slate-800">
              <button 
                onClick={() => setActiveTab('input')} 
                className={`px-6 py-3 text-sm font-bold transition-colors ${activeTab === 'input' ? 'text-cyan-400 border-b-2 border-cyan-400 bg-slate-950' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Custom Input
              </button>
              <button 
                onClick={() => setActiveTab('output')} 
                className={`px-6 py-3 text-sm font-bold transition-colors ${activeTab === 'output' ? 'text-cyan-400 border-b-2 border-cyan-400 bg-slate-950' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Console Output
              </button>
            </div>
            
            <div className="flex-1 p-4 overflow-y-auto">
              {activeTab === 'input' ? (
                <textarea 
                  value={testInput} 
                  onChange={e => setTestInput(e.target.value)} 
                  placeholder="Paste custom standard input (stdin) here..." 
                  className="w-full h-full bg-transparent text-slate-300 font-mono text-sm outline-none resize-none placeholder-slate-700"
                />
              ) : (
                <pre className={`w-full h-full font-mono text-sm whitespace-pre-wrap ${testError ? 'text-red-400' : 'text-slate-300'}`}>
                  {testError || testOutput || 'No output generated. Click "▶ Run Code" to test against custom input.'}
                </pre>
              )}
            </div>
          </div>

        </section>
      </section>
    </main>
  );
}