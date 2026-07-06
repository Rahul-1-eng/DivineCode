/**
 * @file [id].tsx
 * @author Rahul Kumar Sahoo
 * @description Post-mortem debrief for a concluded AI Recruiter session:
 * hiring-committee verdict, per-round telemetry, and the full annotated transcript.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import toast, { Toaster } from 'react-hot-toast';
import { fetchApi } from '../../../lib/api';

const REC_META: Record<string, { label: string; color: string; bg: string }> = {
  STRONG_HIRE: { label: 'Strong Hire', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  HIRE: { label: 'Hire', color: '#4ade80', bg: 'rgba(74,222,128,0.10)' },
  LEAN_HIRE: { label: 'Lean Hire', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  NO_HIRE: { label: 'No Hire', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' }
};

const STYLES: Record<string, React.CSSProperties> = {
  main: { minHeight: '100vh', background: 'var(--bg-main-gradient)', color: 'var(--text-main)', padding: 'clamp(20px, 4vw, 50px)', boxSizing: 'border-box' },
  shell: { maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 },
  panel: { background: 'var(--bg-panel-solid)', border: '1px solid var(--border-color)', borderRadius: 20, padding: 'clamp(20px, 3vw, 32px)' },
  sectionTitle: { margin: '0 0 16px 0', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--accent-primary)', fontWeight: 800 },
  centerScreen: { minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 18, background: 'var(--bg-main)', color: 'var(--text-main)', padding: 40, textAlign: 'center' },
  pillBtn: { padding: '14px 30px', borderRadius: 999, border: 0, background: 'linear-gradient(135deg, #a5b4fc, #22d3ee)', color: '#020617', fontWeight: 800, fontSize: 15, cursor: 'pointer' }
};

function ScoreRing({ score }: { score: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const color = score >= 70 ? '#4ade80' : score >= 50 ? '#fbbf24' : '#ef4444';
  return (
    <div style={{ position: 'relative', width: 130, height: 130, flexShrink: 0 }}>
      <svg width="130" height="130" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="65" cy="65" r={radius} stroke="var(--border-color)" strokeWidth="10" fill="none" />
        <motion.circle
          cx="65" cy="65" r={radius} stroke={color} strokeWidth="10" fill="none" strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - score / 100) }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 30, fontWeight: 900, color }}>{score}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Overall</div>
        </div>
      </div>
    </div>
  );
}

function MetricBar({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const color = v >= 70 ? '#4ade80' : v >= 50 ? '#fbbf24' : '#ef4444';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
        <strong style={{ color: value === null ? 'var(--text-muted)' : color }}>{value === null ? '—' : `${v}/100`}</strong>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-main)', overflow: 'hidden' }}>
        <motion.div initial={{ width: 0 }} animate={{ width: `${v}%` }} transition={{ duration: 0.9, ease: 'easeOut' }} style={{ height: '100%', borderRadius: 3, background: color }} />
      </div>
    </div>
  );
}

export default function InterviewDebriefReport() {
  const router = useRouter();
  const { id } = router.query;

  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<{ message: string; retryable: boolean; inProgress: boolean } | null>(null);
  const [openRound, setOpenRound] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Turns the debrief into a proper .pdf. jsPDF only loads on click (dynamic
  // import) so it never sits in the page bundle.
  const downloadPdf = async () => {
    if (!data || downloading) return;
    setDownloading(true);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 48;
      const maxW = pageW - margin * 2;
      let y = margin;

      const ensure = (needed: number) => {
        if (y + needed > pageH - margin) { doc.addPage(); y = margin; }
      };
      const write = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number; indent?: number; mono?: boolean } = {}) => {
        const { size = 10.5, bold = false, color = [30, 30, 40], gap = 4, indent = 0, mono = false } = opts;
        doc.setFont(mono ? 'courier' : 'helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(size);
        doc.setTextColor(color[0], color[1], color[2]);
        const lines = doc.splitTextToSize(String(text ?? ''), maxW - indent);
        const lineH = size * 1.35;
        lines.forEach((line: string) => { ensure(lineH); doc.text(line, margin + indent, y); y += lineH; });
        y += gap;
      };
      const heading = (text: string) => {
        ensure(44);
        y += 10;
        write(text.toUpperCase(), { size: 11, bold: true, color: [99, 102, 241], gap: 3 });
        doc.setDrawColor(190, 190, 205);
        doc.line(margin, y - 2, pageW - margin, y - 2);
        y += 10;
      };

      const rep = data.report || {};
      const recLabel = (REC_META[rep.hireRecommendation] || REC_META.NO_HIRE).label;

      // Header
      write('DivineCode - AI Recruiter Interview Report', { size: 18, bold: true, gap: 2 });
      write(
        `Target: ${data.profile?.goal || '-'}  |  Field: ${data.profile?.field || '-'}  |  ${data.completedAt ? new Date(data.completedAt).toLocaleString() : ''}`,
        { size: 9.5, color: [110, 110, 125], gap: 10 }
      );

      // Verdict
      write(
        `Overall Score: ${rep.overallScore ?? '-'}/100    Committee Verdict: ${recLabel}    Result: ${data.sessionStatus === 'PASSED' ? 'LOOP CLEARED' : 'LOOP CONCLUDED'}`,
        { size: 12, bold: true, gap: 6 }
      );
      if (rep.verdictSummary) write(rep.verdictSummary, { gap: 8 });

      // Round telemetry
      heading('Round Telemetry');
      (data.stats || []).forEach((r: any) => {
        const status = r.passed === true ? 'PASSED' : r.passed === false ? 'FAILED' : 'NOT REACHED';
        write(`Round ${r.order} - ${String(r.type).replace(/_/g, ' ')}: ${status}`, { bold: true, gap: 1 });
        write(
          `${r.finalScore != null ? `Final ${r.finalScore} vs cutoff ${r.cutoffScore}` : `Cutoff ${r.cutoffScore}`}  |  Technical: ${r.avgTechnical ?? '-'}  |  Communication: ${r.avgFluency ?? '-'}  |  Answers: ${r.answersGiven}`,
          { size: 9.5, color: [110, 110, 125], indent: 12, gap: 6 }
        );
      });

      // Strengths & weaknesses
      if ((rep.strengths || []).length) {
        heading('What Worked');
        rep.strengths.forEach((s: string) => write(`+  ${s}`, { indent: 4 }));
      }
      if ((rep.weaknesses || []).length) {
        heading('Where the Loop Broke');
        rep.weaknesses.forEach((w: string) => write(`-  ${w}`, { indent: 4 }));
      }

      // Committee notes
      if ((rep.roundAnalysis || []).length) {
        heading('Committee Notes by Round');
        rep.roundAnalysis.forEach((r: any) => {
          write(`Round ${r.round}: ${r.headline}`, { bold: true, gap: 1 });
          write(r.analysis, { indent: 12, gap: 8, color: [70, 70, 85] });
        });
      }

      // Action plan
      if ((rep.actionPlan || []).length) {
        heading('Prep Plan Before the Next Loop');
        rep.actionPlan.forEach((a: string, i: number) => write(`${i + 1}.  ${a}`, { indent: 4 }));
      }

      // Full transcript
      heading('Full Transcript');
      (data.transcript || []).forEach((round: any) => {
        write(`Round ${round.order}: ${String(round.type).replace(/_/g, ' ')}`, { size: 12, bold: true, gap: 4 });
        if (round.problemStatement) write(round.problemStatement, { size: 9, color: [110, 110, 125], indent: 8, gap: 8 });
        round.turns.forEach((t: any) => {
          const speaker = t.role === 'INTERVIEWER' ? 'Interviewer' : 'Candidate';
          const scores = t.technicalScore != null ? `  [tech ${t.technicalScore} / comm ${t.fluencyScore}]` : '';
          write(`${speaker}${scores}:`, { size: 9.5, bold: true, gap: 1, indent: 8 });
          write(t.text, { size: 10, indent: 8, gap: 4 });
          if (t.codeSnapshot && !t.codeSnapshot.includes('Initialize solution architecture')) {
            write(t.codeSnapshot, { size: 8, mono: true, indent: 16, gap: 6, color: [70, 70, 85] });
          }
        });
        y += 6;
      });

      // Page footers
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(150, 150, 165);
        doc.text(`DivineCode AI Recruiter  ·  Page ${i} of ${pages}`, pageW / 2, pageH - 22, { align: 'center' });
      }

      doc.save(`DivineCode-Interview-Report-${String(id).slice(-8)}.pdf`);
      toast.success('Report PDF downloaded.', { icon: '📄' });
    } catch (err: any) {
      console.error('[Report PDF Error]', err);
      toast.error('Could not generate the PDF. Please retry.');
    } finally {
      setDownloading(false);
    }
  };

  const loadReport = async () => {
    setError(null);
    try {
      const res = await fetchApi(`/api/v2/recruiter/sessions/${id}/report`);
      setData(res);
    } catch (err: any) {
      if (err?.status === 404) {
        router.push('/recruiter');
        return;
      }
      setError({
        message: err?.message || 'Failed to load the debrief.',
        retryable: err?.retryable || err?.status === 503 || !err?.status,
        inProgress: err?.status === 409
      });
    }
  };

  useEffect(() => { if (id) loadReport(); }, [id]);

  if (error) {
    return (
      <div style={STYLES.centerScreen}>
        <div style={{ fontSize: 48 }}>{error.inProgress ? '🎙️' : '📡'}</div>
        <h2 style={{ margin: 0 }}>{error.inProgress ? 'Interview Still Live' : 'Debrief Unavailable'}</h2>
        <p style={{ color: 'var(--text-muted)', maxWidth: 440, lineHeight: 1.6, margin: 0 }}>{error.message}</p>
        <div style={{ display: 'flex', gap: 12 }}>
          {error.inProgress && (
            <button onClick={() => router.push(`/recruiter/session/${id}`)} style={STYLES.pillBtn}>Rejoin the Interview</button>
          )}
          {error.retryable && !error.inProgress && (
            <button onClick={loadReport} style={STYLES.pillBtn}>Retry</button>
          )}
          <button onClick={() => router.push('/recruiter')} style={{ ...STYLES.pillBtn, background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
            Back to Gateway
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={STYLES.centerScreen}>
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }} style={{ width: 44, height: 44, borderRadius: '50%', border: '3px solid var(--border-color)', borderTopColor: 'var(--accent-primary)' }} />
        <p style={{ color: 'var(--text-muted)' }}>The hiring committee is compiling your debrief…</p>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>(First view generates the full AI analysis — this can take ~20 seconds.)</p>
      </div>
    );
  }

  const report = data.report || {};
  const rec = REC_META[report.hireRecommendation] || REC_META.NO_HIRE;
  const passed = data.sessionStatus === 'PASSED';

  return (
    <main style={STYLES.main}>
      <Toaster position="bottom-right" />
      <div style={STYLES.shell}>

        {/* Verdict Banner */}
        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} style={{ ...STYLES.panel, display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
          <ScoreRing score={report.overallScore ?? 0} />
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
              <h1 style={{ margin: 0, fontSize: 'clamp(22px, 3.5vw, 30px)', fontWeight: 900 }}>
                {passed ? '🎉 Loop Cleared' : '📉 Loop Concluded'}
              </h1>
              <span style={{ padding: '6px 16px', borderRadius: 999, fontSize: 13, fontWeight: 800, color: rec.color, background: rec.bg, border: `1px solid ${rec.color}44` }}>
                Committee: {rec.label}
              </span>
              <button
                onClick={downloadPdf}
                disabled={downloading}
                style={{ marginLeft: 'auto', padding: '8px 18px', borderRadius: 999, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-main)', fontWeight: 700, fontSize: 13, cursor: downloading ? 'wait' : 'pointer', opacity: downloading ? 0.6 : 1 }}
              >
                {downloading ? 'Preparing…' : '📄 Download PDF'}
              </button>
            </div>
            <p style={{ margin: 0, color: 'var(--text-main)', lineHeight: 1.7, fontSize: 15 }}>{report.verdictSummary}</p>
            <p style={{ margin: '10px 0 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
              Target: {data.profile?.goal} · {data.completedAt ? new Date(data.completedAt).toLocaleString() : ''}
            </p>
          </div>
        </motion.section>

        {/* Per-Round Telemetry */}
        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} style={STYLES.panel}>
          <h2 style={STYLES.sectionTitle}>Round Telemetry</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: 16 }}>
            {(data.stats || []).map((r: any) => (
              <div key={r.order} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 14 }}>R{r.order} · {String(r.type).replace(/_/g, ' ')}</strong>
                  <span style={{ fontSize: 12, fontWeight: 800, color: r.passed === true ? '#4ade80' : r.passed === false ? '#ef4444' : 'var(--text-muted)' }}>
                    {r.passed === true ? 'PASSED' : r.passed === false ? 'FAILED' : 'NOT REACHED'}
                  </span>
                </div>
                <MetricBar label="Technical" value={r.avgTechnical} />
                <MetricBar label="Communication" value={r.avgFluency} />
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {r.finalScore != null ? `Final ${r.finalScore} vs cutoff ${r.cutoffScore}` : `Cutoff ${r.cutoffScore}`} · {r.answersGiven} answer{r.answersGiven === 1 ? '' : 's'}
                </div>
              </div>
            ))}
          </div>
        </motion.section>

        {/* Strengths & Weaknesses */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 24 }}>
          <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }} style={STYLES.panel}>
            <h2 style={{ ...STYLES.sectionTitle, color: '#4ade80' }}>What Worked</h2>
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(report.strengths || []).map((s: string, i: number) => (
                <li key={i} style={{ display: 'flex', gap: 10, lineHeight: 1.6, fontSize: 14.5 }}>
                  <span style={{ color: '#4ade80', flexShrink: 0 }}>✔</span> {s}
                </li>
              ))}
            </ul>
          </motion.section>
          <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }} style={STYLES.panel}>
            <h2 style={{ ...STYLES.sectionTitle, color: '#ef4444' }}>Where the Loop Broke</h2>
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(report.weaknesses || []).map((w: string, i: number) => (
                <li key={i} style={{ display: 'flex', gap: 10, lineHeight: 1.6, fontSize: 14.5 }}>
                  <span style={{ color: '#ef4444', flexShrink: 0 }}>✘</span> {w}
                </li>
              ))}
            </ul>
          </motion.section>
        </div>

        {/* Round-by-Round Analysis */}
        {(report.roundAnalysis || []).length > 0 && (
          <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }} style={STYLES.panel}>
            <h2 style={STYLES.sectionTitle}>Committee Notes by Round</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {report.roundAnalysis.map((r: any) => (
                <div key={r.round} style={{ borderLeft: '3px solid var(--accent-primary)', paddingLeft: 16 }}>
                  <strong style={{ display: 'block', fontSize: 15, marginBottom: 4 }}>Round {r.round}: {r.headline}</strong>
                  <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 1.7, fontSize: 14 }}>{r.analysis}</p>
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {/* Action Plan */}
        {(report.actionPlan || []).length > 0 && (
          <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }} style={STYLES.panel}>
            <h2 style={STYLES.sectionTitle}>Your Prep Plan Before the Next Loop</h2>
            <ol style={{ margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 10, lineHeight: 1.6, fontSize: 14.5 }}>
              {report.actionPlan.map((a: string, i: number) => <li key={i}>{a}</li>)}
            </ol>
          </motion.section>
        )}

        {/* Full Transcript */}
        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} style={STYLES.panel}>
          <h2 style={STYLES.sectionTitle}>Full Transcript Archive</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(data.transcript || []).map((round: any) => (
              <div key={round.order} style={{ border: '1px solid var(--border-color)', borderRadius: 12, overflow: 'hidden' }}>
                <button
                  onClick={() => setOpenRound(openRound === round.order ? null : round.order)}
                  style={{ width: '100%', padding: '14px 18px', background: 'var(--bg-card)', border: 'none', color: 'var(--text-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
                >
                  <span>Round {round.order}: {String(round.type).replace(/_/g, ' ')} ({round.turns.length} turns)</span>
                  <span>{openRound === round.order ? '▲' : '▼'}</span>
                </button>
                {openRound === round.order && (
                  <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--bg-main)' }}>
                    {round.problemStatement && (
                      <div style={{ padding: 14, borderRadius: 10, background: 'var(--bg-card)', border: '1px dashed var(--border-color)', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text-muted)' }}>
                        {round.problemStatement}
                      </div>
                    )}
                    {round.turns.map((t: any, i: number) => (
                      <div key={i} style={{ padding: 12, borderRadius: 10, background: t.role === 'INTERVIEWER' ? 'var(--bg-card)' : 'rgba(165,180,252,0.08)', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                          <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: t.role === 'INTERVIEWER' ? 'var(--accent-primary)' : '#a5b4fc' }}>
                            {t.role === 'INTERVIEWER' ? 'Interviewer' : 'You'}
                          </strong>
                          {t.technicalScore != null && (
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>tech {t.technicalScore} · comm {t.fluencyScore}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 14, lineHeight: 1.6 }}>{t.text}</div>
                        {t.codeSnapshot && !t.codeSnapshot.includes('Initialize solution architecture') && (
                          <pre style={{ marginTop: 10, marginBottom: 0, padding: 12, borderRadius: 8, background: '#0a0a0a', color: '#e2e8f0', fontSize: 12, overflowX: 'auto' }}>{t.codeSnapshot}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </motion.section>

        {/* CTA */}
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', paddingBottom: 30 }}>
          <button onClick={() => router.push('/recruiter')} style={STYLES.pillBtn}>🎯 Run Another Loop</button>
          <button onClick={downloadPdf} disabled={downloading} style={{ ...STYLES.pillBtn, background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-main)', cursor: downloading ? 'wait' : 'pointer', opacity: downloading ? 0.6 : 1 }}>
            {downloading ? 'Preparing…' : '📄 Download PDF'}
          </button>
          <button onClick={() => router.push('/')} style={{ ...STYLES.pillBtn, background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}>Home</button>
        </div>
      </div>
    </main>
  );
}
