/**
 * @file MemoryMatrix.tsx
 * @author Rahul
 * @description Working-memory trainer. A pattern of tiles flashes on a grid;
 * reproduce it from memory. Every 2 cleared levels the grid grows and the
 * pattern lengthens — the same drill used in cognitive research (spatial span).
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

type Phase = 'idle' | 'showing' | 'recall' | 'won' | 'lost';

function gridSizeFor(level: number) { return Math.min(3 + Math.floor((level - 1) / 2), 7); }
function patternSizeFor(level: number) { return 2 + level; }

export default function MemoryMatrix() {
  const [level, setLevel] = useState(1);
  const [best, setBest] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [pattern, setPattern] = useState<Set<number>>(new Set());
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [wrongPick, setWrongPick] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const size = gridSizeFor(level);
  const cells = size * size;

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const startLevel = (lvl: number) => {
    const n = gridSizeFor(lvl) ** 2;
    const target = new Set<number>();
    while (target.size < Math.min(patternSizeFor(lvl), n - 1)) {
      target.add(Math.floor(Math.random() * n));
    }
    setLevel(lvl);
    setPattern(target);
    setPicked(new Set());
    setWrongPick(null);
    setPhase('showing');
    // Show the pattern briefly, then hide — recall begins
    timerRef.current = setTimeout(() => setPhase('recall'), 1200 + lvl * 150);
  };

  const clickCell = (i: number) => {
    if (phase !== 'recall' || picked.has(i)) return;
    if (!pattern.has(i)) {
      setWrongPick(i);
      setPhase('lost');
      setBest(b => Math.max(b, level - 1));
      return;
    }
    const next = new Set(picked).add(i);
    setPicked(next);
    if (next.size === pattern.size) {
      setPhase('won');
      setBest(b => Math.max(b, level));
      timerRef.current = setTimeout(() => startLevel(level + 1), 900);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '10px 0' }}>
      <div style={{ display: 'flex', gap: 18, fontWeight: 800, color: 'var(--text-main)' }}>
        <span>Level <span style={{ color: 'var(--accent-primary)' }}>{level}</span></span>
        <span>Best <span style={{ color: '#4ade80' }}>{best}</span></span>
      </div>

      <div style={{ minHeight: 26, fontWeight: 700, color: phase === 'lost' ? '#f87171' : phase === 'showing' ? '#fbbf24' : 'var(--text-muted)' }}>
        {phase === 'idle' && 'Memorize the flashing tiles, then tap them back.'}
        {phase === 'showing' && '👀 Memorize the pattern…'}
        {phase === 'recall' && `Recall! ${pattern.size - picked.size} tile(s) left`}
        {phase === 'won' && '✅ Perfect! Growing the grid…'}
        {phase === 'lost' && `❌ Wrong tile — you reached level ${level}.`}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${size}, minmax(38px, 62px))`, gap: 6, maxWidth: '94vw' }}>
        {Array.from({ length: cells }, (_, i) => {
          const lit = phase === 'showing' && pattern.has(i);
          const good = picked.has(i);
          const bad = wrongPick === i;
          const missed = phase === 'lost' && pattern.has(i) && !picked.has(i);
          return (
            <motion.button
              key={`${size}-${i}`}
              whileTap={phase === 'recall' ? { scale: 0.9 } : undefined}
              onClick={() => clickCell(i)}
              animate={lit ? { scale: [1, 1.08, 1] } : {}}
              style={{
                aspectRatio: '1', border: '1px solid var(--border-color)', borderRadius: 10, cursor: phase === 'recall' ? 'pointer' : 'default',
                background: bad ? '#b91c1c'
                  : good ? '#0e7490'
                  : lit ? 'linear-gradient(135deg, #22d3ee, #818cf8)'
                  : missed ? 'rgba(34,211,238,0.25)'
                  : 'var(--bg-card)',
                transition: 'background 0.2s'
              }}
            />
          );
        })}
      </div>

      {(phase === 'idle' || phase === 'lost') && (
        <button
          onClick={() => startLevel(phase === 'lost' ? 1 : level)}
          style={{ background: 'var(--accent-primary)', color: '#000', border: 'none', padding: '12px 28px', borderRadius: 999, fontWeight: 900, fontSize: 15, cursor: 'pointer' }}
        >
          {phase === 'lost' ? '🔄 Try Again' : '▶ Start'}
        </button>
      )}
    </div>
  );
}
