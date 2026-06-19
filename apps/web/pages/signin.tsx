import { signIn } from 'next-auth/react';
import React, { useState, FormEvent } from 'react';

type AuthMode = 'signin' | 'signup';

export default function SignInPage() {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleAuthSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const cleanHandle = handle.trim();
    const cleanPassword = password.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    if (!cleanHandle || !cleanPassword || (mode === 'signup' && !cleanEmail)) {
      setLoading(false);
      return setError('Please fill in all required fields.');
    }

    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

    if (mode === 'signup') {
      try {
        const res = await fetch(`${apiBase}/api/v2/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: cleanHandle,
            email: cleanEmail,
            name: cleanName || cleanHandle,
            password: cleanPassword
          })
        });
        const data = await res.json();
        if (!res.ok) {
          setLoading(false);
          return setError(data.error || 'Registration failed.');
        }
      } catch (err) {
        setLoading(false);
        return setError('Network connection to auth server failed.');
      }
    }

    // Authenticate the session securely
    const res = await signIn('credentials', {
      redirect: false,
      handle: cleanHandle,
      password: cleanPassword
    });

    setLoading(false);
    if (res?.error) {
      setError('Invalid credentials combination.');
    } else {
      window.location.href = '/contests';
    }
  }

  return (
    <main style={{ minHeight: '100vh', padding: 28, fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.35), transparent 34rem), radial-gradient(circle at bottom right, rgba(34,211,238,.2), transparent 30rem), #070a16' }}>
      <a href="/" style={{ color: '#67e8f9', textDecoration: 'none', fontWeight: 900 }}>← DivineCode</a>
      <section style={{ minHeight: 'calc(100vh - 80px)', display: 'grid', placeItems: 'center' }}>
        <div style={{ width: '100%', maxWidth: 1040, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 40, alignItems: 'center' }}>
          <div>
            <p style={{ color: '#67e8f9', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase' }}>Secure arena access</p>
            <h1 style={{ fontSize: 'clamp(44px,7vw,82px)', lineHeight: .95, margin: '12px 0', letterSpacing: '-.07em' }}>Enter the coding arena.</h1>
            <p style={{ color: '#a8b3c7', fontSize: 18, lineHeight: 1.75 }}>Use Google login for instant profile synchronization, or deploy a localized secure credential layout.</p>
          </div>
          <div style={{ padding: 30, borderRadius: 30, border: '1px solid rgba(148,163,184,.22)', background: 'linear-gradient(180deg,rgba(15,23,42,.9),rgba(15,23,42,.62))', boxShadow: '0 28px 90px rgba(0,0,0,.35)' }}>
            
            <div style={{ display: 'flex', gap: 20, marginBottom: 24, borderBottom: '1px solid rgba(148,163,184,.1)' }}>
              <button onClick={() => { setMode('signin'); setError(''); }} style={{ background: 'transparent', border: 'none', paddingBottom: 10, borderBottom: mode === 'signin' ? '2px solid #22d3ee' : 'none', color: mode === 'signin' ? '#22d3ee' : '#64748b', fontSize: 18, fontWeight: 'bold', cursor: 'pointer' }}>Sign In</button>
              <button onClick={() => { setMode('signup'); setError(''); }} style={{ background: 'transparent', border: 'none', paddingBottom: 10, borderBottom: mode === 'signup' ? '2px solid #22d3ee' : 'none', color: mode === 'signup' ? '#22d3ee' : '#64748b', fontSize: 18, fontWeight: 'bold', cursor: 'pointer' }}>Sign Up</button>
            </div>

            <button onClick={() => signIn('google', { callbackUrl: '/contests' })} style={{ width: '100%', padding: 14, borderRadius: 16, border: 'none', background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontWeight: 900, cursor: 'pointer', marginBottom: 18 }}>
              Continue with Google
            </button>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#64748b', margin: '18px 0' }}>
              <span style={{ height: 1, flex: 1, background: 'rgba(148,163,184,.2)' }} />or credentials<span style={{ height: 1, flex: 1, background: 'rgba(148,163,184,.2)' }} />
            </div>

            <form onSubmit={handleAuthSubmit}>
              {mode === 'signup' && (
                <>
                  <label style={labelStyle}>Full Name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rahul Kumar" style={inputStyle} />
                  
                  <label style={labelStyle}>Email Address *</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="rahul@iitp.ac.in" style={inputStyle} required />
                </>
              )}

              <label style={labelStyle}>DivineCode Username (Handle) *</label>
              <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="RKS_Rider" style={inputStyle} required />
              
              <label style={labelStyle}>Password *</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={inputStyle} required />
              
              {error && <p style={{ color: '#ef4444', fontSize: 14, marginTop: -8, marginBottom: 12 }}>{error}</p>}
              
              <button type="submit" disabled={loading} style={{ width: '100%', padding: 14, borderRadius: 16, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(2,6,23,.55)', color: '#eef2ff', fontWeight: 800, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
                {loading ? 'Processing...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 13, color: '#94a3b8', fontWeight: 600 };
const inputStyle: React.CSSProperties = { width: '100%', padding: 13, margin: '6px 0 16px', border: '1px solid rgba(148,163,184,.25)', borderRadius: 14, background: 'rgba(2,6,23,.55)', color: '#eef2ff', outline: 'none', boxSizing: 'border-box' };