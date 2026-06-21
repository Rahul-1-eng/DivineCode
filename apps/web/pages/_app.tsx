import type { AppProps } from 'next/app';
import { SessionProvider } from 'next-auth/react';
import { useEffect, useState } from 'react';

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
      {isOffline && (
        <div style={{ background: '#ef4444', color: '#fff', textAlign: 'center', padding: '10px', fontWeight: 'bold', zIndex: 9999, position: 'sticky', top: 0, fontSize: 14 }}>
          ⚠️ You are currently offline. Live features (Sockets, AI Workspace, and Judging) are disabled.
        </div>
      )}
      <Component {...pageProps} />
    </SessionProvider>
  );
}