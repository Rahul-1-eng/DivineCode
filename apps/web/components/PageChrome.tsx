/**
 * @file PageChrome.tsx
 * @author Rahul
 * @description Global page furniture mounted once in _app.tsx:
 *  1. Proper <title> for every route (the tab used to show the raw URL).
 *  2. A floating back button on the top-left of every page except home.
 *  3. A contextual route-change loader — a themed icon (trophy for contests,
 *     swords for duels, rocket for practice…) flies across a progress bar
 *     while the next page loads, so navigation never feels dead.
 */

import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

// Route → human title. Dynamic segments are matched by prefix, most-specific first.
const TITLES: Array<[string, string]> = [
  ['/contests/create', 'Create Contest — DivineCode'],
  ['/contests/[id]/final', 'Final Standings — DivineCode'],
  ['/contests/[id]/edit', 'Edit Contest — DivineCode'],
  ['/contests/[id]/problems', 'Contest Problem — DivineCode'],
  ['/contests/[id]', 'Contest Room — DivineCode'],
  ['/contests', 'Contests Arena — DivineCode'],
  ['/practice/[id]', 'Solve Problem — DivineCode'],
  ['/practice', 'Practice & AI Workspace — DivineCode'],
  ['/recruiter/book', 'Book a Live Recruiter — DivineCode'],
  ['/recruiter/session', 'AI Interview Session — DivineCode'],
  ['/recruiter/call', 'Live Interview Room — DivineCode'],
  ['/recruiter/report', 'Interview Debrief — DivineCode'],
  ['/recruiter', 'AI Recruiter — DivineCode'],
  ['/interview/add', 'Contribute a Question — DivineCode'],
  ['/interview', 'Interview Prep — DivineCode'],
  ['/live', 'DivineLive Stream — DivineCode'],
  ['/community', 'Community Hub — DivineCode'],
  ['/duel', '1v1 Code Duel — DivineCode'],
  ['/judge', 'Execution Judge — DivineCode'],
  ['/leaderboard', 'Leaderboard — DivineCode'],
  ['/coins', 'Coins & Top-ups — DivineCode'],
  ['/profile', 'My Profile — DivineCode'],
  ['/u/', 'Coder Profile — DivineCode'],
  ['/admin', 'Admin Command Center — DivineCode'],
  ['/signin', 'Sign In — DivineCode'],
  ['/forgot-password', 'Forgot Password — DivineCode'],
  ['/reset-password', 'Reset Password — DivineCode'],
  ['/submit', 'Submit Solution — DivineCode'],
  ['/', 'DivineCode — Competitive Programming & AI Interview Arena']
];

export function titleForRoute(route: string): string {
  const hit = TITLES.find(([prefix]) => prefix === '/' ? route === '/' : route.startsWith(prefix));
  return hit ? hit[1] : 'DivineCode';
}

// Which icon "flies" while this destination is loading.
function loaderThemeFor(url: string): { icon: string; label: string } {
  if (url.startsWith('/contests')) return { icon: '🏆', label: 'Entering the arena…' };
  if (url.startsWith('/duel')) return { icon: '⚔️', label: 'Sharpening blades…' };
  if (url.startsWith('/practice')) return { icon: '🚀', label: 'Launching workspace…' };
  if (url.startsWith('/recruiter')) return { icon: '🎙️', label: 'Calling the panel…' };
  if (url.startsWith('/interview')) return { icon: '🧠', label: 'Warming up neurons…' };
  if (url.startsWith('/community') || url.startsWith('/live')) return { icon: '🎥', label: 'Going live…' };
  if (url.startsWith('/coins')) return { icon: '🪙', label: 'Counting coins…' };
  if (url.startsWith('/leaderboard')) return { icon: '📊', label: 'Ranking coders…' };
  if (url.startsWith('/admin')) return { icon: '🛡️', label: 'Opening command center…' };
  return { icon: '⚡', label: 'Loading…' };
}

export default function PageChrome() {
  const router = useRouter();
  const [navTarget, setNavTarget] = useState<string | null>(null);

  useEffect(() => {
    const start = (url: string, { shallow }: { shallow?: boolean } = {}) => { if (!shallow) setNavTarget(url); };
    const done = () => setNavTarget(null);
    router.events.on('routeChangeStart', start);
    router.events.on('routeChangeComplete', done);
    router.events.on('routeChangeError', done);
    return () => {
      router.events.off('routeChangeStart', start);
      router.events.off('routeChangeComplete', done);
      router.events.off('routeChangeError', done);
    };
  }, [router]);

  const isHome = router.pathname === '/';
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push('/');
  };

  const theme = navTarget ? loaderThemeFor(navTarget) : null;

  return (
    <>
      <Head>
        <title>{titleForRoute(router.pathname)}</title>
      </Head>

      {/* Floating back button — every page except home */}
      {!isHome && (
        <motion.button
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          whileHover={{ scale: 1.08, x: -3 }}
          whileTap={{ scale: 0.92 }}
          onClick={goBack}
          aria-label="Go back"
          title="Go back"
          style={{
            position: 'fixed', top: 14, left: 14, zIndex: 1200,
            width: 42, height: 42, borderRadius: '50%',
            background: 'var(--bg-panel-solid, #0f172a)',
            border: '1px solid var(--border-color, rgba(148,163,184,0.25))',
            color: 'var(--accent-primary, #22d3ee)',
            fontSize: 20, fontWeight: 900, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
            boxShadow: '0 6px 18px rgba(0,0,0,0.35)'
          }}
        >
          ←
        </motion.button>
      )}

      {/* Contextual route-change loader: themed icon flying across a progress rail */}
      <AnimatePresence>
        {theme && (
          <motion.div
            key="route-loader"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1300, pointerEvents: 'none' }}
          >
            <div style={{ height: 3, background: 'rgba(148,163,184,0.15)', overflow: 'hidden' }}>
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: '100%' }}
                transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
                style={{ height: '100%', width: '45%', background: 'linear-gradient(90deg, transparent, var(--accent-primary, #22d3ee), transparent)' }}
              />
            </div>
            <motion.div
              initial={{ x: '-10vw' }}
              animate={{ x: '105vw' }}
              transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
              style={{ fontSize: 26, marginTop: 4, width: 40 }}
            >
              {theme.icon}
            </motion.div>
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              background: 'var(--bg-panel-solid, #0f172a)', border: '1px solid var(--border-color, rgba(148,163,184,0.25))',
              color: 'var(--text-muted, #94a3b8)', borderRadius: 999, padding: '6px 16px', fontSize: 13, fontWeight: 700
            }}>
              {theme.icon} {theme.label}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
