import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function ResetPassword() {
  const router = useRouter();
  const { token } = router.query;
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setStatus('error');
      setMessage('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setStatus('error');
      setMessage('Password must be at least 6 characters.');
      return;
    }
    
    setStatus('loading');
    try {
      const res = await fetch(`${API_BASE_URL}/api/v2/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password })
      });
      const data = await res.json();
      
      if (res.ok) {
        setStatus('success');
        setMessage(data.message);
      } else {
        setStatus('error');
        setMessage(data.error || 'Failed to reset password.');
      }
    } catch (err) {
      setStatus('error');
      setMessage('Network error. Please try again.');
    }
  };

  if (!token && router.isReady) {
    return <div style={{ minHeight: '100vh', background: '#020617', color: '#f87171', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>Invalid or missing reset token.</div>;
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#020617', fontFamily: 'Inter, sans-serif' }}>
      <Head><title>Create New Password - DivineCode</title></Head>
      
      <div style={{ background: '#0f172a', padding: 40, borderRadius: 24, border: '1px solid #1e293b', width: '100%', maxWidth: 400, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <h1 style={{ color: '#eef2ff', margin: '0 0 10px 0', fontSize: 24 }}>Secure Account</h1>
          <p style={{ color: '#94a3b8', margin: 0, fontSize: 14 }}>Enter your new password below.</p>
        </div>

        {status === 'success' ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ background: 'rgba(74, 222, 128, 0.1)', color: '#4ade80', padding: 16, borderRadius: 12, border: '1px solid rgba(74, 222, 128, 0.4)', marginBottom: 20 }}>
              {message}
            </div>
            <button onClick={() => router.push('/signin')} style={{ width: '100%', padding: 12, background: '#38bdf8', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' }}>
              Sign In Now
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {status === 'error' && <div style={{ color: '#f87171', fontSize: 14, textAlign: 'center' }}>{message}</div>}
            
            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 6, fontWeight: 'bold', textTransform: 'uppercase' }}>New Password</label>
              <input 
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                style={{ width: '100%', padding: '12px 16px', background: '#020617', border: '1px solid #334155', borderRadius: 8, color: '#fff', outline: 'none' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 6, fontWeight: 'bold', textTransform: 'uppercase' }}>Confirm Password</label>
              <input 
                type="password" 
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                style={{ width: '100%', padding: '12px 16px', background: '#020617', border: '1px solid #334155', borderRadius: 8, color: '#fff', outline: 'none' }}
              />
            </div>

            <button disabled={status === 'loading'} type="submit" style={{ background: '#38bdf8', color: '#000', border: 'none', padding: 14, borderRadius: 8, fontWeight: 'bold', cursor: status === 'loading' ? 'not-allowed' : 'pointer', marginTop: 10 }}>
              {status === 'loading' ? 'Saving...' : 'Reset Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}