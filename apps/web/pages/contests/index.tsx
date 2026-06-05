import { CSSProperties, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

export default function ContestsList() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [contests, setContests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_V2_BASE_URL}/contests`, {
      headers: { 'x-user-email': session?.user?.email || '' }
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setContests(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, [session]);

  const running = contests.filter(c => c.status === 'RUNNING');
  const scheduled = contests.filter(c => c.status === 'SCHEDULED');
  const ended = contests.filter(c => c.status === 'ENDED');

  const ContestCard = ({ contest }: { contest: any }) => (
    <motion.div 
      whileHover={{ scale: 1.02 }}
      onClick={() => router.push(`/contests/${contest.id}`)}
      style={cardStyle}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <h3 style={{ margin: 0, color: '#eef2ff', fontSize: 20 }}>{contest.title}</h3>
        {contest.status === 'RUNNING' && <span style={badgeLive}>🔴 Live</span>}
        {contest.status === 'SCHEDULED' && <span style={badgeScheduled}>⏳ Scheduled</span>}
        {contest.status === 'ENDED' && <span style={badgeEnded}>✅ Ended</span>}
      </div>
      <p style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 16px 0', minHeight: 40 }}>
        {contest.description || 'No description provided.'}
      </p>
      <div style={{ display: 'flex', gap: 16, color: '#cbd5e1', fontSize: 13 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          ⏱️ {contest.durationMinutes} mins
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          👥 {contest.membersCount || 0} Players
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          📝 {contest.problemsCount || 0} Problems
        </span>
      </div>
    </motion.div>
  );

  return (
    <main style={pageStyle}>
      <nav style={navStyle}>
        <a href="/" style={{ color: '#fff', textDecoration: 'none', fontWeight: 900, fontSize: 20 }}>
          <span style={{ padding: '6px 10px', background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#000', borderRadius: 8, marginRight: 8 }}>DC</span>
          DivineCode
        </a>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <a href="/contests/create" style={primaryBtn}>+ Create Mashup</a>
          <div style={{ background: '#1e293b', padding: '8px 16px', borderRadius: 20, color: '#eef2ff' }}>
            {session?.user?.name || 'Guest'}
          </div>
        </div>
      </nav>

      <section style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ padding: '40px 0', borderBottom: '1px solid #1e293b', marginBottom: 40 }}>
          <h1 style={{ fontSize: 48, margin: '0 0 16px 0', color: '#eef2ff' }}>Verified Arena</h1>
          <p style={{ color: '#94a3b8', fontSize: 18, maxWidth: 600 }}>
            Compete in Codeforces-style synchronized mashups with live standings, AI moderation, and anti-cheat verification.
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '100px 0', color: '#67e8f9' }}>
             <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} style={{ width: 40, height: 40, border: '3px solid rgba(103, 232, 249, 0.2)', borderTopColor: '#67e8f9', borderRadius: '50%', margin: '0 auto 16px' }} />
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
                <h2 style={{ color: '#fbbf24' }}>⏳ Upcoming Contests</h2>
                <div style={gridStyle}>
                  {scheduled.map(c => <ContestCard key={c.id} contest={c} />)}
                </div>
              </div>
            )}

            {ended.length > 0 && (
              <div>
                <h2 style={{ color: '#94a3b8' }}>📚 Past Contests & Practice</h2>
                <div style={gridStyle}>
                  {ended.map(c => <ContestCard key={c.id} contest={c} />)}
                </div>
              </div>
            )}

            {contests.length === 0 && (
              <div style={{ textAlign: 'center', padding: '60px 20px', background: '#0f172a', borderRadius: 24, border: '1px dashed #334155' }}>
                <h3 style={{ color: '#eef2ff' }}>No Contests Found</h3>
                <p style={{ color: '#94a3b8', marginBottom: 20 }}>There are currently no active or scheduled mashups in the arena.</p>
                <a href="/contests/create" style={primaryBtn}>Create the first one</a>
              </div>
            )}

          </div>
        )}
      </section>
    </main>
  );
}

// Styles
const pageStyle: CSSProperties = { minHeight: '100vh', padding: '30px 40px', fontFamily: 'Inter, sans-serif', color: '#eef2ff', background: '#020617' };
const navStyle: CSSProperties = { maxWidth: 1120, margin: '0 auto 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 };
const cardStyle: CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', padding: 24, borderRadius: 20, cursor: 'pointer', transition: 'border-color 0.2s' };
const primaryBtn: CSSProperties = { background: '#38bdf8', color: '#000', padding: '10px 20px', borderRadius: 999, fontWeight: 'bold', textDecoration: 'none', display: 'inline-block' };

const badgeLive: CSSProperties = { background: 'rgba(248, 113, 113, 0.1)', color: '#f87171', padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(248, 113, 113, 0.4)', fontSize: 12, fontWeight: 'bold' };
const badgeScheduled: CSSProperties = { background: 'rgba(251, 191, 36, 0.1)', color: '#fbbf24', padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(251, 191, 36, 0.4)', fontSize: 12, fontWeight: 'bold' };
const badgeEnded: CSSProperties = { background: 'rgba(148, 163, 184, 0.1)', color: '#94a3b8', padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(148, 163, 184, 0.4)', fontSize: 12, fontWeight: 'bold' };

const pulseDot: CSSProperties = { display: 'inline-block', width: 10, height: 10, background: '#f87171', borderRadius: '50%', boxShadow: '0 0 10px #f87171' };