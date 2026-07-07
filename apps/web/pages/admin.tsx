/**
 * @file admin.tsx
 * @author Rahul Kumar Sahoo
 * @description Page-level experience and view logic.
 */

import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { motion } from 'framer-motion';
import { fetchApi } from '../lib/api';
import ContextLoader from '../components/ContextLoader';

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
  const [activeTab, setActiveTab] = useState<'reports' | 'interview' | 'plagiarism' | 'monitor' | 'feedback'>('reports');

  // Plagiarism Scanner State
  const [scanContestId, setScanContestId] = useState('');
  const [scanning, setScanning] = useState(false);
  const [plagiarismPairs, setPlagiarismPairs] = useState<any[] | null>(null);
  const [selectedPair, setSelectedPair] = useState<any>(null);

  // Live Monitoring + Moderation State — the Monitoring tab is the single
  // place where the admin watches what every user is doing and blocks them.
  const [users, setUsers] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const userSearchRef = useRef('');
  const [monitor, setMonitor] = useState<{ online: any[]; events: any[] } | null>(null);
  const [banTarget, setBanTarget] = useState<any>(null);
  const [banHours, setBanHours] = useState('24');
  const [banReason, setBanReason] = useState('');

  // Feedback + Email Health State
  const [feedbackData, setFeedbackData] = useState<{ feedbacks: any[]; summary: any[] } | null>(null);
  const [emailStatus, setEmailStatus] = useState<string>('');

  const loadUsers = async (search = '') => {
    try {
      const data = await fetchApi(`/api/v2/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`);
      if (Array.isArray(data)) setUsers(data);
    } catch (err) { console.error('Failed to load users', err); }
  };

  const loadMonitor = async (search = '') => {
    try {
      const data = await fetchApi(`/api/v2/admin/monitor${search ? `?search=${encodeURIComponent(search)}` : ''}`);
      if (data.success) setMonitor({ online: data.online, events: data.events });
    } catch (err) { console.error('Failed to load monitor feed', err); }
  };

  const runMonitorSearch = () => {
    userSearchRef.current = userSearch;
    loadMonitor(userSearch);
    loadUsers(userSearch);
  };

  useEffect(() => {
    if (activeTab === 'feedback' && !feedbackData) {
      fetchApi('/api/v2/feedback/all').then(res => { if (res.success) setFeedbackData(res); }).catch(() => {});
    }
  }, [activeTab]);

  // The Monitoring tab is live: refresh the feed every 5s while it is open.
  useEffect(() => {
    if (activeTab !== 'monitor') return;
    loadMonitor(userSearchRef.current);
    loadUsers(userSearchRef.current);
    const timer = setInterval(() => loadMonitor(userSearchRef.current), 5000);
    return () => clearInterval(timer);
  }, [activeTab]);

  const handleBlock = async () => {
    if (!banTarget) return;
    try {
      await fetchApi(`/api/v2/admin/users/${banTarget.id}/block`, {
        method: 'POST',
        body: JSON.stringify({ durationHours: Number(banHours) || 0, reason: banReason })
      });
      setBanTarget(null);
      setBanReason('');
      loadUsers(userSearch);
      loadMonitor(userSearch);
    } catch (err: any) { alert(err.message || 'Block failed'); }
  };

  const handleUnblock = async (userId: string) => {
    try {
      await fetchApi(`/api/v2/admin/users/${userId}/unblock`, { method: 'POST' });
      loadUsers(userSearch);
      loadMonitor(userSearch);
    } catch (err: any) { alert(err.message || 'Unblock failed'); }
  };

  // "3m ago" style timestamps for the live feed
  const timeAgo = (ts: number) => {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 10) return 'just now';
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(ts).toLocaleString();
  };

  const checkEmailHealth = async (withTest: boolean) => {
    setEmailStatus('Checking Gmail pipeline…');
    try {
      const res = await fetchApi(`/api/v2/admin/email/health${withTest ? '?test=1' : ''}`);
      if (!res.configured) setEmailStatus('❌ Not configured — GMAIL_USER / GMAIL_APP_PASSWORD are missing on the server.');
      else if (!res.verified) setEmailStatus(`❌ SMTP login FAILED: ${res.error || 'unknown error'}`);
      else if (withTest && res.testSent) setEmailStatus('✅ SMTP verified AND a real test mail was delivered to the admin inbox. Gmail service is working.');
      else if (withTest && !res.testSent) setEmailStatus(`⚠️ SMTP login OK but the test send failed: ${res.error || 'unknown error'}`);
      else setEmailStatus('✅ SMTP login verified. Gmail service is configured correctly.');
    } catch (err: any) {
      setEmailStatus(`❌ Health check failed: ${err.message || 'network error'}`);
    }
  };

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

  const handleDeleteQuestion = async (questionId: string) => {
    if (!confirm('Are you sure you want to permanently delete this pending question?')) return;
    try {
      await fetchApi(`/api/v2/interview/questions/${questionId}`, { method: 'DELETE' });
      setPendingQuestions(prev => prev.filter(q => q.id !== questionId));
    } catch (err) {
      console.error("Failed to delete question", err);
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

  if (loading) return <div style={{ minHeight: '100vh', background: '#020617', color: '#38bdf8', display: 'grid', placeItems: 'center' }}><ContextLoader label="Opening command center…" /></div>;

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
            <button
                onClick={() => setActiveTab('monitor')}
                style={{ padding: '12px 24px', borderRadius: 8, border: 'none', background: activeTab === 'monitor' ? '#fbbf24' : '#1e293b', color: activeTab === 'monitor' ? '#000' : '#94a3b8', fontWeight: 'bold', cursor: 'pointer', transition: '0.2s' }}
            >
                🛰️ Live Monitoring{monitor ? ` (${monitor.online.length} online)` : ''}
            </button>
            <button
                onClick={() => setActiveTab('feedback')}
                style={{ padding: '12px 24px', borderRadius: 8, border: 'none', background: activeTab === 'feedback' ? '#4ade80' : '#1e293b', color: activeTab === 'feedback' ? '#000' : '#94a3b8', fontWeight: 'bold', cursor: 'pointer', transition: '0.2s' }}
            >
                ⭐ Feedback & Email
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
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                            <button onClick={() => handleApproveQuestion(q.id)} style={{ background: '#a855f7', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' }}>
                              Approve
                            </button>
                            <button onClick={() => handleDeleteQuestion(q.id)} style={{ background: 'transparent', color: '#f87171', border: '1px solid rgba(248,113,113,0.5)', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' }}>
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          )}

          {activeTab === 'monitor' && (
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && runMonitorSearch()}
                  placeholder="Filter by username or email…"
                  style={{ flex: 1, minWidth: 240, padding: '12px 16px', background: '#1e293b', color: '#fff', border: '1px solid #334155', borderRadius: 8, outline: 'none' }}
                />
                <button onClick={runMonitorSearch} style={{ background: '#fbbf24', color: '#000', border: 'none', padding: '12px 24px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>Search</button>
                <span style={{ color: '#4ade80', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 8px #4ade80' }} />
                  Live — refreshes every 5s
                </span>
              </div>

              {/* WHO IS ONLINE RIGHT NOW */}
              <h3 style={{ margin: '0 0 12px', color: '#eef2ff' }}>🟢 Online Now ({monitor?.online.length || 0})</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 28 }}>
                {!monitor || monitor.online.length === 0 ? (
                  <div style={{ color: '#94a3b8', padding: '16px 0', gridColumn: '1 / -1' }}>No users active in the last 5 minutes. Activity appears here the moment anyone touches the platform.</div>
                ) : monitor.online.map(u => (
                  <div key={u.email} style={{ background: 'rgba(2,6,23,0.5)', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ color: '#38bdf8', fontWeight: 'bold' }}>@{u.username} {u.role === 'ADMIN' && <span style={{ color: '#fbbf24', fontSize: 11 }}>ADMIN</span>}</span>
                      <span style={{ color: '#64748b', fontSize: 12 }}>{timeAgo(u.lastSeen)}</span>
                    </div>
                    <div style={{ color: '#e2e8f0', fontSize: 13, marginBottom: 10 }}>{u.lastAction}</div>
                    {u.isBanned && <div style={{ color: '#f87171', fontSize: 12, fontWeight: 'bold', marginBottom: 8 }}>⛔ Blocked</div>}
                    {u.role !== 'ADMIN' && u.userId && (u.isBanned
                      ? <button onClick={() => handleUnblock(u.userId)} style={{ background: '#10b981', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 12 }}>Unblock</button>
                      : <button onClick={() => { setBanTarget({ id: u.userId, username: u.username }); setBanHours('24'); setBanReason(''); }} style={{ background: 'transparent', color: '#f87171', border: '1px solid rgba(248,113,113,0.5)', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 12 }}>Block…</button>)}
                  </div>
                ))}
              </div>

              {/* LIVE ACTIVITY STREAM */}
              <h3 style={{ margin: '0 0 12px', color: '#eef2ff' }}>📡 Activity Stream</h3>
              <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto', border: '1px solid #1e293b', borderRadius: 12, marginBottom: 28 }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: '#64748b', fontSize: 12, textTransform: 'uppercase', background: 'rgba(2, 6, 23, 0.8)', position: 'sticky', top: 0 }}>
                      <th style={{ padding: '12px 16px' }}>When</th>
                      <th style={{ padding: '12px 16px' }}>User</th>
                      <th style={{ padding: '12px 16px' }}>Activity</th>
                      <th style={{ padding: '12px 16px' }}>Endpoint</th>
                      <th style={{ padding: '12px 16px', textAlign: 'right' }}>Moderation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!monitor || monitor.events.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No activity captured yet. This feed fills up as users work — submissions, interviews, payments, chats, everything.</td></tr>
                    ) : monitor.events.map(e => (
                      <tr key={e.id} style={{ borderTop: '1px solid #1e293b' }}>
                        <td style={{ padding: '10px 16px', color: '#94a3b8', whiteSpace: 'nowrap', fontSize: 13 }}>{timeAgo(e.at)}</td>
                        <td style={{ padding: '10px 16px', color: e.isBanned ? '#f87171' : '#38bdf8', fontWeight: 'bold', fontSize: 13 }}>@{e.username}{e.isBanned ? ' ⛔' : ''}</td>
                        <td style={{ padding: '10px 16px', color: '#e2e8f0', fontSize: 13 }}>{e.action}</td>
                        <td style={{ padding: '10px 16px', color: '#64748b', fontFamily: 'monospace', fontSize: 12 }}>{e.method} {e.path.replace('/api/v2', '')}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                          {e.role !== 'ADMIN' && e.userId && (e.isBanned
                            ? <button onClick={() => handleUnblock(e.userId)} style={{ background: '#10b981', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 12 }}>Unblock</button>
                            : <button onClick={() => { setBanTarget({ id: e.userId, username: e.username }); setBanHours('24'); setBanReason(''); }} style={{ background: 'transparent', color: '#f87171', border: '1px solid rgba(248,113,113,0.5)', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 12 }}>Block…</button>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* FULL USER DIRECTORY (offline users can be blocked from here too) */}
              <h3 style={{ margin: '0 0 12px', color: '#eef2ff' }}>👥 All Users</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: '#64748b', fontSize: 12, textTransform: 'uppercase', background: 'rgba(2, 6, 23, 0.5)' }}>
                      <th style={{ padding: '14px 18px' }}>User</th>
                      <th style={{ padding: '14px 18px' }}>Email</th>
                      <th style={{ padding: '14px 18px' }}>Status</th>
                      <th style={{ padding: '14px 18px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <tr><td colSpan={4} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No users loaded. Try a search.</td></tr>
                    ) : users.map(u => (
                      <tr key={u.id} style={{ borderTop: '1px solid #1e293b' }}>
                        <td style={{ padding: '14px 18px', color: '#38bdf8', fontWeight: 'bold' }}>@{u.username} {u.role === 'ADMIN' && <span style={{ color: '#fbbf24', fontSize: 11 }}>ADMIN</span>}</td>
                        <td style={{ padding: '14px 18px', color: '#94a3b8' }}>{u.email}</td>
                        <td style={{ padding: '14px 18px' }}>
                          {u.isBanned
                            ? <span style={{ color: '#f87171', fontWeight: 'bold' }}>⛔ Blocked until {new Date(u.bannedUntil).toLocaleString()}<br /><span style={{ fontWeight: 400, fontSize: 12 }}>{u.banReason}</span></span>
                            : <span style={{ color: '#4ade80' }}>● Active</span>}
                        </td>
                        <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                          {u.role !== 'ADMIN' && (u.isBanned
                            ? <button onClick={() => handleUnblock(u.id)} style={{ background: '#10b981', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 13 }}>Unblock</button>
                            : <button onClick={() => { setBanTarget(u); setBanHours('24'); setBanReason(''); }} style={{ background: 'transparent', color: '#f87171', border: '1px solid rgba(248,113,113,0.5)', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 13 }}>Block…</button>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'feedback' && (
            <div style={{ padding: '24px' }}>
              {/* Gmail pipeline health */}
              <div style={{ background: 'rgba(2,6,23,0.5)', border: '1px solid #1e293b', borderRadius: 12, padding: 20, marginBottom: 24 }}>
                <h3 style={{ margin: '0 0 12px', color: '#eef2ff' }}>📬 Gmail Service Health</h3>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                  <button onClick={() => checkEmailHealth(false)} style={{ background: '#334155', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>Verify SMTP Login</button>
                  <button onClick={() => checkEmailHealth(true)} style={{ background: '#4ade80', color: '#000', border: 'none', padding: '10px 20px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>Send Real Test Email</button>
                </div>
                {emailStatus && <div style={{ color: '#e2e8f0', fontSize: 14, lineHeight: 1.6 }}>{emailStatus}</div>}
              </div>

              {/* Star averages */}
              {feedbackData?.summary && feedbackData.summary.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24 }}>
                  {feedbackData.summary.map((s: any) => (
                    <div key={s.kind} style={{ background: 'rgba(2,6,23,0.5)', border: '1px solid #1e293b', borderRadius: 12, padding: 18 }}>
                      <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>{s.kind.replace('_', ' ')}</div>
                      <div style={{ fontSize: 28, fontWeight: 900, color: '#fbbf24' }}>⭐ {Number(s._avg?.rating || 0).toFixed(1)}</div>
                      <div style={{ color: '#64748b', fontSize: 12 }}>{s._count?._all || 0} responses</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Feedback stream */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: '#64748b', fontSize: 12, textTransform: 'uppercase', background: 'rgba(2, 6, 23, 0.5)' }}>
                      <th style={{ padding: '14px 18px' }}>Date</th>
                      <th style={{ padding: '14px 18px' }}>User</th>
                      <th style={{ padding: '14px 18px' }}>Experience</th>
                      <th style={{ padding: '14px 18px' }}>Rating</th>
                      <th style={{ padding: '14px 18px' }}>Comments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!feedbackData || feedbackData.feedbacks.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No feedback yet.</td></tr>
                    ) : feedbackData.feedbacks.map((f: any) => (
                      <tr key={f.id} style={{ borderTop: '1px solid #1e293b' }}>
                        <td style={{ padding: '14px 18px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{new Date(f.createdAt).toLocaleDateString()}</td>
                        <td style={{ padding: '14px 18px', color: '#38bdf8' }}>@{f.user?.username}</td>
                        <td style={{ padding: '14px 18px', color: '#a855f7', fontSize: 13 }}>{f.kind.replace('_', ' ')}</td>
                        <td style={{ padding: '14px 18px', color: '#fbbf24', fontWeight: 'bold' }}>{'⭐'.repeat(f.rating)}</td>
                        <td style={{ padding: '14px 18px', color: '#e2e8f0', maxWidth: 340 }}>{f.comments || <span style={{ color: '#475569' }}>—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* BLOCK USER MODAL */}
      {banTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.85)', zIndex: 1100, display: 'grid', placeItems: 'center', padding: 20 }}>
          <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 16, padding: 28, width: '100%', maxWidth: 440 }}>
            <h3 style={{ margin: '0 0 6px', color: '#f87171' }}>⛔ Block @{banTarget.username}</h3>
            <p style={{ margin: '0 0 18px', color: '#94a3b8', fontSize: 14 }}>The user is emailed the reason and duration. All their write actions are rejected until the block lifts.</p>

            <label style={{ display: 'block', color: '#94a3b8', fontSize: 13, marginBottom: 6, fontWeight: 'bold' }}>DURATION</label>
            <select value={banHours} onChange={e => setBanHours(e.target.value)} style={{ width: '100%', padding: '12px 14px', background: '#1e293b', color: '#fff', border: '1px solid #334155', borderRadius: 8, marginBottom: 16 }}>
              <option value="1">1 hour</option>
              <option value="24">24 hours</option>
              <option value="72">3 days</option>
              <option value="168">1 week</option>
              <option value="720">30 days</option>
              <option value="0">Permanent</option>
            </select>

            <label style={{ display: 'block', color: '#94a3b8', fontSize: 13, marginBottom: 6, fontWeight: 'bold' }}>REASON (sent to the user)</label>
            <textarea value={banReason} onChange={e => setBanReason(e.target.value)} rows={3} placeholder="e.g. Plagiarized contest submissions" style={{ width: '100%', boxSizing: 'border-box', padding: 12, background: '#1e293b', color: '#fff', border: '1px solid #334155', borderRadius: 8, resize: 'vertical', marginBottom: 20 }} />

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setBanTarget(null)} style={{ flex: 1, background: 'transparent', border: '1px solid #334155', color: '#94a3b8', padding: '12px 0', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleBlock} style={{ flex: 2, background: '#ef4444', color: '#fff', border: 'none', padding: '12px 0', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>Block User</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}