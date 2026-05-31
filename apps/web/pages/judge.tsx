import { useState, useRef } from 'react';
import { useSession } from 'next-auth/react';

export async function getServerSideProps() { return { props: {} }; }

const WANDBOX_URL = 'https://wandbox.org/api/compile.json';

const languageMap: Record<string, string> = {
  cpp: 'gcc-head',
  c: 'gcc-head-c',
  java: 'openjdk-head',
  python: 'cpython-head',
  javascript: 'nodejs-head'
};

const starterCode = `#include <bits/stdc++.h>\nusing namespace std;\n\nvoid solve() {\n    // Write your solution here\n}\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    solve();\n    return 0;\n}\n`;

interface TestCase {
  id: number;
  input: string;
  expectedOutput: string;
  actualOutput: string;
  error: string;
  verdict: 'PENDING' | 'ACCEPTED' | 'WRONG_ANSWER' | 'COMPILATION_ERROR' | 'RUNTIME_ERROR' | '';
}

export default function StandaloneJudgePage() {
  const { data: session } = useSession();
  const [language, setLanguage] = useState('cpp');
  const [code, setCode] = useState(starterCode);
  const [executing, setExecuting] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  
  const [testCases, setTestCases] = useState<TestCase[]>([
    { id: 1, input: '', expectedOutput: '', actualOutput: '', error: '', verdict: '' }
  ]);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState<number>(1);

  const currentTestCase = testCases.find(tc => tc.id === selectedTestCaseId) || testCases[0];
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Play sound if at least one test case passes and sound is enabled
  const playSuccessSound = () => {
    if (soundEnabled && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(e => console.log("Audio autoplay blocked by browser"));
    }
  };

  function updateCurrentTestCase(fields: Partial<TestCase>) {
    setTestCases(prev => prev.map(tc => tc.id === selectedTestCaseId ? { ...tc, ...fields } : tc));
  }

  function addNewTestCase() {
    const newId = testCases.length ? Math.max(...testCases.map(t => t.id)) + 1 : 1;
    setTestCases(prev => [...prev, { id: newId, input: '', expectedOutput: '', actualOutput: '', error: '', verdict: '' }]);
    setSelectedTestCaseId(newId);
  }

  function deleteTestCase(idToDelete: number) {
    if (testCases.length === 1) return;
    const filtered = testCases.filter(tc => tc.id !== idToDelete);
    setTestCases(filtered);
    setSelectedTestCaseId(filtered[0].id);
  }

  // 👉 Direct Frontend-to-Wandbox Execution
  async function runTestCase(tc: TestCase) {
    const compiler = languageMap[language];
    try {
      const response = await fetch(WANDBOX_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compiler: compiler,
          code: code,
          stdin: tc.input || ''
        })
      });

      if (!response.ok) throw new Error('Wandbox execution failed');
      const data = await response.json();

      let error = '';
      let verdict: TestCase['verdict'] = 'PENDING';
      
      if (data.compiler_error) {
        error = data.compiler_error;
        verdict = 'COMPILATION_ERROR';
      } else if (data.status !== '0') {
        error = data.program_error || 'Runtime error occurred';
        verdict = 'RUNTIME_ERROR';
      } else {
        const actual = String(data.program_message || '').trim().replace(/\s+/g, ' ');
        if (tc.expectedOutput) {
          const expected = String(tc.expectedOutput || '').trim().replace(/\s+/g, ' ');
          verdict = actual === expected ? 'ACCEPTED' : 'WRONG_ANSWER';
        } else {
          verdict = 'ACCEPTED'; // If no expected output, treat execution success as accepted
        }
      }

      return {
        id: tc.id,
        actualOutput: data.program_message || '',
        error: error,
        verdict: verdict
      };
    } catch (e) {
      console.error(e);
      return {
        id: tc.id,
        actualOutput: '',
        error: 'Execution platform communication link failed.',
        verdict: 'RUNTIME_ERROR' as const
      };
    }
  }

  async function runAllTestCases() {
    setExecuting(true);
    const updatedCases = [...testCases];
    let anyPassed = false;

    for (let i = 0; i < updatedCases.length; i++) {
      setSelectedTestCaseId(updatedCases[i].id);
      const result = await runTestCase(updatedCases[i]);
      
      updatedCases[i] = {
        ...updatedCases[i],
        actualOutput: result.actualOutput,
        error: result.error,
        verdict: result.verdict
      };

      if (result.verdict === 'ACCEPTED') anyPassed = true;
    }

    setTestCases(updatedCases);
    setExecuting(false);
    
    if (anyPassed) playSuccessSound();
  }

  const passedCount = testCases.filter(tc => tc.verdict === 'ACCEPTED').length;

  return (
    <main className="min-h-screen p-4 md:p-6 font-sans text-indigo-50 bg-slate-950 flex flex-col h-screen">
      
      {/* Hidden Audio Element */}
      <audio ref={audioRef} src="/accepted.mp3" preload="auto" />

      {/* 👉 THE EXECUTION OVERLAY */}
      {executing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md">
          <div className="flex flex-col items-center p-8 bg-slate-900 border border-cyan-900/50 rounded-3xl shadow-2xl">
            <div className="w-16 h-16 mb-6 border-4 border-cyan-400 border-b-transparent rounded-full animate-spin"></div>
            <h2 className="text-2xl font-black text-white mb-2 animate-pulse">Compiling Suite...</h2>
            <p className="text-cyan-200 font-mono text-sm">Running test cases against execution engine</p>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4 shrink-0">
        <a href="/" className="text-cyan-400 font-black text-xl hover:text-cyan-300 transition-colors">DivineCode Sandbox</a>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-slate-700 bg-slate-900 hover:bg-slate-800 transition-colors text-sm font-bold"
          >
            {soundEnabled ? '🔊 Sound On' : '🔇 Muted'}
          </button>
          <div className="px-4 py-2 rounded-full bg-slate-900 border border-slate-700 text-sm font-bold">
            {session?.user?.name || session?.user?.email || 'Guest Debugger'}
          </div>
        </div>
      </nav>

      {/* Main Layout: Stacks on mobile, side-by-side on lg desktop */}
      <section className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        
        {/* Left Panel: Test Cases & Judge (Scrollable independently) */}
        <aside className="w-full lg:w-5/12 flex flex-col p-5 rounded-3xl bg-slate-900/80 border border-slate-800 shadow-xl overflow-hidden shrink-0 lg:h-full">
          
          <div className="flex justify-between items-center mb-4 shrink-0">
            <h2 className="font-black text-lg">CPH JUDGE: RESULTS</h2>
            <span className="px-3 py-1 bg-cyan-900/30 text-cyan-400 rounded-lg text-sm font-bold border border-cyan-900/50">
              {passedCount} / {testCases.length} passed
            </span>
          </div>

          <div className="flex gap-2 mb-4 overflow-x-auto pb-2 shrink-0 scrollbar-thin scrollbar-thumb-slate-700">
            {testCases.map((tc, idx) => (
              <button 
                key={tc.id} 
                onClick={() => setSelectedTestCaseId(tc.id)}
                className={`whitespace-nowrap px-4 py-2 rounded-xl font-bold text-sm border transition-colors ${tc.id === selectedTestCaseId ? 'bg-slate-800 text-cyan-400 border-cyan-400/50' : 'bg-slate-950/50 text-slate-400 border-slate-800 hover:bg-slate-800'}`}
              >
                TC {idx + 1} {tc.verdict === 'ACCEPTED' ? '✅' : tc.verdict === 'WRONG_ANSWER' ? '❌' : ''}
              </button>
            ))}
            <button onClick={addNewTestCase} className="whitespace-nowrap px-4 py-2 rounded-xl font-bold text-sm bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 transition-colors">
              + New
            </button>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-3 scrollbar-thin scrollbar-thumb-slate-700">
            <div className="flex justify-between items-center mt-2">
              <h3 className="font-bold text-slate-300">Test Case Parameters</h3>
              {testCases.length > 1 && (
                <button onClick={() => deleteTestCase(currentTestCase.id)} className="px-3 py-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-xs font-bold hover:bg-red-500/20 transition-colors">
                  Wipe Case
                </button>
              )}
            </div>

            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-2">Input Data:</label>
            <textarea
              value={currentTestCase.input}
              onChange={e => updateCurrentTestCase({ input: e.target.value })}
              placeholder="Provide system stdin data..."
              className="w-full min-h-[100px] p-3 bg-slate-950 border border-slate-800 rounded-xl font-mono text-sm text-slate-300 outline-none focus:border-cyan-500/50 resize-y"
            />

            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-2">Expected Output (Optional):</label>
            <textarea
              value={currentTestCase.expectedOutput}
              onChange={e => updateCurrentTestCase({ expectedOutput: e.target.value })}
              placeholder="Provide matching assertions..."
              className="w-full min-h-[100px] p-3 bg-slate-950 border border-slate-800 rounded-xl font-mono text-sm text-slate-300 outline-none focus:border-cyan-500/50 resize-y"
            />

            {currentTestCase.verdict && (
              <div className="mt-4 animate-fadeIn">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Execution Status Output:</label>
                <pre className={`mt-1 p-3 rounded-xl font-mono text-sm whitespace-pre-wrap border ${currentTestCase.error ? 'bg-red-950/20 text-red-400 border-red-900/30' : 'bg-cyan-950/10 text-cyan-400 border-cyan-900/30'}`}>
                  {currentTestCase.error || currentTestCase.actualOutput || 'Empty system stdout returned.'}
                </pre>
              </div>
            )}
          </div>

          <button onClick={runAllTestCases} disabled={executing} className="w-full mt-4 p-4 rounded-2xl bg-gradient-to-r from-indigo-400 to-cyan-400 text-slate-950 font-black text-lg hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:scale-100 shadow-lg shadow-cyan-900/20 shrink-0">
            ⚡ Run All Test Cases
          </button>
        </aside>

        {/* Right Panel: Interactive Editor */}
        <section className="w-full lg:w-7/12 rounded-3xl bg-[#0d1117] border border-slate-800 overflow-hidden flex flex-col h-[600px] lg:h-full shadow-2xl">
          <div className="flex justify-between items-center p-4 bg-slate-900 border-b border-slate-800 shrink-0">
            <strong className="text-slate-200">Interactive Workspace</strong>
            <select value={language} onChange={e => setLanguage(e.target.value)} className="px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white outline-none focus:border-cyan-500/50 cursor-pointer">
              <option value="cpp">C++</option>
              <option value="java">Java</option>
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
              <option value="c">C</option>
            </select>
          </div>
          
          <textarea
            value={code}
            onChange={e => setCode(e.target.value)}
            spellCheck={false}
            className="flex-1 w-full p-6 bg-transparent text-slate-300 font-mono text-[15px] leading-relaxed outline-none resize-none"
            style={{ tabSize: 4 }}
          />
        </section>

      </section>
    </main>
  );
}