import { signIn } from 'next-auth/react';
import React, { useState, FormEvent } from 'react';

export default function SignInPage() {
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function credentialsSignIn(e: FormEvent) {
    e.preventDefault();
    setError('');
    
    if (!handle.trim() || !password.trim()) {
      return setError('Please enter both handle and password');
    }

    const res = await signIn('credentials', {
      redirect: false,
      handle: handle.trim(),
      password: password
    });

    if (res?.error) {
      setError('Invalid handle or password');
    } else {
      window.location.href = '/contests';
    }
  }

  return (
    <main style={{ minHeight: '100vh', padding: 28, fontFamily: 'Inter, Arial, sans-serif', color: '#eef2ff', background: 'radial-gradient(circle at top left, rgba(99,102,241,.35), transparent 34rem), radial-gradient(circle at bottom right, rgba(34,211,238,.2), transparent 30rem), #070a16' }}>
      <a href="/" style={{ color: '#67e8f9', textDecoration: 'none', fontWeight: 900 }}>← DivineCode</a>
      <section style={{ minHeight: 'calc(100vh - 80px)', display: 'grid', placeItems: 'center' }}>
        <div style={{ width: '100%', maxWidth: 1040, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 24, alignItems: 'center' }}>
          <div>
            <p style={{ color: '#67e8f9', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase' }}>Secure arena access</p>
            <h1 style={{ fontSize: 'clamp(44px,7vw,82px)', lineHeight: .95, margin: '12px 0', letterSpacing: '-.07em' }}>Enter the coding arena.</h1>
            <p style={{ color: '#a8b3c7', fontSize: 18, lineHeight: 1.75 }}>Use Google login for quick access, or sign in with your established handle and password.</p>
          </div>
          <div style={{ padding: 30, borderRadius: 30, border: '1px solid rgba(148,163,184,.22)', background: 'linear-gradient(180deg,rgba(15,23,42,.9),rgba(15,23,42,.62))', boxShadow: '0 28px 90px rgba(0,0,0,.35)' }}>
            <h2 style={{ fontSize: 30, marginTop: 0 }}>Sign in to DivineCode</h2>
            
            {/* Fixed TS Property Error: Changed border: 0 to border: 'none' */}
            <button onClick={() => signIn('google', { callbackUrl: '/contests' })} style={{ width: '100%', padding: 14, borderRadius: 16, border: 'none', background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontWeight: 900, cursor: 'pointer', marginBottom: 18 }}>
              Continue with Google
            </button>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#64748b', margin: '18px 0' }}>
              <span style={{ height: 1, flex: 1, background: 'rgba(148,163,184,.2)' }} />or with handle<span style={{ height: 1, flex: 1, background: 'rgba(148,163,184,.2)' }} />
            </div>

            <form onSubmit={credentialsSignIn}>
              <label>Coding Handle</label>
              <input 
                value={handle} 
                onChange={(e) => setHandle(e.target.value)} 
                placeholder="RKS_Rider" 
                style={inputStyle} 
              />
              
              <label>Password</label>
              <input 
                type="password"
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                placeholder="••••••••" 
                style={inputStyle} 
              />
              
              {error && <p style={{ color: '#ef4444', fontSize: 14, marginTop: -8, marginBottom: 12 }}>{error}</p>}
              
              <button type="submit" style={{ width: '100%', padding: 14, borderRadius: 16, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(2,6,23,.55)', color: '#eef2ff', fontWeight: 800, cursor: 'pointer' }}>
                Sign In
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}

const inputStyle: React.CSSProperties = { width: '100%', padding: 13, margin: '8px 0 16px', border: '1px solid rgba(148,163,184,.25)', borderRadius: 14, background: 'rgba(2,6,23,.55)', color: '#eef2ff', outline: 'none' };