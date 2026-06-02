// apps/web/pages/judge.tsx
import { CSSProperties } from 'react';

export default function JudgePage() {
  return (
    <main style={page}>
      <div style={container}>
        <h1 style={{ margin: '0 0 16px 0', color: '#67e8f9' }}>Submission Judge</h1>
        <p style={{ color: '#cbd5e1', lineHeight: 1.6, marginBottom: 12 }}>
          The DivineCode local judge runs custom problems and standard algorithmic submissions securely using the Wandbox execution engine.
        </p>
        <p style={{ color: '#cbd5e1', lineHeight: 1.6 }}>
          External Codeforces problems are verified directly via the Codeforces API sync mechanism.
        </p>
        <div style={{ marginTop: 24 }}>
          <a href="/" style={primaryBtn}>← Back to Home</a>
        </div>
      </div>
    </main>
  );
}

const page: CSSProperties = { minHeight: '100vh', padding: '4vw', fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.32), transparent 34rem), #070a16', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const container: CSSProperties = { maxWidth: 600, padding: 40, background: 'rgba(15,23,42,.85)', borderRadius: 24, border: '1px solid rgba(148,163,184,.2)' };
const primaryBtn: CSSProperties = { display: 'inline-block', padding: '12px 20px', borderRadius: 999, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', textDecoration: 'none', fontWeight: 900 };