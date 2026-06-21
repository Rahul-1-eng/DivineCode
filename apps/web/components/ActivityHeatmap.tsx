import { useMemo } from 'react';

export default function ActivityHeatmap({ submissions = [] }: { submissions: any[] }) {
  const { grid, maxStreak, currentStreak, activeDays, totalSolves } = useMemo(() => {
    // 1. Group accepted submissions by date (YYYY-MM-DD)
    const counts: Record<string, number> = {};
    const validSubs = submissions.filter(s => String(s.verdict).includes('ACCEPT') || String(s.verdict) === 'OK');
    
    validSubs.forEach(s => {
      if (!s.createdAt) return;
      const dateStr = new Date(s.createdAt).toISOString().split('T')[0];
      counts[dateStr] = (counts[dateStr] || 0) + 1;
    });

    // 2. Generate the last 365 days
    const today = new Date();
    const days = [];
    let total = 0;
    let active = 0;

    for (let i = 364; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const count = counts[dateStr] || 0;
      days.push({ date: dateStr, count });
      if (count > 0) {
        active++;
        total += count;
      }
    }

    // 3. Calculate Streaks
    let curr = 0;
    let max = 0;
    let temp = 0;

    for (let i = 0; i < days.length; i++) {
      if (days[i].count > 0) {
        temp++;
        max = Math.max(max, temp);
      } else {
        temp = 0;
      }
    }

    // Check current streak (counting backwards from today/yesterday)
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].count > 0) {
        curr++;
      } else if (i === days.length - 1) {
        // If today is 0, we forgive it and check yesterday
        continue;
      } else {
        break;
      }
    }

    return { grid: days, maxStreak: max, currentStreak: curr, activeDays: active, totalSolves: total };
  }, [submissions]);

  const getColor = (count: number) => {
    if (count === 0) return 'rgba(56, 189, 248, 0.05)'; // Empty (Dark Slate)
    if (count <= 2) return 'rgba(56, 189, 248, 0.4)';  // Light Cyan
    if (count <= 5) return 'rgba(56, 189, 248, 0.7)';  // Medium Cyan
    return 'rgba(56, 189, 248, 1)';                    // Bright Cyan
  };

  return (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 16, padding: 24, marginTop: 20 }}>
      <h3 style={{ margin: '0 0 16px', color: '#e2e8f0', fontSize: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>🔥</span> Activity Heatmap
      </h3>
      
      <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
        <div><div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase' }}>Current Streak</div><div style={{ fontSize: 24, fontWeight: 'bold', color: '#38bdf8' }}>{currentStreak} <span style={{fontSize: 14, color: '#64748b', fontWeight: 'normal'}}>days</span></div></div>
        <div><div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase' }}>Max Streak</div><div style={{ fontSize: 24, fontWeight: 'bold', color: '#eef2ff' }}>{maxStreak} <span style={{fontSize: 14, color: '#64748b', fontWeight: 'normal'}}>days</span></div></div>
        <div><div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase' }}>Active Days</div><div style={{ fontSize: 24, fontWeight: 'bold', color: '#4ade80' }}>{activeDays} <span style={{fontSize: 14, color: '#64748b', fontWeight: 'normal'}}>days</span></div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(52, 1fr)', gridAutoFlow: 'column', gridTemplateRows: 'repeat(7, 1fr)', gap: 4, overflowX: 'auto', paddingBottom: 10 }}>
        {grid.map((day, i) => (
          <div 
            key={i} 
            title={`${day.count} solves on ${day.date}`}
            style={{ width: 12, height: 12, background: getColor(day.count), borderRadius: 3, cursor: 'pointer', transition: 'transform 0.1s' }}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.2)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          />
        ))}
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12, color: '#94a3b8' }}>
        <span>Less</span>
        <div style={{ width: 12, height: 12, background: 'rgba(56, 189, 248, 0.05)', borderRadius: 3 }}></div>
        <div style={{ width: 12, height: 12, background: 'rgba(56, 189, 248, 0.4)', borderRadius: 3 }}></div>
        <div style={{ width: 12, height: 12, background: 'rgba(56, 189, 248, 0.7)', borderRadius: 3 }}></div>
        <div style={{ width: 12, height: 12, background: 'rgba(56, 189, 248, 1)', borderRadius: 3 }}></div>
        <span>More</span>
      </div>
    </div>
  );
}