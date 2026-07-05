/**
 * @file JitsiRoom.tsx
 * @author Rahul
 * @description Shared live video surface — wraps the Jitsi Meet External API
 * (meet.jit.si, free public infra, no keys). Camera, mic, screen share, tile
 * view and in-call chat all come with it; we skin the shell around it.
 * Used by both the recruiter interview call and DivineLive community rooms.
 */

import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    JitsiMeetExternalAPI: any;
  }
}

interface JitsiRoomProps {
  roomName: string;
  displayName: string;
  subject?: string;
  // Fired when the user hangs up / the conference is left
  onLeave?: () => void;
}

let scriptPromise: Promise<void> | null = null;
function loadJitsiScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.JitsiMeetExternalAPI) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://meet.jit.si/external_api.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => { scriptPromise = null; reject(new Error('Could not load the video engine.')); };
      document.body.appendChild(script);
    });
  }
  return scriptPromise;
}

export default function JitsiRoom({ roomName, displayName, subject, onLeave }: JitsiRoomProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    loadJitsiScript().then(() => {
      if (disposed || !containerRef.current || !window.JitsiMeetExternalAPI) return;

      apiRef.current = new window.JitsiMeetExternalAPI('meet.jit.si', {
        roomName,
        parentNode: containerRef.current,
        width: '100%',
        height: '100%',
        userInfo: { displayName },
        configOverwrite: {
          prejoinConfig: { enabled: false },
          disableDeepLinking: true,
          startWithAudioMuted: false,
          startWithVideoMuted: false,
          subject: subject || 'DivineCode Live'
        },
        interfaceConfigOverwrite: {
          SHOW_JITSI_WATERMARK: false,
          SHOW_BRAND_WATERMARK: false,
          DEFAULT_BACKGROUND: '#0f172a',
          TOOLBAR_BUTTONS: [
            'microphone', 'camera', 'desktop', 'chat', 'raisehand',
            'participants-pane', 'tileview', 'fullscreen', 'settings', 'hangup'
          ]
        }
      });

      if (subject) apiRef.current.executeCommand('subject', subject);
      apiRef.current.on('readyToClose', () => onLeave?.());
      apiRef.current.on('videoConferenceLeft', () => onLeave?.());
    }).catch((err: Error) => setError(err.message));

    return () => {
      disposed = true;
      if (apiRef.current) {
        try { apiRef.current.dispose(); } catch { /* already gone */ }
        apiRef.current = null;
      }
    };
    // Room identity is fixed for the lifetime of a call page; re-init only if it truly changes.
  }, [roomName]);

  if (error) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: '#0f172a', color: '#f87171', padding: 30, textAlign: 'center' }}>
        {error} — check your network and reload the page.
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#0f172a' }} />;
}
