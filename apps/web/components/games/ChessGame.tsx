/**
 * @file ChessGame.tsx
 * @author Rahul
 * @description Full chess — real rules via chess.js (castling, en passant,
 * promotion, checkmate/stalemate detection). Play a friend locally or take on
 * the built-in engine (greedy material minimax, depth 2), with legal-move
 * highlighting, capture trays and move history.
 */

import { useMemo, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { motion } from 'framer-motion';

const GLYPH: Record<string, string> = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟'
};

const PIECE_VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Greedy material search. Depth 2 = "answers your blunders, punishes hanging
// pieces" — a satisfying club-beginner opponent without freezing the UI.
function evaluate(game: Chess): number {
  let score = 0;
  for (const row of game.board()) {
    for (const sq of row) {
      if (!sq) continue;
      score += (sq.color === 'w' ? 1 : -1) * PIECE_VALUE[sq.type];
    }
  }
  return score;
}

function bestAiMove(game: Chess): string | null {
  const moves = game.moves();
  if (moves.length === 0) return null;
  let best: string[] = [];
  let bestScore = Infinity; // AI plays black → minimizes white's material lead

  for (const move of moves) {
    game.move(move);
    let replyScore = -Infinity; // white replies maximize
    if (game.isCheckmate()) {
      game.undo();
      return move; // mate in one — take it
    }
    const replies = game.moves();
    if (replies.length === 0) {
      replyScore = evaluate(game); // stalemate/terminal
    }
    for (const reply of replies) {
      game.move(reply);
      replyScore = Math.max(replyScore, evaluate(game));
      game.undo();
    }
    game.undo();
    if (replyScore < bestScore) { bestScore = replyScore; best = [move]; }
    else if (replyScore === bestScore) best.push(move);
  }
  return best[Math.floor(Math.random() * best.length)] || null;
}

