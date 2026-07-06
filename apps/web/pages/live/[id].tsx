/**
 * @file [id].tsx
 * @author Rahul
 * @description DivineLive room — a community member streams camera-on and
 * everyone else joins the same video floor to discuss contest problems live.
 * Viewer count runs over the platform socket; media over the Jitsi room.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { io, Socket } from 'socket.io-client';
import toast, { Toaster } from 'react-hot-toast';
import { fetchApi, getApiBaseUrlForClient } from '../../lib/api';
import JitsiRoom from '../../components/JitsiRoom';

export default function DivineLiveRoom() {
  const router = useRouter();
  const { id } = router.query;

  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewers, setViewers] = useState(1);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (!id) return;

    fetchApi(`/api/v2/live/rooms/${id}`)
      .then(res => setData(res))
      .catch((err: any) => setError(err?.message || 'Could not open this live room.'));

    // Presence: join the socket room so the viewer counter is real, and get
    // told immediately if the host ends the stream.
    const socket: Socket = io(getApiBaseUrlForClient(), { transports: ['websocket'] });
    socket.emit('join-live-room', id);
    socket.on('live-viewer-count', (payload: { roomId: string; count: number }) => {
      if (payload.roomId === id) setViewers(Math.max(1, payload.count));
    });
    socket.on('live_room_ended', (payload: { id: string }) => {
      if (payload.id === id) {
        setData((prev: any) => prev ? { ...prev, room: { ...prev.room, status: 'ENDED' } } : prev);
      }
    });

    return () => {
      socket.emit('leave-live-room', id);
      socket.disconnect();
    };
  }, [id]);

  const endStream = async () => {
    if (ending) return;
    setEnding(true);
    try {
      await fetchApi(`/api/v2/live/rooms/${id}/end`, { method: 'POST', body: JSON.stringify({}) });
      toast.success('Stream ended.');
      router.push('/community');
    } catch (err: any) {
      toast.error(err?.message || 'Could not end the stream.');
      setEnding(false);
    }
  };

  if (error) {
    return (
      <main style={styles.center}>
        <div style={{ fontSize: 46 }}>📡</div>
        <h2 style={{ margin: 0 }}>Room Unavailable</h2>
        <p style={{ color: 'var(--text-muted)', maxWidth: 420, lineHeight: 1.6 }}>{error}</p>
        <button onClick={() => router.push('/community')} style={styles.primaryBtn}>← Community Hub</button>
      </main>
    );
  }

  if (!data) {
    return <main style={styles.center}><div>Tuning in…</div></main>;
  }

  const { room } = data;
  const hostName = room.host?.name || room.host?.username || 'Host';

  if (room.status === 'ENDED') {
    return (
      <main style={styles.center}>
        <Toaster position="bottom-right" />
        <div style={{ fontSize: 46 }}>🎬</div>
        <h2 style={{ margin: 0 }}>This stream has ended</h2>
        <p style={{ color: 'var(--text-muted)', maxWidth: 460, lineHeight: 1.6 }}>
          <strong>{hostName}</strong> wrapped up “{room.title}”.
          {room.peakViewers > 1 ? ` It peaked at ${room.peakViewers} live viewers.` : ''} Catch the next one from the Community Hub.
        </p>
        <button onClick={() => router.push('/community')} style={styles.primaryBtn}>← Community Hub</button>
      </main>
    );
  }

  return (
    <main className="live-shell" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-main)', color: 'var(--text-main)', overflow: 'hidden' }}>
      <Toaster position="bottom-right" />

      <style>{`
        /* Mobile URL bars eat into 100vh and cut off the Jitsi controls; dvh tracks the real visible height. */
        @supports (height: 100dvh) { .live-shell { height: 100dvh !important; } }
        @media (max-width: 768px) {
          .room-meta { flex-wrap: nowrap !important; overflow-x: auto; scrollbar-width: none; }
          .room-meta::-webkit-scrollbar { display: none; }
          .room-meta > * { flex: 0 0 auto; }
          .room-meta > span:nth-of-type(2) { max-width: 55vw !important; }
        }
      `}</style>

      <header style={styles.header}>
        <div className="room-meta" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', minWidth: 0 }}>
          <span style={styles.liveBadge}>
            <span style={styles.liveDot} /> LIVE
          </span>
          <span style={{ fontWeight: 900, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '40vw' }}>{room.title}</span>
          <span style={styles.chip}>🎙 {hostName}{room.host?.rating ? ` · ${room.host.rating}` : ''}</span>
          {room.contest && (
            <a href={`/contests/${room.contest.id}`} style={{ ...styles.chip, color: '#22d3ee', textDecoration: 'none' }}>
              🏁 {room.contest.title}
            </a>
          )}
          <span style={{ ...styles.chip, color: '#4ade80' }}>👁 {viewers} watching</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {(data.isHost || data.isAdmin) && (
            <button onClick={endStream} disabled={ending} style={styles.endBtn}>
              {ending ? 'Ending…' : data.isHost ? '⏹ End Stream' : '⏹ End (Admin)'}
            </button>
          )}
          <button onClick={() => router.push('/community')} style={styles.ghostBtn}>Exit</button>
        </div>
      </header>

      {room.topic && (
        <div style={{ padding: '8px 18px', fontSize: 13, color: 'var(--text-muted)', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-color)' }}>
          {room.topic}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        <JitsiRoom
          roomName={data.jitsiRoom}
          displayName={data.displayName}
          subject={`🔴 ${room.title}`}
          onLeave={() => router.push('/community')}
        />
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  center: { height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 16, background: 'var(--bg-main)', color: 'var(--text-main)', padding: 40, textAlign: 'center' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 18px', background: 'var(--bg-panel-solid)', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap' },
  liveBadge: { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 14px', borderRadius: 999, background: 'rgba(239,68,68,0.15)', border: '1px solid #ef4444', color: '#ef4444', fontWeight: 900, fontSize: 12, letterSpacing: 1 },
  liveDot: { width: 8, height: 8, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 10px #ef4444', animation: 'pulse 1.5s infinite' },
  chip: { fontSize: 12.5, fontWeight: 700, padding: '5px 12px', borderRadius: 999, background: 'var(--bg-card)', border: '1px solid var(--border-color)', whiteSpace: 'nowrap' },
  primaryBtn: { padding: '13px 28px', borderRadius: 999, border: 0, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontWeight: 800, cursor: 'pointer' },
  ghostBtn: { padding: '9px 22px', borderRadius: 999, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-main)', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  endBtn: { padding: '9px 22px', borderRadius: 999, border: '1px solid #ef4444', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontWeight: 800, fontSize: 13, cursor: 'pointer' }
};
