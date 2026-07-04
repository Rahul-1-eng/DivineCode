/**
 * @file index.tsx
 * @author Rahul Kumar Sahoo
 * @description Page-level experience and view logic.
 */

import { CSSProperties, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import { fetchApi } from '../../lib/api';

function getDynamicStatus(contest: any) {
  const start = new Date(contest.startTime).getTime();
  const end = start + (contest.durationMinutes * 60000);
  const now = Date.now();
  if (now > end) return 'ENDED';
  if (now >= start) return 'RUNNING';
  return 'SCHEDULED';
}

export default function ContestsList() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [contests, setContests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'loading') return;

    fetchApi('/api/v2/contests', { requireAuth: !!session })
      .then(data => {
        if (Array.isArray(data)) setContests(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load contests:", err);
        setLoading(false);
      });
  }, [session, status]);

  const running = contests.filter(c => getDynamicStatus(c) === 'RUNNING');
  const scheduled = contests.filter(c => getDynamicStatus(c) === 'SCHEDULED');
  const ended = contests.filter(c => getDynamicStatus(c) === 'ENDED');

  const ContestCard = ({ contest }: { contest: any }) => (
    <motion.div 
      whileHover={{ scale: 1.02, borderColor: 'var(--accent-primary)' }}
      onClick={() => router.push(`/contests/${contest.id}`)}
      style={cardStyle}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: 20 }}>{contest.title}</h3>
        {getDynamicStatus(contest) === 'RUNNING' && <span style={badgeLive}>🔴 Live</span>}
        {getDynamicStatus(contest) === 'SCHEDULED' && <span style={badgeScheduled}>⏳ Scheduled</span>}
        {getDynamicStatus(contest) === 'ENDED' && <span style={badgeEnded}>✅ Ended</span>}
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 16px 0', minHeight: 40, lineHeight: 1.5 }}>
        {contest.description || 'No description provided.'}
      </p>
      <div style={{ display: 'flex', gap: 16, color: 'var(--text-main)', fontSize: 13, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>⏱️ {contest.durationMinutes} mins</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>👥 {contest.membersCount || 0} Players</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>📝 {contest.problemsCount || 0} Problems</span>
      </div>
    </motion.div>
  );

  return (
    <main style={pageStyle}>
      <nav style={navStyle}>
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-main)', textDecoration: 'none', fontWeight: 900, fontSize: 'clamp(18px, 4vw, 24px)' }}>
          <img src="/logo.png" alt="DivineCode Logo" style={{ width: 32, height: 32, objectFit: 'contain' }} />
          DivineCode Arena
        </a>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <a href="/contests/create" style={primaryBtn}>+ Create Mashup</a>
          <div style={{ background: 'var(--bg-panel-solid)', padding: '8px 16px', borderRadius: 20, color: 'var(--text-main)', border: '1px solid var(--border-color)', fontSize: 14, fontWeight: 'bold' }}>
            {session?.user?.name || 'Guest'}
          </div>
        </div>
      </nav>

      <section style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ padding: 'clamp(20px, 4vw, 40px) 0', borderBottom: '1px solid var(--border-color)', marginBottom: 40 }}>
          <h1 style={{ fontSize: 'clamp(32px, 6vw, 48px)', margin: '0 0 16px 0', color: 'var(--text-main)' }}>Verified Arena</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 'clamp(14px, 2.5vw, 18px)', maxWidth: 600, lineHeight: 1.6 }}>
            Compete in Codeforces-style synchronized mashups with live standings, AI moderation, and anti-cheat verification.
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '100px 0', color: 'var(--accent-primary)' }}>
             <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} style={{ width: 40, height: 40, border: '3px solid var(--accent-glow)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', margin: '0 auto 16px' }} />
             Loading Contests...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
            
            {running.length > 0 && (
              <div>
                <h2 style={{ color: '#f87171', display: 'flex', alignItems: 'center', gap: 8 }}><span style={pulseDot} /> Live Now</h2>
                <div style={gridStyle}>
                  {running.map(c => <ContestCard key={c.id} contest={c} />)}
                </div>
              </div>
            )}

            {scheduled.length > 0 && (
              <div>
                <h2 style={{ color: '#fbbf24', margin: '0 0 20px 0' }}>⏳ Upcoming Contests</h2>
                <div style={gridStyle}>
                  {scheduled.map(c => <ContestCard key={c.id} contest={c} />)}
                </div>
              </div>
            )}

            {ended.length > 0 && (
              <div>
                <h2 style={{ color: 'var(--text-muted)', margin: '0 0 20px 0' }}>📚 Past Contests & Practice</h2>
                <div style={gridStyle}>
                  {ended.map(c => <ContestCard key={c.id} contest={c} />)}
                </div>
              </div>
            )}

            {contests.length === 0 && (
              <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--bg-panel)', borderRadius: 24, border: '1px dashed var(--border-color)' }}>
                <h3 style={{ color: 'var(--text-main)', fontSize: 24, margin: '0 0 10px 0' }}>No Contests Found</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>There are currently no active or scheduled mashups in the arena.</p>
                <a href="/contests/create" style={primaryBtn}>Create the first one</a>
              </div>
            )}

          </div>
        )}
      </section>

      {/* Global Footer appended to match the rest of the application */}
      <footer style={{ background: 'var(--bg-panel)', borderTop: '1px solid var(--border-color)', padding: 'clamp(24px, 5vw, 60px) clamp(12px, 3vw, 20px)', marginTop: '60px', backdropFilter: 'blur(10px)', position: 'relative', zIndex: 10, borderRadius: '24px 24px 0 0' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'clamp(24px, 4vw, 40px)' }}>
          <div>
            <h3 style={{ color: 'var(--text-main)', fontSize: 'clamp(14px, 2.5vw, 18px)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <img src="/logo.png" alt="DivineCode Logo" style={{ width: 28, height: 28, objectFit: 'contain' }} /> 
              DivineCode
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 'clamp(12px, 2vw, 13px)', lineHeight: 1.6 }}>The ultimate OS for competitive programmers.</p>
          </div>

          <div>
            <h4 style={{ color: 'var(--text-main)', marginBottom: 12, fontSize: 'clamp(12px, 2vw, 14px)' }}>Features</h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[['Mashup Arena', '/contests'], ['1v1 Duels', '/duel'], ['AI Workspace', '/practice'], ['Interview Prep', '/interview']].map(([label, href]) => (
                <li key={href}><a href={href} style={{ color: 'var(--text-muted)', textDecoration: 'none', transition: '0.2s', fontSize: 'clamp(11px, 2vw, 12px)' }}>{label}</a></li>
              ))}
            </ul>
          </div>

          <div>
            <h4 style={{ color: 'var(--text-main)', marginBottom: 12, fontSize: 'clamp(12px, 2vw, 14px)' }}>Resources</h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                ['GitHub Repository', 'https://github.com/Rahul-1-eng/DivineCode'], 
                ['Architecture Docs', 'https://github.com/Rahul-1-eng/DivineCode/blob/main/README.md'], 
                ['Deployment Guide', 'https://github.com/Rahul-1-eng/DivineCode/blob/main/DEPLOYMENT.md']
              ].map(([label, href]) => (
                <li key={label}>
                  <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--text-muted)', textDecoration: 'none', transition: '0.2s', fontSize: 'clamp(11px, 2vw, 12px)' }}>
                    {label} ↗
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div style={{ maxWidth: 1180, margin: '24px auto 0', paddingTop: 16, borderTop: '1px solid var(--border-color)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'clamp(10px, 2vw, 12px)' }}>
          &copy; {new Date().getFullYear()} DivineCode. All rights reserved.
        </div>
      </footer>
    </main>
  );
}

// Styles
const pageStyle: CSSProperties = { minHeight: '100vh', padding: 'clamp(16px, 4vw, 32px)', fontFamily: 'Inter, sans-serif', color: 'var(--text-main)', background: 'var(--bg-main)', boxSizing: 'border-box' };
const navStyle: CSSProperties = { maxWidth: 1120, margin: '0 auto 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 };
const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 };
const cardStyle: CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border-color)', padding: 24, borderRadius: 20, cursor: 'pointer', transition: 'border-color 0.2s', boxShadow: '0 10px 30px rgba(0,0,0,0.05)' };
const primaryBtn: CSSProperties = { background: 'var(--accent-primary)', color: '#000', padding: '10px 20px', borderRadius: 999, fontWeight: 'bold', textDecoration: 'none', display: 'inline-block', fontSize: 14 };

const badgeLive: CSSProperties = { background: 'rgba(248, 113, 113, 0.1)', color: '#f87171', padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(248, 113, 113, 0.4)', fontSize: 12, fontWeight: 'bold' };
const badgeScheduled: CSSProperties = { background: 'rgba(251, 191, 36, 0.1)', color: '#fbbf24', padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(251, 191, 36, 0.4)', fontSize: 12, fontWeight: 'bold' };
const badgeEnded: CSSProperties = { background: 'var(--bg-panel-solid)', color: 'var(--text-muted)', padding: '4px 10px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 12, fontWeight: 'bold' };

const pulseDot: CSSProperties = { display: 'inline-block', width: 10, height: 10, background: '#f87171', borderRadius: '50%', boxShadow: '0 0 10px #f87171' };