import { CSSProperties, useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useSession } from 'next-auth/react'; // 👉 FIX: Imported useSession

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function PracticePage() {
  const { data: session } = useSession(); // 👉 FIX: Initialized session
  const [problems, setProblems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // 👉 Advanced Filtering States
  const [searchQuery, setSearchQuery] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('All');
  const [platformFilter, setPlatformFilter] = useState('All');

  useEffect(() => {
    // 👉 FIX: Injected security headers
    fetch(`${API_BASE_URL}/api/problems`, {
      headers: { 'x-user-email': session?.user?.email || '' }
    })
      .then((r) => r.json())
      .then((d) => {
        setProblems(Array.isArray(d) ? d : []);
        setLoading(false);
      })
      .catch(() => {
        setProblems([]);
        setLoading(false);
      });
  }, [session]); // 👉 FIX: Dependency updated

  const getDifficultyColor = (rating: number | null) => {
    if (!rating) return '#94a3b8'; 
    if (rating < 1200) return '#4ade80'; // Easy
    if (rating < 1600) return '#fbbf24'; // Medium
    return '#f87171'; // Hard
  };

  const getDifficultyLabel = (rating: number | null) => {
    if (!rating) return 'Unrated';
    if (rating < 1200) return 'Easy';
    if (rating < 1600) return 'Medium';
    return 'Hard';
  };

  const filteredProblems = useMemo(() => {
    return problems.filter((p) => {
      const matchesSearch = p.title?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            p.tags?.some((t: string) => t.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const difficulty = getDifficultyLabel(p.rating);
      const matchesDifficulty = difficultyFilter === 'All' || difficulty === difficultyFilter;
      
      const matchesPlatform = platformFilter === 'All' || (p.platform || 'DivineCode') === platformFilter;

      return matchesSearch && matchesDifficulty && matchesPlatform;
    });
  }, [problems, searchQuery, difficultyFilter, platformFilter]);

  return (
    <main style={page}>
      <section style={{ maxWidth: 1200, margin: '0 auto' }}>
        <nav style={nav}>
          <a href="/" style={brand}>
            <span style={logoBadge}>DC</span> DivineCode Practice
          </a>
          <a href="/contests" style={pill}>Contests Arena</a>
        </nav>

        <motion.div 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          style={hero}
        >
          <div style={{ flex: 1 }}>
            <p style={eyebrow}>AI-Powered Workspace</p>
            <h1 style={{ fontSize: 48, margin: '10px 0' }}>Master Data Structures & Algorithms</h1>
            <p style={{ color: '#94a3b8', fontSize: 16, maxWidth: 800 }}>
              Solve curated problems using our localized execution environment. 
              Stuck on a tricky graph problem? Launch the AI Avatar Explainer in the workspace for step-by-step guidance.
            </p>
          </div>
        </motion.div>

        {/* LeetCode-Style Filter Toolbar */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <input 
            placeholder="Search questions or topics..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ ...filterInput, flex: 1, minWidth: 250 }} 
          />
          <select value={difficultyFilter} onChange={(e) => setDifficultyFilter(e.target.value)} style={filterInput}>
            <option value="All">All Difficulties</option>
            <option value="Easy">Easy</option>
            <option value="Medium">Medium</option>
            <option value="Hard">Hard</option>
            <option value="Unrated">Unrated</option>
          </select>
          <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} style={filterInput}>
            <option value="All">All Platforms</option>
            <option value="Codeforces">Codeforces</option>
            <option value="LeetCode">LeetCode</option>
            <option value="DivineCode">DivineCode</option>
          </select>
        </div>

        <div style={tableContainer}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e293b', color: '#94a3b8', fontSize: 14, background: '#020617' }}>
                <th style={{ padding: '16px 20px', width: '5%' }}>Status</th>
                <th style={{ padding: '16px 20px', width: '40%' }}>Title</th>
                <th style={{ padding: '16px 20px', width: '15%' }}>Platform</th>
                <th style={{ padding: '16px 20px', width: '15%' }}>Difficulty</th>
                <th style={{ padding: '16px 20px', width: '25%' }}>Topics</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} style={{ display: 'inline-block', width: 30, height: 30, border: '3px solid rgba(103,232,249,0.2)', borderTopColor: '#67e8f9', borderRadius: '50%' }} />
                  </td>
                </tr>
              ) : filteredProblems.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>
                    No problems match your filters.
                  </td>
                </tr>
              ) : (
                filteredProblems.map((p, idx) => (
                  <motion.tr 
                    key={p.id}
                    initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.05 }}
                    style={{ 
                      borderBottom: '1px solid #1e293b', 
                      background: idx % 2 === 0 ? 'transparent' : 'rgba(15,23,42,0.4)',
                      transition: 'background 0.2s',
                      cursor: 'pointer'
                    }}
                    onClick={() => window.location.href = `/practice/${p.id}`}
                    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(30,41,59,0.8)'}
                    onMouseOut={(e) => e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'rgba(15,23,42,0.4)'}
                  >
                    <td style={{ padding: '16px 20px' }}>
                      <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #334155' }} />
                    </td>
                    <td style={{ padding: '16px 20px', fontWeight: 'bold', color: '#eef2ff' }}>
                      <span style={{ color: 'inherit', textDecoration: 'none' }}>{p.title}</span>
                    </td>
                    <td style={{ padding: '16px 20px', color: '#cbd5e1' }}>
                      {p.platform || 'DivineCode'}
                    </td>
                    <td style={{ padding: '16px 20px', color: getDifficultyColor(p.rating), fontWeight: 600 }}>
                      {getDifficultyLabel(p.rating)} {p.rating ? `(${p.rating})` : ''}
                    </td>
                    <td style={{ padding: '16px 20px' }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(p.tags || []).slice(0, 3).map((tag: string) => (
                          <span key={tag} style={tagStyle}>{tag}</span>
                        ))}
                        {(p.tags?.length > 3) && <span style={tagStyle}>+{p.tags.length - 3}</span>}
                      </div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

const page: CSSProperties = { minHeight: '100vh', padding: '30px 20px', fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: '#020617' };
const nav: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 };
const brand: CSSProperties = { color: '#fff', textDecoration: 'none', fontWeight: 900, fontSize: 22, display: 'flex', alignItems: 'center', gap: 12 };
const logoBadge: CSSProperties = { width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontSize: 16 };
const pill: CSSProperties = { color: '#dbeafe', textDecoration: 'none', padding: '10px 18px', borderRadius: 999, border: '1px solid rgba(148,163,184,.25)', background: '#0f172a', fontWeight: 'bold' };
const hero: CSSProperties = { padding: 40, borderRadius: 24, background: 'radial-gradient(circle at top right, rgba(34,211,238,.1), transparent 30rem), #0f172a', border: '1px solid #1e293b', marginBottom: 30, display: 'flex' };
const eyebrow: CSSProperties = { color: '#22d3ee', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 0 };
const filterInput: CSSProperties = { padding: '12px 16px', borderRadius: 12, border: '1px solid #334155', background: '#0f172a', color: '#eef2ff', outline: 'none' };
const tableContainer: CSSProperties = { background: '#0f172a', borderRadius: 16, border: '1px solid #1e293b', overflow: 'hidden' };
const tagStyle: CSSProperties = { background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', padding: '4px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: '1px solid rgba(56, 189, 248, 0.2)' };