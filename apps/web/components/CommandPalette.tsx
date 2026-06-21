import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ users: [], contests: [], problems: [] });
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  // Handle Cmd+K / Ctrl+K to open, and Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery('');
      setResults({ users: [], contests: [], problems: [] });
    }
  }, [isOpen]);

  // Debounced Search API Call
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults({ users: [], contests: [], problems: [] });
      return;
    }

    const delayDebounce = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/api/v2/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      } catch (err) {
        console.error("Search failed", err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [query]);

  const navigateTo = (path: string) => {
    setIsOpen(false);
    router.push(path);
  };

  const hasResults = results.users.length > 0 || results.contests.length > 0 || results.problems.length > 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '10vh', background: 'rgba(2, 6, 23, 0.7)', backdropFilter: 'blur(4px)' }} onClick={() => setIsOpen(false)}>
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 600, background: '#0f172a', borderRadius: 16, border: '1px solid #1e293b', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            {/* Input Area */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #1e293b' }}>
              <span style={{ fontSize: 20, marginRight: 12 }}>🔍</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search users, problems, or contests..."
                style={{ flex: 1, background: 'transparent', border: 'none', color: '#eef2ff', fontSize: 18, outline: 'none' }}
              />
              <span style={{ background: '#1e293b', color: '#94a3b8', padding: '4px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>ESC</span>
            </div>

            {/* Results Area */}
            <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: 12 }}>
              {loading && <div style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>Searching the arena...</div>}
              
              {!loading && query.length >= 2 && !hasResults && (
                <div style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>No results found for "{query}"</div>
              )}

              {!loading && hasResults && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  
                  {/* Coders */}
                  {results.users.length > 0 && (
                    <div>
                      <div style={{ padding: '0 12px 8px', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>Coders</div>
                      {results.users.map((u: any) => (
                        <div key={u.id} onClick={() => navigateTo(`/u/${u.username}`)} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', borderRadius: 8, cursor: 'pointer', background: 'transparent' }} onMouseEnter={(e) => e.currentTarget.style.background = '#1e293b'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                          <div style={{ color: '#eef2ff', fontWeight: 500 }}>{u.name} <span style={{ color: '#94a3b8', fontWeight: 400 }}>@{u.username}</span></div>
                          <div style={{ color: '#38bdf8', fontSize: 14 }}>Rating: {u.rating || 0}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Contests */}
                  {results.contests.length > 0 && (
                    <div>
                      <div style={{ padding: '0 12px 8px', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>Contests</div>
                      {results.contests.map((c: any) => (
                        <div key={c.id} onClick={() => navigateTo(`/contests/${c.id}`)} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', borderRadius: 8, cursor: 'pointer', background: 'transparent' }} onMouseEnter={(e) => e.currentTarget.style.background = '#1e293b'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                          <div style={{ color: '#eef2ff', fontWeight: 500 }}>{c.title}</div>
                          <div style={{ color: c.status === 'RUNNING' ? '#4ade80' : '#94a3b8', fontSize: 14 }}>{c.status}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Problems */}
                  {results.problems.length > 0 && (
                    <div>
                      <div style={{ padding: '0 12px 8px', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>Practice Problems</div>
                      {results.problems.map((p: any) => (
                        <div key={p.id} onClick={() => navigateTo(`/practice/${p.id}`)} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', borderRadius: 8, cursor: 'pointer', background: 'transparent' }} onMouseEnter={(e) => e.currentTarget.style.background = '#1e293b'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                          <div style={{ color: '#eef2ff', fontWeight: 500 }}>{p.title}</div>
                          <div style={{ color: p.difficultyLabel === 'Easy' ? '#4ade80' : p.difficultyLabel === 'Medium' ? '#fbbf24' : '#f87171', fontSize: 14 }}>{p.difficultyLabel || 'Unrated'}</div>
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}