/**
 * @file signin.tsx
 * @author Rahul Kumar Sahoo
 * @description Sign-in and sign-up experience for the DivineCode platform.
 */
import { signIn } from 'next-auth/react';
import React, { useState, FormEvent } from 'react';
import { useRouter } from 'next/router';
import { getApiBaseUrlForClient } from '../lib/api';

type AuthMode = 'signin' | 'signup';

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const apiBase = getApiBaseUrlForClient();

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
        
        const data = await res.json().catch(() => ({ error: 'Server returned an invalid response.' }));
        
        if (!res.ok) {
          setLoading(false);
          return setError(data.error || 'Registration failed.');
        }
      } catch (err) {
        setLoading(false);
        return setError('Network connection to auth server failed.');
      }
    }

    // Attempt to sign in via NextAuth credentials provider
    const res = await signIn('credentials', {
      redirect: false,
      handle: cleanHandle,
      password: cleanPassword
    });

    setLoading(false);
    
    if (res?.error) {
      setError(res.error === 'CredentialsSignin' ? 'Invalid credentials combination.' : res.error);
    } else {
      // Redirect to Home Page
      router.push('/'); 
    }
  }

  async function handleGuestLogin() {
    setLoading(true);
    setError('');
    try {
      // 1. Silently attempt to register the guest account
      await fetch(`${apiBase}/api/v2/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username: 'GuestRecruiter', 
          email: 'recruiter@divinecode.local', 
          name: 'Hiring Manager', 
          password: 'GuestPassword123!' 
        })
      });

      // 2. Log them in instantly
      const res = await signIn('credentials', { 
        redirect: false, 
        handle: 'GuestRecruiter', 
        password: 'GuestPassword123!' 
      });

      if (res?.error) {
        setError('Guest environment initialization failed.');
        setLoading(false);
      } else {
        // Redirect to Home Page
        router.push('/');
      }
    } catch (err) {
      setError('Network error during guest login.');
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', padding: 28, fontFamily: 'Inter, Arial, sans-serif', color: 'var(--text-main)', background: 'var(--bg-main-gradient)', backgroundColor: 'var(--bg-main)' }}>
      
      <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-main)', textDecoration: 'none', fontWeight: 900, fontSize: 20 }}>
        <img src="/logo.png" alt="DivineCode Logo" style={{ width: 32, height: 32, objectFit: 'contain' }} />
        DivineCode
      </a>

      <section style={{ minHeight: 'calc(100vh - 80px)', display: 'grid', placeItems: 'center' }}>
        <div style={{ width: '100%', maxWidth: 1040, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 40, alignItems: 'center' }}>
          <div>
            <p style={{ color: 'var(--accent-primary)', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase', margin: 0 }}>Secure arena access</p>
            <h1 style={{ fontSize: 'clamp(44px,7vw,82px)', lineHeight: .95, margin: '12px 0', letterSpacing: '-.07em', color: 'var(--text-main)' }}>Enter the coding arena.</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 18, lineHeight: 1.75 }}>Use Google login for instant profile synchronization, or deploy a localized secure credential layout.</p>
            
            <div style={{ marginTop: 30, padding: 20, background: 'var(--accent-glow)', borderLeft: '4px solid var(--accent-primary)', borderRadius: '0 12px 12px 0' }}>
              <h3 style={{ color: 'var(--accent-primary)', margin: '0 0 8px 0', fontSize: 16 }}>👋 Here for a portfolio review?</h3>
              <p style={{ color: 'var(--text-main)', margin: 0, fontSize: 14, lineHeight: 1.5 }}>
                Click the <strong>Recruiter Test Drive</strong> button to instantly drop into a pre-configured guest session and explore the AI Interviewer and real-time collaboration features.
              </p>
            </div>
          </div>

          <div style={{ padding: 30, borderRadius: 30, border: '1px solid var(--border-color)', background: 'var(--bg-panel)', boxShadow: '0 28px 90px rgba(0,0,0,.15)' }}>
            
            <div style={{ display: 'flex', gap: 20, marginBottom: 24, borderBottom: '1px solid var(--border-color)' }}>
              <button onClick={() => { setMode('signin'); setError(''); }} style={{ background: 'transparent', border: 'none', paddingBottom: 10, borderBottom: mode === 'signin' ? '2px solid var(--accent-primary)' : '2px solid transparent', color: mode === 'signin' ? 'var(--accent-primary)' : 'var(--text-muted)', fontSize: 18, fontWeight: 'bold', cursor: 'pointer', transition: '0.2s' }}>Sign In</button>
              <button onClick={() => { setMode('signup'); setError(''); }} style={{ background: 'transparent', border: 'none', paddingBottom: 10, borderBottom: mode === 'signup' ? '2px solid var(--accent-primary)' : '2px solid transparent', color: mode === 'signup' ? 'var(--accent-primary)' : 'var(--text-muted)', fontSize: 18, fontWeight: 'bold', cursor: 'pointer', transition: '0.2s' }}>Sign Up</button>
            </div>

            {/* The callback is routed back to the home experience after sign-in. */}
            <button onClick={() => signIn('google', { callbackUrl: '/' })} style={{ width: '100%', padding: 14, borderRadius: 16, border: '1px solid var(--border-color)', background: 'var(--bg-panel-solid)', color: 'var(--text-main)', fontWeight: 900, cursor: 'pointer', marginBottom: 18, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, transition: '0.2s' }}>
              <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Continue with Google
            </button>
            
            <button onClick={handleGuestLogin} disabled={loading} style={{ width: '100%', padding: 14, borderRadius: 16, border: 'none', background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#000', fontWeight: 900, cursor: 'pointer', marginBottom: 18, opacity: loading ? 0.7 : 1 }}>
              🚀 Recruiter Test Drive (Guest Mode)
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-muted)', margin: '18px 0' }}>
              <span style={{ height: 1, flex: 1, background: 'var(--border-color)' }} />or credentials<span style={{ height: 1, flex: 1, background: 'var(--border-color)' }} />
            </div>

            <form onSubmit={handleAuthSubmit}>
              {mode === 'signup' && (
                <>
                  <label style={labelStyle}>Full Name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rahul Kumar" style={inputStyle} />
                  
                  <label style={labelStyle}>Email Address *</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="coder@example.com" style={inputStyle} required />
                </>
              )}

              <label style={labelStyle}>DivineCode Username (Handle) *</label>
              <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="Coder_123" style={inputStyle} required />
              
              <label style={labelStyle}>Password *</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={inputStyle} required />
              
              {mode === 'signin' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-10px', marginBottom: '16px' }}>
                  <a 
                    href="/forgot-password" 
                    style={{ color: 'var(--accent-primary)', fontSize: '12px', textDecoration: 'none', fontWeight: 'bold' }}
                  >
                    Forgot password?
                  </a>
                </div>
              )}

              {error && <p style={{ color: '#ef4444', fontSize: 14, marginTop: -8, marginBottom: 12 }}>{error}</p>}
              
              <button type="submit" disabled={loading} style={{ width: '100%', padding: 14, borderRadius: 16, border: '1px solid var(--border-color)', background: 'var(--bg-panel-solid)', color: 'var(--text-main)', fontWeight: 800, cursor: 'pointer', opacity: loading ? 0.6 : 1, transition: '0.2s' }}>
                {loading ? 'Processing...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 };
const inputStyle: React.CSSProperties = { width: '100%', padding: 13, margin: '6px 0 16px', border: '1px solid var(--border-color)', borderRadius: 14, background: 'var(--bg-card)', color: 'var(--text-main)', outline: 'none', boxSizing: 'border-box' };