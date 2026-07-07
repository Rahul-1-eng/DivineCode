/**
 * @file [id].tsx
 * @author Rahul
 * @description Live 1:1 interview room for a confirmed recruiter booking.
 * Candidate and recruiter land in the same private video room; the admin can
 * drop in to moderate. Access is resolved server-side per booking.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import toast, { Toaster } from 'react-hot-toast';
import { fetchApi } from '../../../lib/api';
import JitsiRoom from '../../../components/JitsiRoom';
import FeedbackModal from '../../../components/FeedbackModal';
import ContextLoader from '../../../components/ContextLoader';

export default function LiveInterviewCall() {
  const router = useRouter();
  const { id } = router.query;

  const [call, setCall] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);

  const leaveWithFeedback = () => {
    // Candidates rate the session before heading back; recruiters/admins skip straight out.
    if (call?.viewerRole === 'CANDIDATE') setShowFeedback(true);
    else router.push('/recruiter/book');
  };

  useEffect(() => {
    if (!id) return;
    fetchApi(`/api/v2/recruiter/bookings/${id}/call`)
      .then(res => setCall(res))
      .catch((err: any) => {
        setError(err?.message || 'Could not open the live room.');
      });
  }, [id]);

  if (error) {
    return (
      <main style={styles.center}>
        <Toaster position="bottom-right" />
        <div style={{ fontSize: 46 }}>🔒</div>
        <h2 style={{ margin: 0 }}>Room Unavailable</h2>
        <p style={{ color: 'var(--text-muted)', maxWidth: 420, lineHeight: 1.6 }}>{error}</p>
        <button onClick={() => router.push('/recruiter/book')} style={styles.primaryBtn}>← Back to Bookings</button>
      </main>
    );
  }

  if (!call) {
    return <main style={styles.center}><ContextLoader context="interview" label="Opening the interview room…" /></main>;
  }

  const scheduled = new Date(call.scheduledAt);

  return (
    <main className="call-shell" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-main)', color: 'var(--text-main)', overflow: 'hidden' }}>
      <Toaster position="bottom-right" />

      <style>{`
        /* Mobile URL bars eat into 100vh and cut off the Jitsi controls; dvh tracks the real visible height. */
        @supports (height: 100dvh) { .call-shell { height: 100dvh !important; } }
        @media (max-width: 768px) {
          .room-meta { flex-wrap: nowrap !important; overflow-x: auto; scrollbar-width: none; }
          .room-meta::-webkit-scrollbar { display: none; }
          .room-meta > * { flex: 0 0 auto; }
        }
      `}</style>

      <header style={styles.header}>
        <div className="room-meta" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', minWidth: 0 }}>
          <span style={{ fontWeight: 900, fontSize: 17 }}>⚡ DivineCode <span style={{ color: '#4ade80' }}>Live Interview</span></span>
          <span style={styles.chip}>
            {call.candidateName} × {call.recruiterName}
          </span>
          <span style={{ ...styles.chip, color: 'var(--text-muted)' }}>
            🗓 {scheduled.toLocaleString()}
          </span>
          <span style={{ ...styles.chip, color: '#a5b4fc' }}>
            You joined as {call.viewerRole === 'RECRUITER' ? 'Interviewer' : call.viewerRole === 'ADMIN' ? 'Admin Observer' : 'Candidate'}
          </span>
        </div>
        <button onClick={leaveWithFeedback} style={styles.leaveBtn}>Leave</button>
      </header>

      <div style={{ flex: 1, minHeight: 0 }}>
        <JitsiRoom
          roomName={call.roomId}
          displayName={call.displayName}
          subject={call.subject}
          onLeave={() => {
            toast('You left the interview room.');
            leaveWithFeedback();
          }}
        />
      </div>

      {/* Post-interview feedback — shown once, then back to bookings */}
      <FeedbackModal
        kind="HUMAN_INTERVIEW"
        refId={String(id || '')}
        open={showFeedback}
        onClose={() => router.push('/recruiter/book')}
      />
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  center: { height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 16, background: 'var(--bg-main)', color: 'var(--text-main)', padding: 40, textAlign: 'center' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 18px', background: 'var(--bg-panel-solid)', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap' },
  chip: { fontSize: 12.5, fontWeight: 700, padding: '5px 12px', borderRadius: 999, background: 'var(--bg-card)', border: '1px solid var(--border-color)' },
  primaryBtn: { padding: '13px 28px', borderRadius: 999, border: 0, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617', fontWeight: 800, cursor: 'pointer' },
  leaveBtn: { padding: '9px 22px', borderRadius: 999, border: '1px solid #ef4444', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontWeight: 800, fontSize: 13, cursor: 'pointer' }
};
