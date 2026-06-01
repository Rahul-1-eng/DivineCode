import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

const features = [
  { title: 'Login', href: '/signin', icon: '🔐', text: 'Google account access with contest identity.' },
  { title: 'Verified Contests', href: '/contests', icon: '🏆', text: 'Codeforces-style gym rooms with live sync and standings.' },
  { title: 'Create Mashup', href: '/contests/create', icon: '👥', text: 'Smart problem lookup, CF handles, fairness checks.' },
  { title: 'Duel Arena', href: '/duel', icon: '⚔️', text: 'Real-time MCQ battles with live scoring.' },
  { title: 'Interview Arena', href: '/interview', icon: '🎓', text: 'Rated CSE MCQs by topic and difficulty.' },
  { title: 'Submission Judge', href: '/judge', icon: '⚙️', text: 'Judge0-ready for custom problems, CF sync for external problems.' }
];

export default function Home() {
  const { data: session, status } = useSession();
  const [profile, setProfile] = useState<any>(null);

  const navLinks = [
    ['Duel', '/duel'],
    ['Contest', '/contests'],
    ['Interview', '/interview'],
    ['Group', '/contests/create']
  ];

  // Fetch the user's global economy stats (Rating & Coins)
  useEffect(() => {
    if (session?.user?.email) {
      fetch(`${API_BASE_URL}/api/v2/profile/me`, {
        headers: { 'x-user-email': session.user.email }
      })
      .then(r => r.json())
      .then(data => {
        if (!data.error) setProfile(data);
      })
      .catch(() => null);
    }
  }, [session]);

  return (
    <main style={{ minHeight: '100vh', padding: 28, fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.35), transparent 36rem), radial-gradient(circle at top right, rgba(34,211,238,.22), transparent 30rem), #070a16' }}>
      
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: .4; }
        }
        .skeleton-pulse {
          animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}</style>

      <nav style={{ maxWidth: 1180, margin: '0 auto 42px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'white', textDecoration: 'none', fontWeight: 900, fontSize: 22 }}>
          <span style={{ width: 44, height: 44, borderRadius: 15, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617' }}>DC</span>
          DivineCode
        </a>
        
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {navLinks.map(([item, href]) => (
            <a key={item} href={href} style={{ color: '#dbeafe', textDecoration: 'none', padding: '11px 16px', borderRadius: 999, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(15,23,42,.72)' }}>
              {item}
            </a>
          ))}

          {/* Dynamic Authentication State & Economy Stats */}
          {status === 'loading' ? (
            <div className="skeleton-pulse" style={{ width: 140, height: 42, borderRadius: 999, background: 'rgba(148,163,184,.2)' }} />
          ) : session ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginLeft: 10 }}>
              {profile ? (
                <>
                  <span style={{ padding: '8px 14px', borderRadius: 999, background: 'rgba(251,191,36,.15)', color: '#fbbf24', fontWeight: 'bold', fontSize: 14 }}>
                    🏆 {profile.rating || 1200}
                  </span>
                  <span style={{ padding: '8px 14px', borderRadius: 999, background: 'rgba(34,211,238,.15)', color: '#67e8f9', fontWeight: 'bold', fontSize: 14 }}>
                    🪙 {profile.coins || 0}
                  </span>
                </>
              ) : (
                <div className="skeleton-pulse" style={{ width: 120, height: 36, borderRadius: 999, background: 'rgba(148,163,184,.2)' }} />
              )}
              <a href="/profile" style={{ color: '#020617', textDecoration: 'none', padding: '11px 18px', borderRadius: 999, fontWeight: 900, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)' }}>
                {profile?.username || session.user?.name?.split(' ')[0] || 'Profile'}
              </a>
            </div>
          ) : (
            <a href="/signin" style={{ color: '#dbeafe', textDecoration: 'none', padding: '11px 16px', borderRadius: 999, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(15,23,42,.72)' }}>
              Login
            </a>
          )}
        </div>
      </nav>

      <section style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 24, alignItems: 'center' }}>
        <div style={{ padding: 42, borderRadius: 30, border: '1px solid rgba(148,163,184,.22)', background: 'linear-gradient(180deg,rgba(15,23,42,.9),rgba(15,23,42,.62))', boxShadow: '0 28px 90px rgba(0,0,0,.35)' }}>
          <p style={{ color: '#67e8f9', fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase' }}>Verified competitive programming arena</p>
          <h1 style={{ fontSize: 'clamp(44px,7vw,88px)', lineHeight: .92, letterSpacing: '-.08em', margin: '12px 0 18px' }}>Code. Sync. Duel. Interview.</h1>
          <p style={{ color: '#cbd5e1', fontSize: 18, lineHeight: 1.75 }}>DivineCode combines Codeforces-style verified mashups, live standings, duel battles, interview MCQs, and Judge0-ready custom submissions in one polished platform.</p>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 28 }}>
            <a href="/contests/create" style={{ color: '#020617', textDecoration: 'none', padding: '13px 18px', borderRadius: 999, fontWeight: 900, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)' }}>Create Verified Mashup</a>
            <a href="/interview" style={{ color: '#e2e8f0', textDecoration: 'none', padding: '13px 18px', borderRadius: 999, border: '1px solid rgba(148,163,184,.28)' }}>Practice Interviews</a>
          </div>
        </div>
        <div style={{ padding: 28, borderRadius: 30, border: '1px solid rgba(148,163,184,.22)', background: 'rgba(15,23,42,.72)', boxShadow: '0 28px 90px rgba(0,0,0,.3)' }}>
          <h2 style={{ marginTop: 0 }}>Platform Status</h2>
          {['Codeforces API sync every 30 seconds', 'No fake Accepted verdicts', 'Solved-problem fairness blocking', 'Rated CSE interview MCQs', 'Live standings and submission feed'].map((x) => (
            <p key={x} style={{ padding: 14, borderRadius: 16, background: 'rgba(2,6,23,.55)', border: '1px solid rgba(148,163,184,.16)' }}>✅ {x}</p>
          ))}
        </div>
      </section>

      <section style={{ maxWidth: 1180, margin: '28px auto 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 18 }}>
        {features.map((feature) => (
          <a href={feature.href} key={feature.title} style={{ color: '#eef2ff', textDecoration: 'none', padding: 22, borderRadius: 24, border: '1px solid rgba(148,163,184,.22)', background: 'rgba(15,23,42,.72)', boxShadow: '0 18px 60px rgba(0,0,0,.22)' }}>
            <div style={{ fontSize: 30 }}>{feature.icon}</div>
            <h3>{feature.title}</h3>
            <p style={{ color: '#a8b3c7', lineHeight: 1.55 }}>{feature.text}</p>
          </a>
        ))}
      </section>
    </main>
  );
}