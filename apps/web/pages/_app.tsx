/**
 * @file _app.tsx
 * @author Rahul Kumar Sahoo
 * @description Page-level experience and view logic.
 */

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
        {/* Global Style overrides to enforce absolute theme token syncing */}
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
            --accent-glow: rgba(34, 211, 238, 0.4);
            --button-ghost-bg: rgba(2,6,23,.55);
            --button-ghost-border: rgba(148,163,184,.25);
            --table-hover: rgba(34, 211, 238, 0.05);
          }
          [data-theme='light'] {
            /* Softer Slate Background instead of blinding pure white */
            --bg-main: #f1f5f9; 
            --bg-main-gradient: radial-gradient(circle at top left, rgba(99,102,241,.08), transparent 34rem), #f1f5f9;
            --bg-panel: rgba(255,255,255,0.7);
            --bg-panel-solid: #ffffff;
            --bg-card: rgba(255,255,255,0.9);
            
            /* Dark, high-contrast text so nothing is invisible */
            --text-main: #0f172a; 
            --text-muted: #475569; 
            
            --border-color: rgba(15,23,42,0.12);
            --accent-primary: #0284c7;
            --accent-glow: rgba(2, 132, 199, 0.15);
            --button-ghost-bg: rgba(255,255,255,.6);
            --button-ghost-border: rgba(15,23,42,.2);
            --table-hover: rgba(15,23,42,0.04);
          }
          body {
            background: var(--bg-main-gradient) !important;
            background-color: var(--bg-main) !important;
            color: var(--text-main) !important;
            transition: background 0.3s ease, background-color 0.3s ease, color 0.3s ease;
            margin: 0;
          }
          main {
            background: transparent !important;
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