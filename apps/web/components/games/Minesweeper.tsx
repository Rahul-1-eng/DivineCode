/**
 * @file Minesweeper.tsx
 * @author Rahul
 * @description Classic Minesweeper — 10×10 with 15 mines. First click is
 * always safe (board is generated after it), flood-fill reveal, flag mode for
 * touch devices, and a timer for the leaderboard-minded.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const SIZE = 10;
const MINES = 15;

type Cell = { mine: boolean; revealed: boolean; flagged: boolean; adjacent: number };

function emptyBoard(): Cell[] {
  return Array.from({ length: SIZE * SIZE }, () => ({ mine: false, revealed: false, flagged: false, adjacent: 0 }));
}

function neighbors(idx: number): number[] {
  const r = Math.floor(idx / SIZE), c = idx % SIZE;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) out.push(nr * SIZE + nc);
    }
  }
  return out;
}

function generate(safeIdx: number): Cell[] {
  const board = emptyBoard();
  const banned = new Set([safeIdx, ...neighbors(safeIdx)]);
  let placed = 0;
  while (placed < MINES) {
    const i = Math.floor(Math.random() * SIZE * SIZE);
    if (board[i].mine || banned.has(i)) continue;
    board[i].mine = true;
    placed++;
  }
  for (let i = 0; i < board.length; i++) {
    board[i].adjacent = neighbors(i).filter(n => board[n].mine).length;
  }
  return board;
}

const NUM_COLORS = ['', '#38bdf8', '#4ade80', '#f87171', '#a855f7', '#fb923c', '#22d3ee', '#e2e8f0', '#94a3b8'];

export default function Minesweeper() {
  const [board, setBoard] = useState<Cell[]>(emptyBoard);
  const [started, setStarted] = useState(false);
  const [dead, setDead] = useState(false);
  const [won, setWon] = useState(false);
  const [flagMode, setFlagMode] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!started || dead || won) return;
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [started, dead, won]);

  const reset = () => { setBoard(emptyBoard()); setStarted(false); setDead(false); setWon(false); setSeconds(0); };

  const reveal = (idx: number) => {
    if (dead || won) return;

    let next = board;
    if (!started) {
      next = generate(idx);
      setStarted(true);
    }
    const cell = next[idx];
    if (cell.revealed) return;

    if (flagMode) {
      const copy = next.map(c => ({ ...c }));
      copy[idx].flagged = !copy[idx].flagged;
      setBoard(copy);
      return;
    }
    if (cell.flagged) return;

    const copy = next.map(c => ({ ...c }));
    if (copy[idx].mine) {
      copy.forEach(c => { if (c.mine) c.revealed = true; });
      setBoard(copy);
      setDead(true);
      return;
    }

    // flood fill zeros
    const stack = [idx];
    while (stack.length) {
      const i = stack.pop()!;
      if (copy[i].revealed || copy[i].flagged) continue;
      copy[i].revealed = true;
      if (copy[i].adjacent === 0 && !copy[i].mine) {
        neighbors(i).forEach(n => { if (!copy[n].revealed) stack.push(n); });
      }
    }
    setBoard(copy);

    if (copy.filter(c => !c.mine).every(c => c.revealed)) setWon(true);
  };

  const flagsLeft = MINES - board.filter(c => c.flagged).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '10px 0' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'monospace', fontSize: 20, color: 'var(--accent-primary)', fontWeight: 800 }}>⏱ {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</span>
        <span style={{ fontFamily: 'monospace', fontSize: 20, color: '#f87171', fontWeight: 800 }}>🚩 {flagsLeft}</span>
        <button
          onClick={() => setFlagMode(f => !f)}
          style={{ background: flagMode ? 'rgba(248,113,113,0.15)' : 'var(--bg-card)', border: `1px solid ${flagMode ? '#f87171' : 'var(--border-color)'}`, color: flagMode ? '#f87171' : 'var(--text-muted)', padding: '8px 16px', borderRadius: 999, fontWeight: 'bold', cursor: 'pointer' }}
        >
          🚩 Flag mode {flagMode ? 'ON' : 'off'}
        </button>
        <button onClick={reset} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', padding: '8px 16px', borderRadius: 999, fontWeight: 'bold', cursor: 'pointer' }}>🔄 Reset</button>
      </div>

      {(dead || won) && (
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          style={{ fontWeight: 900, fontSize: 18, color: won ? '#4ade80' : '#f87171' }}>
          {won ? `🎉 Field cleared in ${seconds}s!` : '💥 Boom! Hit a mine.'}
        </motion.div>
      )}

      <div
        onContextMenu={e => e.preventDefault()}
        style={{ display: 'grid', gridTemplateColumns: `repeat(${SIZE}, minmax(26px, 40px))`, gap: 3, maxWidth: '94vw' }}
      >
        {board.map((cell, i) => (
          <button
            key={i}
            onClick={() => reveal(i)}
            onContextMenu={() => { if (started && !cell.revealed) { const copy = board.map(c => ({ ...c })); copy[i].flagged = !copy[i].flagged; setBoard(copy); } }}
            style={{
              aspectRatio: '1', border: 'none', borderRadius: 5, cursor: 'pointer',
              fontWeight: 900, fontSize: 'clamp(12px, 3vw, 17px)',
              display: 'grid', placeItems: 'center',
              background: cell.revealed
                ? (cell.mine ? '#7f1d1d' : 'var(--bg-panel-solid)')
                : 'linear-gradient(135deg, #334155, #1e293b)',
              color: cell.revealed ? NUM_COLORS[cell.adjacent] : '#f87171',
              boxShadow: cell.revealed ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.08)'
            }}
          >
            {cell.revealed ? (cell.mine ? '💣' : cell.adjacent || '') : (cell.flagged ? '🚩' : '')}
          </button>
        ))}
      </div>
      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
        First click is always safe · right-click (or Flag mode on touch) to mark mines
      </p>
    </div>
  );
}
