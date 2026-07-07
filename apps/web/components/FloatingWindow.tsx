/**
 * @file FloatingWindow.tsx
 * @author Rahul
 * @description Draggable + resizable floating window shell. Grab the header to
 * move it anywhere on screen, grab the corner handle to resize. Position and
 * size are clamped to the viewport, and everything runs on pointer events so
 * it works with mouse and touch alike. No external deps.
 */

import { CSSProperties, ReactNode, useCallback, useEffect, useRef, useState } from 'react';

interface FloatingWindowProps {
  title: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  /** Initial geometry — the window is anchored bottom-right by default. */
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  zIndex?: number;
}

export default function FloatingWindow({
  title, onClose, children,
  defaultWidth = 360, defaultHeight = 480,
  minWidth = 280, minHeight = 240,
  zIndex = 60
}: FloatingWindowProps) {
  const [size, setSize] = useState({ w: defaultWidth, h: defaultHeight });
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null); // null → CSS default anchor
  const dragState = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; baseX: number; baseY: number; baseW: number; baseH: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const clamp = useCallback((x: number, y: number, w: number, h: number) => {
    const vw = window.innerWidth, vh = window.innerHeight;
    return {
      x: Math.min(Math.max(x, 8 - w + 60), vw - 60),   // keep ≥60px of the header reachable
      y: Math.min(Math.max(y, 0), vh - 48),
      w: Math.min(Math.max(w, minWidth), vw - 16),
      h: Math.min(Math.max(h, minHeight), vh - 16)
    };
  }, [minWidth, minHeight]);

  const beginDrag = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.preventDefault();
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragState.current = {
      mode,
      startX: e.clientX, startY: e.clientY,
      baseX: rect.left, baseY: rect.top,
      baseW: rect.width, baseH: rect.height
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const s = dragState.current;
      if (!s) return;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      if (s.mode === 'move') {
        const c = clamp(s.baseX + dx, s.baseY + dy, s.baseW, s.baseH);
        setPos({ x: c.x, y: c.y });
      } else {
        const c = clamp(s.baseX, s.baseY, s.baseW + dx, s.baseH + dy);
        setSize({ w: c.w, h: c.h });
      }
    };
    const onUp = () => { dragState.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [clamp]);

  const frame: CSSProperties = {
    position: 'fixed',
    zIndex,
    width: size.w,
    height: size.h,
    maxWidth: '96vw',
    maxHeight: '92vh',
    ...(pos
      ? { left: pos.x, top: pos.y }
      : { right: 24, bottom: 24 }),
    background: 'var(--bg-panel-solid, #0f172a)',
    border: '1px solid var(--accent-primary, #22d3ee)',
    borderRadius: 16,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
  };

  return (
    <div ref={frameRef} style={frame}>
      {/* Header doubles as the drag handle */}
      <div
        onPointerDown={beginDrag('move')}
        style={{
          background: 'var(--bg-panel, rgba(15,23,42,0.9))',
          padding: '10px 14px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: '1px solid var(--border-color, rgba(148,163,184,0.25))',
          cursor: 'move', userSelect: 'none', touchAction: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-main, #eef2ff)', fontWeight: 700, fontSize: 14, minWidth: 0 }}>
          <span style={{ opacity: 0.4, fontSize: 12 }}>⠿</span>
          {title}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            onPointerDown={e => e.stopPropagation()}
            aria-label="Close window"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted, #94a3b8)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}
          >
            ×
          </button>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>

      {/* Corner resize handle */}
      <div
        onPointerDown={beginDrag('resize')}
        aria-label="Resize window"
        style={{
          position: 'absolute', right: 0, bottom: 0, width: 22, height: 22,
          cursor: 'nwse-resize', touchAction: 'none',
          background: 'linear-gradient(135deg, transparent 50%, var(--accent-primary, #22d3ee) 50%)',
          opacity: 0.55, borderBottomRightRadius: 16
        }}
      />
    </div>
  );
}
