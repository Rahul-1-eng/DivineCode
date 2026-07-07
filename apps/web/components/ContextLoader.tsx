/**
 * @file ContextLoader.tsx
 * @author Rahul
 * @description In-page loading animation themed to what is actually loading —
 * a trophy racing for contests, swords clashing for duels, a rocket for the
 * practice arena — instead of a dead "Loading..." string.
 */

import { motion } from 'framer-motion';
import { CSSProperties } from 'react';

type LoaderContext = 'contest' | 'duel' | 'practice' | 'interview' | 'community' | 'coins' | 'generic';

const THEME: Record<LoaderContext, { icon: string; trail: string; label: string }> = {
  contest: { icon: '🏆', trail: '✨', label: 'Preparing the arena…' },
  duel: { icon: '⚔️', trail: '💥', label: 'Matching opponents…' },
  practice: { icon: '🚀', trail: '☁️', label: 'Fueling the workspace…' },
  interview: { icon: '🎙️', trail: '💬', label: 'Assembling the panel…' },
  community: { icon: '🎥', trail: '📡', label: 'Tuning the stream…' },
  coins: { icon: '🪙', trail: '💫', label: 'Opening the vault…' },
  generic: { icon: '⚡', trail: '·', label: 'Loading…' }
};

interface ContextLoaderProps {
  context?: LoaderContext;
  label?: string; // overrides the theme label
  compact?: boolean; // inline size for table cells / small panels
}

export default function ContextLoader({ context = 'generic', label, compact = false }: ContextLoaderProps) {
  const theme = THEME[context];

  const wrap: CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: compact ? 8 : 14, padding: compact ? '18px 10px' : '48px 20px', color: 'var(--text-muted)'
  };

  return (
    <div style={wrap} role="status" aria-live="polite">
      <div style={{ position: 'relative', width: compact ? 140 : 220, height: compact ? 40 : 56, overflow: 'hidden' }}>
        {/* ground line the icon flies over */}
        <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, height: 2, background: 'var(--border-color)', borderRadius: 2 }} />
        <motion.div
          animate={{ x: ['-20%', '110%'], y: [0, -6, 0, -4, 0] }}
          transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
          style={{ position: 'absolute', bottom: 10, fontSize: compact ? 22 : 30 }}
        >
          {theme.icon}
        </motion.div>
        <motion.div
          animate={{ x: ['-35%', '95%'], opacity: [0, 1, 0] }}
          transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
          style={{ position: 'absolute', bottom: 12, fontSize: compact ? 12 : 16 }}
        >
          {theme.trail}
        </motion.div>
      </div>
      <motion.p
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ repeat: Infinity, duration: 1.6 }}
        style={{ margin: 0, fontSize: compact ? 13 : 15, fontWeight: 600 }}
      >
        {label || theme.label}
      </motion.p>
    </div>
  );
}
