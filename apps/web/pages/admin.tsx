import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { motion } from 'framer-motion';
import { fetchApi } from '../lib/api';

export default function AdminDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  
  const [metrics, setMetrics] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<any[]>([]);
  const [recentContests, setRecentContests] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Tab State
  const [activeTab, setActiveTab] = useState<'reports' | 'interview' | 'plagiarism'>('reports');

  // Plagiarism Scanner State
  const [scanContestId, setScanContestId] = useState('');
  const [scanning, setScanning] = useState(false);
  const [plagiarismPairs, setPlagiarismPairs] = useState<any[] | null>(null);
  const [selectedPair, setSelectedPair] = useState<any>(null);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user?.email) {
      router.push('/signin');
      return;
    }

    const fetchAdminData = async () => {
      try {
        const [metricsData, reportsData, qData, contestsData] = await Promise.all([
          fetchApi('/api/v2/admin/metrics'),
          fetchApi('/api/v2/admin/reports'),
          fetchApi('/api/v2/interview/pending'),
          fetchApi('/api/v2/admin/contests/recent')
        ]);

        setMetrics(metricsData);
        setReports(reportsData);
        if (qData.success) setPendingQuestions(qData.questions);
        if (Array.isArray(contestsData)) {
            setRecentContests(contestsData);
            if (contestsData.length > 0) setScanContestId(contestsData[0].id);
        }
        
        setLoading(false);
      } catch (err: any) {
        setError(err.message || 'Access Denied. Ensure your email is granted ADMIN privileges.');
        setLoading(false);
      }
    };

    fetchAdminData();
  }, [session, status, router]);

  const handleDismissReport = async (reportId: string) => {
    try {
      await fetchApi(`/api/v2/admin/reports/${reportId}`, { method: 'DELETE' });
      setReports(prev => prev.filter(r => r.id !== reportId));
    } catch (err) {
      console.error("Failed to dismiss report", err);
    }
  };

  const handleApproveQuestion = async (questionId: string) => {
    try {
      await fetchApi(`/api/v2/interview/questions/${questionId}/approve`, { method: 'PATCH' });
      setPendingQuestions(prev => prev.filter(q => q.id !== questionId));
    } catch (err) {
      console.error("Failed to approve question", err);
    }
  };

  const runPlagiarismScan = async () => {
    if (!scanContestId) return;
    setScanning(true);
    setPlagiarismPairs(null);
    try {
      const res = await fetchApi(`/api/v2/admin/plagiarism/scan/${scanContestId}`);
      if (res.success) {
        setPlagiarismPairs(res.pairs);
      }
    } catch (err) {
      console.error("Scan failed", err);
    } finally {
      setScanning(false);
    }
  };

  if (loading) return <div style={{ minHeight: '100vh', background: '#020617', color: '#38bdf8', display: 'grid', placeItems: 'center' }}>Loading Command Center...</div>;

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#020617', color: '#f87171', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <h2>⚠️ Restricted Area</h2>
        <p>{error}</p>
        <button onClick={() => router.push('/')} style={{ marginTop: 20, padding: '10px 20px', background: '#1e293b', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Back to Safety</button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#020617', color: '#eef2ff', fontFamily: 'Inter, sans-serif', padding: '40px 20px' }}>
      <Head><title>Admin Command Center</title></Head>

      {/* SIDE-BY-SIDE DIFFERENTIAL MODAL */}
      {selectedPair && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(2, 6, 23, 0.9)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
          <div style={{ background: '#0f172a', width: '100%', maxWidth: 1400, height: '90%', borderRadius: 16, border: '1px solid #334155', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
            
            <div style={{ padding: '20px 30px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #334155', alignItems: 'center', background: '#1e293b' }}>
              <div>
                <h2 style={{ margin: '0 0 5px', color: '#eef2ff' }}>{selectedPair.problemTitle}</h2>
                <div style={{ color: '#f87171', fontWeight: 'bold' }}>⚠️ {selectedPair.similarity}% Structural Similarity Detected</div>
              </div>
              <button onClick={() => setSelectedPair(null)} style={{ background: '#334155', color: '#fff', border: '1px solid #475569', padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' }}>Close Inspector</button>
            </div>

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              <div style={{ flex: 1, borderRight: '1px solid #334155', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '12px 20px', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', fontWeight: 'bold', borderBottom: '1px solid #334155' }}>
                  Coder 1: @{selectedPair.userA}
                </div>
                <pre style={{ margin: 0, padding: 20, flex: 1, overflow: 'auto', color: '#cbd5e1', fontSize: 13, background: '#020617', fontFamily: 'monospace' }}>
                  {selectedPair.codeA}
                </pre>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '12px 20px', background: 'rgba(248, 113, 113, 0.1)', color: '#f87171', fontWeight: 'bold', borderBottom: '1px solid #334155' }}>
                  Coder 2: @{selectedPair.userB}
                </div>
                <pre style={{ margin: 0, padding: 20, flex: 1, overflow: 'auto', color: '#cbd5e1', fontSize: 13, background: '#020617', fontFamily: 'monospace' }}>
                  {selectedPair.codeB}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
            <div>
                <h1 style={{ margin: '0 0 8px', fontSize: 32, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 12 }}>
                    🛡️ Admin Command Center
                </h1>
                <p style={{ margin: 0, color: '#94a3b8' }}>Welcome back, Super Admin. System telemetry and reports are ready.</p>
            </div>
            <button onClick={() => router.push('/')} style={{ padding: '10px 20px', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, cursor: 'pointer' }}>
                Exit to Platform
            </button>
        </div>

        {/* Top Metric Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 30 }}>
          {[
            { label: 'Total Coders', value: metrics?.userCount || 0, color: '#a855f7' },
            { label: 'Arenas Created', value: metrics?.contestCount || 0, color: '#4ade80' },
            { label: 'Code Submissions', value: metrics?.submissionCount || 0, color: '#38bdf8' },
            { label: 'Active Flags', value: metrics?.reportCount || 0, color: '#f87171' }
          ].map((m, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} style={{ background: '#0f172a', border: '1px solid #1e293b', padding: 24, borderRadius: 16 }}>
              <div style={{ color: '#94a3b8', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{m.label}</div>
              <div style={{ fontSize: 36, fontWeight: 'bold', color: m.color }}>{m.value}</div>
            </motion.div>
          ))}
        </div>

        {/* Dynamic Data Tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
            <button 
                onClick={() => setActiveTab('reports')} 
                style={{ padding: '12px 24px', borderRadius: 8, border: 'none', background: activeTab === 'reports' ? '#38bdf8' : '#1e293b', color: activeTab === 'reports' ? '#000' : '#94a3b8', fontWeight: 'bold', cursor: 'pointer', transition: '0.2s' }}
            >
                ⚠️ Community Reports ({reports.length})
            </button>
            <button 
                onClick={() => setActiveTab('plagiarism')} 
                style={{ padding: '12px 24px', borderRadius: 8, border: 'none', background: activeTab === 'plagiarism' ? '#f87171' : '#1e293b', color: activeTab === 'plagiarism' ? '#000' : '#94a3b8', fontWeight: 'bold', cursor: 'pointer', transition: '0.2s' }}
            >
                🕵️ AST Plagiarism Scanner
            </button>
            <button 
                onClick={() => setActiveTab('interview')} 
                style={{ padding: '12px 24px', borderRadius: 8, border: 'none', background: activeTab === 'interview' ? '#a855f7' : '#1e293b', color: activeTab === 'interview' ? '#000' : '#94a3b8', fontWeight: 'bold', cursor: 'pointer', transition: '0.2s' }}
            >
                🧠 Pending AI Interviews ({pendingQuestions.length})
            </button>
        </div>

        {/* Toggled Content Area */}
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 16, overflow: 'hidden' }}>
          
          {activeTab === 'reports' && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: '#64748b', fontSize: 12, textTransform: 'uppercase', background: 'rgba(2, 6, 23, 0.5)' }}>
                      <th style={{ padding: '16px 24px' }}>Date</th>
                      <th style={{ padding: '16px 24px' }}>Reported By</th>
                      <th style={{ padding: '16px 24px' }}>Reason / Details</th>
                      <th style={{ padding: '16px 24px' }}>Submission Author</th>
                      <th style={{ padding: '16px 24px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Queue is completely clear. 🎉</td></tr>
                    ) : reports.map(report => (
                      <tr key={report.id} style={{ borderTop: '1px solid #1e293b' }}>
                        <td style={{ padding: '16px 24px', color: '#94a3b8' }}>{new Date(report.createdAt).toLocaleDateString()}</td>
                        <td style={{ padding: '16px 24px', color: '#38bdf8' }}>@{report.reporter?.username || 'Unknown'}</td>
                        <td style={{ padding: '16px 24px', color: '#e2e8f0', maxWidth: 300 }}>{report.reason}</td>
                        <td style={{ padding: '16px 24px', color: '#f87171' }}>@{report.submission?.user?.username || 'System'}</td>
                        <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                          <button onClick={() => handleDismissReport(report.id)} style={{ background: '#10b981', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' }}>
                            Dismiss
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          )}

          {activeTab === 'plagiarism' && (
            <div style={{ padding: '30px 24px' }}>
              <div style={{ display: 'flex', gap: 15, alignItems: 'center', marginBottom: 30, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 300 }}>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 13, marginBottom: 8, fontWeight: 'bold' }}>TARGET CONTEST ARENA</label>
                  <select 
                    value={scanContestId} 
                    onChange={e => setScanContestId(e.target.value)}
                    style={{ width: '100%', padding: '12px 16px', background: '#1e293b', color: '#fff', border: '1px solid #334155', borderRadius: 8, fontSize: 15, outline: 'none' }}
                  >
                    {recentContests.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.title} ({new Date(c.startTime).toLocaleDateString()})
                      </option>
                    ))}
                  </select>
                </div>
                <button 
                  onClick={runPlagiarismScan} 
                  disabled={scanning || !scanContestId}
                  style={{ alignSelf: 'flex-end', background: 'linear-gradient(135deg, #f87171, #ef4444)', color: '#fff', border: 'none', padding: '14px 30px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', fontSize: 15, whiteSpace: 'nowrap' }}
                >
                  {scanning ? '⚙️ Analyzing AST Trees...' : '🔍 Execute Deep Scan'}
                </button>
              </div>

              {plagiarismPairs !== null && (
                <div style={{ background: 'rgba(2, 6, 23, 0.5)', borderRadius: 12, border: '1px solid #1e293b', overflow: 'hidden' }}>
                  <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: '#64748b', fontSize: 12, textTransform: 'uppercase', background: 'rgba(2, 6, 23, 0.8)' }}>
                        <th style={{ padding: '16px 24px' }}>Match %</th>
                        <th style={{ padding: '16px 24px' }}>Problem Title</th>
                        <th style={{ padding: '16px 24px' }}>Coder 1</th>
                        <th style={{ padding: '16px 24px' }}>Coder 2</th>
                        <th style={{ padding: '16px 24px', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plagiarismPairs.length === 0 ? (
                        <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#4ade80', fontWeight: 'bold' }}>Scan Complete. Zero structural similarities detected. Arena is clean. ✅</td></tr>
                      ) : plagiarismPairs.map((pair, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #1e293b', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                          <td style={{ padding: '16px 24px', color: '#f87171', fontWeight: 'bold', fontSize: 16 }}>{pair.similarity}%</td>
                          <td style={{ padding: '16px 24px', color: '#eef2ff' }}>{pair.problemTitle}</td>
                          <td style={{ padding: '16px 24px', color: '#38bdf8' }}>@{pair.userA}</td>
                          <td style={{ padding: '16px 24px', color: '#38bdf8' }}>@{pair.userB}</td>
                          <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                            <button 
                              onClick={() => setSelectedPair(pair)}
                              style={{ background: '#334155', color: '#fff', border: '1px solid #475569', padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' }}
                            >
                              Inspect Code
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'interview' && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: '#64748b', fontSize: 12, textTransform: 'uppercase', background: 'rgba(2, 6, 23, 0.5)' }}>
                      <th style={{ padding: '16px 24px' }}>Submission Date</th>
                      <th style={{ padding: '16px 24px' }}>Track</th>
                      <th style={{ padding: '16px 24px' }}>Prompt / Title</th>
                      <th style={{ padding: '16px 24px' }}>Difficulty</th>
                      <th style={{ padding: '16px 24px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingQuestions.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>No pending questions to review.</td></tr>
                    ) : pendingQuestions.map(q => (
                      <tr key={q.id} style={{ borderTop: '1px solid #1e293b' }}>
                        <td style={{ padding: '16px 24px', color: '#94a3b8' }}>{new Date(q.createdAt).toLocaleDateString()}</td>
                        <td style={{ padding: '16px 24px', color: '#a855f7' }}>{q.track?.title || 'General'}</td>
                        <td style={{ padding: '16px 24px', color: '#e2e8f0' }}>{q.title}</td>
                        <td style={{ padding: '16px 24px' }}>
                            <span style={{ padding: '4px 8px', borderRadius: 4, fontSize: 12, fontWeight: 'bold', background: q.difficulty === 'Hard' ? 'rgba(248, 113, 113, 0.1)' : 'rgba(251, 191, 36, 0.1)', color: q.difficulty === 'Hard' ? '#f87171' : '#fbbf24' }}>
                                {q.difficulty}
                            </span>
                        </td>
                        <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                          <button onClick={() => handleApproveQuestion(q.id)} style={{ background: '#a855f7', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' }}>
                            Approve for AI
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          )}

        </div>
      </div>
    </div>
  );
}