export default function ChessGame() {
  const [game] = useState(() => new Chess());
  const [, setTick] = useState(0); // chess.js is mutable — tick forces re-render
  const [selected, setSelected] = useState<Square | null>(null);
  const [vsAi, setVsAi] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);

  const rerender = () => setTick(t => t + 1);

  const legalTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set(game.moves({ square: selected, verbose: true }).map(m => m.to));
  }, [selected, game, lastMove]);

  const status = (() => {
    if (game.isCheckmate()) return `Checkmate — ${game.turn() === 'w' ? 'Black' : 'White'} wins! 🏁`;
    if (game.isStalemate()) return 'Stalemate — draw.';
    if (game.isThreefoldRepetition()) return 'Draw by repetition.';
    if (game.isInsufficientMaterial()) return 'Draw — insufficient material.';
    if (game.isCheck()) return `${game.turn() === 'w' ? 'White' : 'Black'} is in CHECK!`;
    return `${game.turn() === 'w' ? 'White' : 'Black'} to move${vsAi ? (game.turn() === 'b' ? ' (engine)' : ' (you)') : ''}`;
  })();

  const captured = useMemo(() => {
    const taken: { w: string[]; b: string[] } = { w: [], b: [] };
    for (const m of game.history({ verbose: true })) {
      if (m.captured) taken[m.color === 'w' ? 'w' : 'b'].push((m.color === 'w' ? 'b' : 'w') + m.captured);
    }
    return taken;
  }, [game, lastMove]);

  const scheduleAi = () => {
    setThinking(true);
    // Defer so the player's move paints before the engine grinds
    setTimeout(() => {
      const move = bestAiMove(game);
      if (move) {
        const made = game.move(move);
        setLastMove({ from: made.from, to: made.to });
      }
      setThinking(false);
      rerender();
    }, 350);
  };

  const clickSquare = (sq: Square) => {
    if (game.isGameOver() || thinking) return;
    if (vsAi && game.turn() === 'b') return;

    const piece = game.get(sq);
    if (selected && legalTargets.has(sq)) {
      const made = game.move({ from: selected, to: sq, promotion: 'q' }); // auto-queen
      setLastMove({ from: made.from, to: made.to });
      setSelected(null);
      rerender();
      if (vsAi && !game.isGameOver()) scheduleAi();
      return;
    }
    if (piece && piece.color === game.turn()) setSelected(sq === selected ? null : sq);
    else setSelected(null);
  };

  const reset = () => {
    game.reset();
    setSelected(null);
    setLastMove(null);
    setThinking(false);
    rerender();
  };

  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const board = game.board();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '10px 0' }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button onClick={() => { setVsAi(true); reset(); }} style={vsAi ? pillActive : pillIdle}>🤖 vs Engine</button>
        <button onClick={() => { setVsAi(false); reset(); }} style={!vsAi ? pillActive : pillIdle}>👥 Two Players</button>
        <button onClick={reset} style={pillIdle}>🔄 New Game</button>
        <button
          onClick={() => { game.undo(); if (vsAi) game.undo(); setSelected(null); setLastMove(null); rerender(); }}
          disabled={game.history().length === 0 || thinking}
          style={{ ...pillIdle, opacity: game.history().length === 0 ? 0.4 : 1 }}
        >
          ↩ Undo
        </button>
      </div>

      <motion.div
        key={status}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ fontWeight: 800, fontSize: 16, color: game.isCheck() || game.isCheckmate() ? '#f87171' : 'var(--accent-primary)' }}
      >
        {thinking ? 'Engine is thinking…' : status}
      </motion.div>

      <div style={{ display: 'flex', gap: 4, minHeight: 22, fontSize: 18 }}>
        {captured.b.map((p, i) => <span key={i}>{GLYPH[p]}</span>)}
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(8, minmax(34px, 54px))',
        border: '3px solid var(--border-color)', borderRadius: 8, overflow: 'hidden',
        boxShadow: '0 16px 40px rgba(0,0,0,0.35)', maxWidth: '94vw'
      }}>
        {board.map((row, r) =>
          row.map((sq, c) => {
            const square = (files[c] + (8 - r)) as Square;
            const dark = (r + c) % 2 === 1;
            const isSel = selected === square;
            const isTarget = legalTargets.has(square);
            const isLast = lastMove && (lastMove.from === square || lastMove.to === square);
            return (
              <div
                key={square}
                onClick={() => clickSquare(square)}
                style={{
                  aspectRatio: '1', display: 'grid', placeItems: 'center', position: 'relative',
                  fontSize: 'clamp(22px, 5.5vw, 36px)', cursor: 'pointer', userSelect: 'none',
                  background: isSel ? '#eab308'
                    : isLast ? (dark ? '#3f6212' : '#84cc16')
                    : dark ? '#475569' : '#cbd5e1',
                  transition: 'background 0.15s'
                }}
              >
                {isTarget && !sq && <div style={{ width: '28%', height: '28%', borderRadius: '50%', background: 'rgba(34,211,238,0.75)' }} />}
                {isTarget && sq && <div style={{ position: 'absolute', inset: 2, border: '3px solid rgba(34,211,238,0.9)', borderRadius: 6 }} />}
                {sq && <span style={{ filter: sq.color === 'b' ? 'drop-shadow(0 1px 1px rgba(255,255,255,0.35))' : 'drop-shadow(0 1px 1px rgba(0,0,0,0.45))' }}>{GLYPH[sq.color + sq.type]}</span>}
              </div>
            );
          })
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, minHeight: 22, fontSize: 18 }}>
        {captured.w.map((p, i) => <span key={i}>{GLYPH[p]}</span>)}
      </div>

      <div style={{ maxWidth: 460, width: '100%', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
        {game.history().length > 0
          ? <>Moves: {game.history().slice(-12).join(' · ')}</>
          : 'Click a piece, then a highlighted square. Full rules: castling, en passant, promotion.'}
      </div>
    </div>
  );
}

const pillActive: React.CSSProperties = { background: 'var(--accent-glow)', border: '1px solid var(--accent-primary)', color: 'var(--accent-primary)', padding: '8px 16px', borderRadius: 999, fontWeight: 'bold', cursor: 'pointer' };
const pillIdle: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', padding: '8px 16px', borderRadius: 999, fontWeight: 'bold', cursor: 'pointer' };
