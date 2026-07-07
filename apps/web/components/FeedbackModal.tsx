/**
 * @file FeedbackModal.tsx
 * @author Rahul
 * @description Star-rating feedback dialog shown after an experience ends
 * (AI interview, live recruiter call, contest). Skipping is always allowed;
 * a user is never asked twice for the same experience.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { fetchApi } from '../lib/api';

export type FeedbackKind = 'AI_INTERVIEW' | 'HUMAN_INTERVIEW' | 'CONTEST' | 'PLATFORM';

const KIND_COPY: Record<FeedbackKind, { title: string; question: string }> = {
  AI_INTERVIEW: { title: 'How was your AI interview?', question: 'Rate the interviewer, question quality and overall experience.' },
  HUMAN_INTERVIEW: { title: 'How was your live interview?', question: 'Rate the recruiter, the call quality and how useful the session was.' },
  CONTEST: { title: 'How was this contest?', question: 'Rate the problems, judging speed and overall arena experience.' },
  PLATFORM: { title: 'How is DivineCode doing?', question: 'Rate your overall experience on the platform.' }
};

interface FeedbackModalProps {
  kind: FeedbackKind;
  refId: string;
  /** Set true when the experience just concluded — the modal checks the server
   * whether feedback already exists and only then shows itself. */
  open: boolean;
  onClose?: () => void;
}

export default function FeedbackModal({ kind, refId, open, onClose }: FeedbackModalProps) {
  const [visible, setVisible] = useState(false);
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comments, setComments] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) { setVisible(false); return; }
    let cancelled = false;
    // Only interrupt the user if they haven't rated this experience yet
    fetchApi(`/api/v2/feedback/mine?kind=${kind}&refId=${encodeURIComponent(refId)}`)
      .then(res => { if (!cancelled && res?.success && !res.submitted) setVisible(true); })
      .catch(() => { if (!cancelled) setVisible(true); }); // fail open — worst case they see the form
    return () => { cancelled = true; };
  }, [open, kind, refId]);

  const submit = async () => {
    if (stars === 0 || sending) return;
    setSending(true);
    try {
      await fetchApi('/api/v2/feedback', {
        method: 'POST',
        body: JSON.stringify({ kind, refId, rating: stars, comments })
      });
      setDone(true);
      setTimeout(() => { setVisible(false); onClose?.(); }, 1400);
    } catch {
      setVisible(false);
      onClose?.();
    } finally {
      setSending(false);
    }
  };

  const dismiss = () => { setVisible(false); onClose?.(); };
  const copy = KIND_COPY[kind];

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.75)', zIndex: 1400, display: 'grid', placeItems: 'center', padding: 20 }}
          onClick={dismiss}
        >
          <motion.div
            initial={{ scale: 0.9, y: 24 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 24 }}
            transition={{ type: 'spring', damping: 22, stiffness: 300 }}
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 440, background: 'var(--bg-panel-solid, #0f172a)',
              border: '1px solid var(--border-color, #334155)', borderRadius: 20, padding: 28,
              boxShadow: '0 30px 80px rgba(0,0,0,0.5)'
            }}
          >
            {done ? (
              <div style={{ textAlign: 'center', padding: '30px 0' }}>
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} style={{ fontSize: 52 }}>🙏</motion.div>
                <h3 style={{ color: 'var(--text-main, #eef2ff)', margin: '12px 0 0' }}>Thanks for the feedback!</h3>
              </div>
            ) : (
              <>
                <h3 style={{ margin: '0 0 6px', color: 'var(--text-main, #eef2ff)', fontSize: 20 }}>{copy.title}</h3>
                <p style={{ margin: '0 0 20px', color: 'var(--text-muted, #94a3b8)', fontSize: 14 }}>{copy.question}</p>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 18 }}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <motion.button
                      key={n}
                      whileHover={{ scale: 1.2, rotate: -8 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setStars(n)}
                      onMouseEnter={() => setHover(n)}
                      onMouseLeave={() => setHover(0)}
                      style={{
                        background: 'transparent', border: 'none', fontSize: 36, cursor: 'pointer',
                        filter: (hover || stars) >= n ? 'none' : 'grayscale(1) opacity(0.45)',
                        transition: 'filter 0.15s'
                      }}
                      aria-label={`${n} star${n > 1 ? 's' : ''}`}
                    >
                      ⭐
                    </motion.button>
                  ))}
                </div>

                <textarea
                  value={comments}
                  onChange={e => setComments(e.target.value)}
                  placeholder="Anything specific we should know? (optional)"
                  rows={3}
                  style={{
                    width: '100%', boxSizing: 'border-box', resize: 'vertical',
                    background: 'var(--bg-card, rgba(2,6,23,0.55))', border: '1px solid var(--border-color, #334155)',
                    borderRadius: 12, color: 'var(--text-main, #eef2ff)', padding: 12, fontSize: 14, outline: 'none', marginBottom: 18
                  }}
                />

                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={dismiss} style={{ flex: 1, background: 'transparent', border: '1px solid var(--border-color, #334155)', color: 'var(--text-muted, #94a3b8)', padding: '12px 0', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>
                    Skip
                  </button>
                  <button
                    onClick={submit}
                    disabled={stars === 0 || sending}
                    style={{
                      flex: 2, background: stars === 0 ? 'var(--border-color, #334155)' : 'var(--accent-primary, #22d3ee)',
                      color: '#000', border: 'none', padding: '12px 0', borderRadius: 10, fontWeight: 900,
                      cursor: stars === 0 ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {sending ? 'Sending…' : 'Submit Feedback'}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
