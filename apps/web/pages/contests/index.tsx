import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const API_V2_BASE_URL = `${API_BASE_URL}/api/v2`;

export default function ContestsPage() {
  const { data: session } = useSession();
  const [contests, setContests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true); // Tells Next.js to wait for the browser before hydrating!
    loadContests(); 
  }, []);

  async function loadContests() {
    try { 
      const res = await fetch(`${API_V2_BASE_URL}/contests`); 
      const data = await res.json(); 
      setContests(Array.isArray(data) ? data : []); 
    }
    finally { setLoading(false); }
  }

  // Prevents Hydration Error Mismatches
  if (!mounted) return null; 

  const userLabel = session?.user?.name || session?.user?.email;
  const now = Date.now(); // Current time for checking live status

  return (
    <main style={page}>
      <section style={{ maxWidth: 1180, margin: '0 auto' }}>
        <nav style={nav}>
          <a href="/" style={brand}>DivineCode</a>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {userLabel ? <a href="/profile" style={pill}>{userLabel}</a> : <a href="/signin" style={pill}>Login</a>}
            <a href="/duel" style={pill}>Duel</a>
            <a href="/contests/create" style={primary}>Create Mashup</a>
          </div>
        </nav>
        <div style={hero}>
          <p style={eyebrow}>Gym dashboard</p>
          <h1 style={{ fontSize: 'clamp(42px,7vw,78px)', margin: 0, letterSpacing: '-.07em' }}>Contest rooms that feel alive.</h1>
          <p style={{ color: '#a8b3c7', maxWidth: 720, lineHeight: 1.75 }}>Create mashups, invite coders, submit from account, and track standings like a real competitive programming arena.</p>
        </div>
        
        {loading && <div style={panel}>Loading contests...</div>}
        {!loading && contests.length === 0 && (
          <div style={panel}>
            <h2>No contests yet</h2>
            <p style={{ color: '#94a3b8' }}>Create your first mashup room and add problems from Codeforces, LeetCode, AtCoder, or CodeChef.</p>
            <a href="/contests/create" style={primary}>Create Mashup</a>
          </div>
        )}

        <section style={grid}>
          {contests.map((contest) => {
            // 👉 DYNAMIC STATUS CHECK
            const endTime = new Date(contest.startTime).getTime() + contest.durationMinutes * 60000;
            const isLive = now < endTime;

            return (
              <a href={`/contests/${contest.id}`} key={contest.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={isLive ? tagLive : tagCompleted}>{isLive ? 'LIVE GYM' : 'COMPLETED'}</span>
                  <span style={{ color: '#67e8f9' }}>{contest.durationMinutes}m</span>
                </div>
                <h2>{contest.title}</h2>
                <p style={{ color: '#94a3b8', lineHeight: 1.6 }}>{contest.description || 'Private group contest room'}</p>
                <div style={stats}>
                  <span>{contest.membersCount} members</span>
                  <span>{contest.problemsCount} problems</span>
                  <span>{contest.questionCount || 0} MCQs</span>
                </div>
              </a>
            );
          })}
        </section>
      </section>
    </main>
  );
}

const page = { minHeight: '100vh', padding: 28, fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.32), transparent 34rem), radial-gradient(circle at bottom right, rgba(34,211,238,.18), transparent 30rem), #070a16' };
const nav = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 18, flexWrap: 'wrap' as const, marginBottom: 42 };
const brand = { color: '#eef2ff', textDecoration: 'none', fontWeight: 950, fontSize: 24 };
const pill = { color: '#dbeafe', textDecoration: 'none', padding: '11px 16px', borderRadius: 999, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(15,23,42,.72)' };
const primary = { display: 'inline-block', color: '#020617', textDecoration: 'none', padding: '12px 17px', borderRadius: 999, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', fontWeight: 900 };
const hero = { padding: 32, borderRadius: 30, border: '1px solid rgba(148,163,184,.22)', background: 'rgba(15,23,42,.72)', boxShadow: '0 28px 90px rgba(0,0,0,.32)', marginBottom: 24 };
const eyebrow = { color: '#67e8f9', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase' as const };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 18 };
const panel = { padding: 26, borderRadius: 26, border: '1px solid rgba(148,163,184,.22)', background: 'rgba(15,23,42,.82)', marginBottom: 18 };
const card = { color: '#eef2ff', textDecoration: 'none', padding: 24, borderRadius: 26, border: '1px solid rgba(148,163,184,.22)', background: 'linear-gradient(180deg,rgba(15,23,42,.88),rgba(2,6,23,.68))', boxShadow: '0 20px 70px rgba(0,0,0,.28)' };
const tagLive = { padding: '6px 10px', borderRadius: 999, color: '#020617', background: '#67e8f9', fontWeight: 900, fontSize: 12 };
const tagCompleted = { ...tagLive, background: '#475569', color: '#f8fafc' }; // Greyed out for finished contests
const stats = { display: 'flex', gap: 10, flexWrap: 'wrap' as const, color: '#cbd5e1', marginTop: 18 };