import type { AppProps } from 'next/app';
import { SessionProvider } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { ThemeProvider } from 'next-themes';
import CommandPalette from '../components/CommandPalette';

export default function App({ Component, pageProps }: AppProps) {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsOffline(!navigator.onLine);
      const handleOnline = () => setIsOffline(false);
      const handleOffline = () => setIsOffline(true);
      
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
  }, []);

  return (
    <SessionProvider session={pageProps.session}>
      <ThemeProvider attribute="data-theme" defaultTheme="dark">
        {/* Global CSS Variables for seamless Light/Dark Mode */}
        <style dangerouslySetInnerHTML={{ __html: `
          :root {
            --bg-main: #070a16;
            --bg-main-gradient: radial-gradient(circle at top left, rgba(99,102,241,.32), transparent 34rem), #070a16;
            --bg-panel: rgba(15,23,42,0.82);
            --bg-panel-solid: #0f172a;
            --bg-card: rgba(2,6,23,.55);
            --text-main: #eef2ff;
            --text-muted: #94a3b8;
            --border-color: rgba(148,163,184,0.22);
            --accent-primary: #22d3ee;
            --button-ghost-bg: rgba(2,6,23,.55);
            --button-ghost-border: rgba(148,163,184,.25);
          }
          [data-theme='light'] {
            --bg-main: #f8fafc;
            --bg-main-gradient: radial-gradient(circle at top left, rgba(99,102,241,.1), transparent 34rem), #f8fafc;
            --bg-panel: rgba(255,255,255,0.9);
            --bg-panel-solid: #ffffff;
            --bg-card: rgba(255,255,255,0.8);
            --text-main: #0f172a;
            --text-muted: #475569;
            --border-color: rgba(15,23,42,0.1);
            --accent-primary: #0284c7;
            --button-ghost-bg: rgba(255,255,255,.5);
            --button-ghost-border: rgba(15,23,42,.1);
          }
          body {
            background: var(--bg-main-gradient);
            background-color: var(--bg-main);
            color: var(--text-main);
            transition: background 0.3s ease, color 0.3s ease;
            margin: 0;
          }
        `}} />

        {isOffline && (
          <div style={{ background: '#ef4444', color: '#fff', textAlign: 'center', padding: '10px', fontWeight: 'bold', zIndex: 9999, position: 'sticky', top: 0, fontSize: 14 }}>
            ⚠️ You are currently offline. Live features (Sockets, AI Workspace, and Judging) are disabled.
          </div>
        )}
        
        <CommandPalette />
        <Component {...pageProps} />
      </ThemeProvider>
    </SessionProvider>
  );
}