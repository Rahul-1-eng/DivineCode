import React, { useMemo } from 'react';

interface ContributionDay {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

interface ActivityHeatmapProps {
  data?: ContributionDay[];
  loading?: boolean;
}

export default function ActivityHeatmap({ data = [], loading = false }: ActivityHeatmapProps) {
  // Generate a reliable fallback array of 365 days if the database has zero records yet
  const heatmapDays = useMemo(() => {
    if (data && data.length > 0) return data;
    
    const days: ContributionDay[] = [];
    const today = new Date();
    for (let i = 364; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      days.push({
        date: d.toISOString().split('T')[0],
        count: 0,
        level: 0
      });
    }
    return days;
  }, [data]);

  if (loading) {
    return (
      <div style={{ width: '100%', height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#171717', borderRadius: 12, border: '1px solid #262626', animation: 'pulse 2s infinite' }}>
        <p style={{ fontSize: 14, color: '#a3a3a3' }}>Loading your activity metrics...</p>
      </div>
    );
  }

  // Modern Utility Colors for the cells
  const levelColors: Record<number, string> = {
    0: 'rgba(38, 38, 38, 0.8)', // neutral-800
    1: '#064e3b', // emerald-950
    2: '#065f46', // emerald-800
    3: '#059669', // emerald-600
    4: '#34d399'  // emerald-400
  };

  return (
    <div style={{ width: '100%', background: 'rgba(23, 23, 23, 0.6)', backdropFilter: 'blur(12px)', padding: 16, borderRadius: 12, border: '1px solid #262626' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff', margin: '0 0 4px 0' }}>Submission History</h3>
            <p style={{ fontSize: 12, color: '#a3a3a3', margin: 0 }}>Your daily competitive coding consistency matrix</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#a3a3a3', marginTop: 4 }}>
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

      {/* 📱 RESPONSIVE WRAPPER: Horizontal scroll for mobile devices */}
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
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            />
          ))}
        </div>
      </div>
      <p style={{ fontSize: 11, color: '#737373', marginTop: 8, fontStyle: 'italic', display: 'block' }}>
        Swipe horizontally to view full yearly calendar metrics grid.
      </p>
    </div>
  );
}