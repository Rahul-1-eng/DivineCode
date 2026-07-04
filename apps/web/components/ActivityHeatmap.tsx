/**
 * @file ActivityHeatmap.tsx
 * @author Rahul Kumar Sahoo
 * @description Reusable UI component for the product experience.
 */

import React, { useMemo } from 'react';

interface ContributionDay {
  date: string;
  count: number;
  level: number;
}

interface ActivityHeatmapProps {
  data?: ContributionDay[];
  loading?: boolean;
}

export default function ActivityHeatmap({ data = [], loading = false }: ActivityHeatmapProps) {
  // Accurately map real database submission dates to the 365-day grid
  const heatmapDays = useMemo(() => {
    const days: ContributionDay[] = [];
    const today = new Date();
    const dataMap = new Map(data.map(d => [d.date, d]));
    
    for (let i = 364; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      
      if (dataMap.has(dateStr)) {
        days.push(dataMap.get(dateStr)!);
      } else {
        days.push({ date: dateStr, count: 0, level: 0 });
      }
    }
    return days;
  }, [data]);

  if (loading) {
    return (
      <div style={{ width: '100%', height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-panel)', borderRadius: 12, border: '1px solid var(--border-color)', animation: 'pulse 2s infinite' }}>
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Loading real-time metrics...</p>
      </div>
    );
  }

  // Professional Github/LeetCode style Blue Theme
  const levelColors: Record<number, string> = {
    0: 'var(--border-color)', 
    1: '#bae6fd', // light cyan
    2: '#38bdf8', // active cyan
    3: '#0284c7', // deep blue
    4: '#082f49'  // darkest blue
  };

  return (
    <div style={{ width: '100%', background: 'var(--bg-panel)', backdropFilter: 'blur(12px)', padding: 'clamp(12px, 3vw, 20px)', borderRadius: 12, border: '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontSize: 'clamp(14px, 2.5vw, 16px)', fontWeight: 600, color: 'var(--text-main)', margin: '0 0 4px 0' }}>Submission History</h3>
            <p style={{ fontSize: 'clamp(11px, 2vw, 12px)', color: 'var(--text-muted)', margin: 0 }}>Your real-time daily coding consistency</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            <span>Less</span>
            <div style={{ width: 12, height: 12, background: levelColors[0], borderRadius: 2 }} />
            <div style={{ width: 12, height: 12, background: levelColors[1], borderRadius: 2 }} />
            <div style={{ width: 12, height: 12, background: levelColors[2], borderRadius: 2 }} />
            <div style={{ width: 12, height: 12, background: levelColors[3], borderRadius: 2 }} />
            <div style={{ width: 12, height: 12, background: levelColors[4], borderRadius: 2 }} />
            <span>More</span>
          </div>
        </div>
      </div>

      <div style={{ width: '100%', overflowX: 'auto', paddingBottom: 8, WebkitOverflowScrolling: 'touch' }}>
        <div style={{ minWidth: 760, display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'repeat(7, 1fr)', gap: 6, justifyContent: 'flex-start' }}>
          {heatmapDays.map((day) => (
            <div
              key={day.date}
              title={`${day.count} submissions on ${new Date(day.date).toLocaleDateString()}`}
              style={{
                width: 12,
                height: 12,
                borderRadius: 2,
                background: levelColors[day.level],
                transition: 'all 0.2s ease',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.2)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}