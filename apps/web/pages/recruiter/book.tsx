/**
 * @file book.tsx
 * @author Rahul Kumar Sahoo
 * @description Real Recruiter Marketplace — book a paid 1:1 mock interview with
 * a human recruiter. Payment flows over UPI to the platform handle; the admin
 * verifies the UTR and confirms the slot.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import toast, { Toaster } from 'react-hot-toast';
import { fetchApi } from '../../lib/api';

// Razorpay Checkout ships as a plain script; one load serves every payment.
let razorpayScript: Promise<void> | null = null;
function loadRazorpay(): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).Razorpay) return Promise.resolve();
  if (!razorpayScript) {
    razorpayScript = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = () => resolve();
      s.onerror = () => { razorpayScript = null; reject(new Error('Could not load the payment gateway.')); };
      document.body.appendChild(s);
    });
  }
  return razorpayScript;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  PENDING_PAYMENT: { label: 'Awaiting Your Payment', color: '#fbbf24' },
  AWAITING_VERIFICATION: { label: 'Payment Under Verification', color: '#22d3ee' },
  CONFIRMED: { label: 'Confirmed ✓', color: '#4ade80' },
  COMPLETED: { label: 'Completed', color: '#a5b4fc' },
  CANCELLED: { label: 'Cancelled', color: '#ef4444' }
};

const STYLES: Record<string, React.CSSProperties> = {
  main: { minHeight: '100vh', background: 'var(--bg-main-gradient)', color: 'var(--text-main)', padding: 'clamp(20px, 4vw, 50px)', boxSizing: 'border-box' },
  shell: { maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 26 },
  panel: { background: 'var(--bg-panel-solid)', border: '1px solid var(--border-color)', borderRadius: 20, padding: 'clamp(20px, 3vw, 30px)' },
  sectionTitle: { margin: '0 0 16px 0', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--accent-primary)', fontWeight: 800 },
  input: { width: '100%', padding: 14, borderRadius: 12, background: 'var(--bg-main)', color: 'var(--text-main)', border: '1px solid var(--border-color)', boxSizing: 'border-box', fontSize: 14, outline: 'none' },
  primaryBtn: { padding: '14px 26px', borderRadius: 999, border: 0, background: 'linear-gradient(135deg, #a5b4fc, #22d3ee)', color: '#020617', fontWeight: 800, fontSize: 14, cursor: 'pointer' },
  ghostBtn: { padding: '12px 22px', borderRadius: 999, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-main)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }
};

// Same fields whether a user is applying or the admin is listing someone directly.
function RecruiterFormFields({ form, setForm }: { form: any; setForm: (updater: any) => void }) {
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev: any) => ({ ...prev, [key]: e.target.value }));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
      <input placeholder="Full name" value={form.name} onChange={set('name')} style={STYLES.input} />
      <input placeholder="Title (e.g. Senior SWE)" value={form.title} onChange={set('title')} style={STYLES.input} />
      <input placeholder="Company (e.g. ex-Google)" value={form.company} onChange={set('company')} style={STYLES.input} />
      <input placeholder="Expertise, comma separated (DSA, System Design)" value={form.expertise} onChange={set('expertise')} style={STYLES.input} />
      <input placeholder="Per-session fee (INR)" type="number" min={1} value={form.feeInr} onChange={set('feeInr')} style={STYLES.input} />
      <input placeholder="Contact number (kept private, admin only)" value={form.contactPhone} onChange={set('contactPhone')} style={STYLES.input} />
      <textarea
        placeholder="Short bio — your background and what you interview candidates on"
        value={form.bio}
        onChange={set('bio')}
        rows={3}
        style={{ ...STYLES.input, gridColumn: '1 / -1', resize: 'vertical', fontFamily: 'inherit' }}
      />
    </div>
  );
}

export default function RecruiterMarketplace() {
  const router = useRouter();

  const [recruiters, setRecruiters] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [assignedBookings, setAssignedBookings] = useState<any[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [razorpayAvailable, setRazorpayAvailable] = useState(false);
  const [payingBookingId, setPayingBookingId] = useState<string | null>(null);

  // Booking flow state
  const [selected, setSelected] = useState<any>(null);
  const [preferredAt, setPreferredAt] = useState('');
  const [note, setNote] = useState('');
  const [isBooking, setIsBooking] = useState(false);
  const [payment, setPayment] = useState<any>(null); // instructions for the just-created booking
  const [utrInputs, setUtrInputs] = useState<Record<string, string>>({});

  // Recruiter onboarding: users apply, the admin reviews. Admins can also add
  // a listing directly. Both forms share the same field shape.
  const emptyRecruiterForm = { name: '', title: '', company: '', expertise: '', feeInr: '', contactPhone: '', bio: '' };
  const [myApplication, setMyApplication] = useState<any>(null);
  const [pendingApps, setPendingApps] = useState<any[]>([]);
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [applyForm, setApplyForm] = useState({ ...emptyRecruiterForm });
  const [adminForm, setAdminForm] = useState({ ...emptyRecruiterForm });
  const [savingRecruiter, setSavingRecruiter] = useState(false);

  const loadAll = async () => {
    try {
      const [recRes, bookRes] = await Promise.all([
        fetchApi('/api/v2/recruiter/human-recruiters'),
        fetchApi('/api/v2/recruiter/bookings')
      ]);
      setRecruiters(recRes.recruiters || []);
      setMyApplication(recRes.myApplication || null);
      setPendingApps(recRes.pendingApplications || []);
      setBookings(bookRes.bookings || []);
      setAssignedBookings(bookRes.assignedBookings || []);
      setRazorpayAvailable(!!bookRes.razorpayAvailable);
      setIsAdmin(!!recRes.viewerIsAdmin || !!bookRes.viewerIsAdmin);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load the marketplace.');
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const createBooking = async () => {
    if (!selected || !preferredAt) return toast.error('Pick a recruiter and a slot.');
    setIsBooking(true);
    try {
      const res = await fetchApi('/api/v2/recruiter/bookings', {
        method: 'POST',
        body: JSON.stringify({ recruiterId: selected.id, preferredAt: new Date(preferredAt).toISOString(), note })
      });
      setPayment({ ...res.payment, bookingId: res.booking.id });
      setSelected(null);
      setPreferredAt('');
      setNote('');
      toast.success('Slot requested — complete the payment to lock it in.', { icon: '🧾' });
      loadAll();
    } catch (err: any) {
      toast.error(err?.message || 'Booking failed.');
    } finally {
      setIsBooking(false);
    }
  };

  // Online payment: card / UPI / netbanking / wallets — Razorpay Checkout picks
  // the modes. Verified server-side by signature; booking confirms instantly.
  const payOnline = async (bookingId: string) => {
    if (payingBookingId) return;
    setPayingBookingId(bookingId);
    try {
      const order = await fetchApi(`/api/v2/recruiter/bookings/${bookingId}/pay/order`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      await loadRazorpay();

      const rzp = new (window as any).Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: order.name,
        description: order.description,
        prefill: order.prefill,
        theme: { color: '#6366f1' },
        modal: { ondismiss: () => setPayingBookingId(null) },
        handler: async (resp: any) => {
          try {
            await fetchApi(`/api/v2/recruiter/bookings/${bookingId}/pay/verify`, {
              method: 'POST',
              body: JSON.stringify(resp)
            });
            toast.success('Payment verified — your interview is confirmed! The live room link is in your email.', { icon: '🎉', duration: 6000 });
            setPayment(null);
            loadAll();
          } catch (err: any) {
            toast.error(err?.message || 'Payment made but verification failed — contact the admin with your payment ID.');
          } finally {
            setPayingBookingId(null);
          }
        }
      });
      rzp.on('payment.failed', (resp: any) => {
        toast.error(resp?.error?.description || 'Payment failed — nothing was charged. Try again or use manual UPI.');
        setPayingBookingId(null);
      });
      rzp.open();
    } catch (err: any) {
      toast.error(err?.message || 'Could not start the online payment.');
      setPayingBookingId(null);
    }
  };

  const submitUtr = async (bookingId: string) => {
    const ref = (utrInputs[bookingId] || '').trim();
    if (ref.length < 6) return toast.error('Enter the UTR / transaction reference from your UPI app.');
    try {
      await fetchApi(`/api/v2/recruiter/bookings/${bookingId}/payment`, {
        method: 'POST',
        body: JSON.stringify({ upiTransactionRef: ref })
      });
      toast.success('Reference submitted — the admin will verify and confirm your slot.', { icon: '✅' });
      setPayment(null);
      loadAll();
    } catch (err: any) {
      toast.error(err?.message || 'Could not submit the reference.');
    }
  };

  const adminVerify = async (bookingId: string) => {
    try {
      await fetchApi(`/api/v2/recruiter/bookings/${bookingId}/verify`, { method: 'POST', body: JSON.stringify({}) });
      toast.success('Payment verified — booking confirmed.', { icon: '🔓' });
      loadAll();
    } catch (err: any) {
      toast.error(err?.message || 'Verification failed.');
    }
  };

  const cancelBooking = async (bookingId: string) => {
    try {
      await fetchApi(`/api/v2/recruiter/bookings/${bookingId}/cancel`, { method: 'POST', body: JSON.stringify({}) });
      toast.success('Booking cancelled.');
      loadAll();
    } catch (err: any) {
      toast.error(err?.message || 'Cancellation failed.');
    }
  };

  const recruiterPayloadFrom = (form: typeof emptyRecruiterForm) => ({
    name: form.name.trim(),
    title: form.title.trim(),
    company: form.company.trim(),
    expertise: form.expertise.split(',').map(s => s.trim()).filter(Boolean),
    feeInr: Number(form.feeInr),
    contactPhone: form.contactPhone.trim(),
    bio: form.bio.trim()
  });

  const submitApplication = async () => {
    if (!applyForm.name.trim() || !applyForm.title.trim() || !applyForm.company.trim()) {
      return toast.error('Fill in your name, title and company.');
    }
    if (!Number.isFinite(Number(applyForm.feeInr)) || Number(applyForm.feeInr) <= 0) {
      return toast.error('Set your per-session fee in INR.');
    }
    if (applyForm.contactPhone.replace(/\D/g, '').length < 10) {
      return toast.error('Add a contact number — the admin needs it for scheduling and payouts.');
    }
    setSavingRecruiter(true);
    try {
      await fetchApi('/api/v2/recruiter/human-recruiters/apply', {
        method: 'POST',
        body: JSON.stringify(recruiterPayloadFrom(applyForm))
      });
      toast.success('Application sent — the admin will review it and get back to you.', { icon: '🧑‍💼', duration: 5000 });
      setShowApplyForm(false);
      loadAll();
    } catch (err: any) {
      toast.error(err?.message || 'Could not submit the application.');
    } finally {
      setSavingRecruiter(false);
    }
  };

  const adminAddRecruiter = async () => {
    if (!adminForm.name.trim() || !adminForm.title.trim() || !adminForm.company.trim()) {
      return toast.error('Name, title and company are required.');
    }
    if (!Number.isFinite(Number(adminForm.feeInr)) || Number(adminForm.feeInr) <= 0) {
      return toast.error('Set a valid per-session fee.');
    }
    setSavingRecruiter(true);
    try {
      await fetchApi('/api/v2/recruiter/human-recruiters', {
        method: 'POST',
        body: JSON.stringify(recruiterPayloadFrom(adminForm))
      });
      toast.success('Recruiter listed.', { icon: '✅' });
      setAdminForm({ ...emptyRecruiterForm });
      loadAll();
    } catch (err: any) {
      toast.error(err?.message || 'Could not add the recruiter.');
    } finally {
      setSavingRecruiter(false);
    }
  };

  const decideApplication = async (applicationId: string, decision: 'approve' | 'reject') => {
    try {
      await fetchApi(`/api/v2/recruiter/human-recruiters/${applicationId}/${decision}`, { method: 'POST', body: JSON.stringify({}) });
      toast.success(decision === 'approve' ? 'Approved — recruiter is now live in the directory.' : 'Application rejected.');
      loadAll();
    } catch (err: any) {
      toast.error(err?.message || 'Could not update the application.');
    }
  };

  return (
    <main style={STYLES.main}>
      <Toaster position="top-center" toastOptions={{ style: { background: 'var(--bg-panel-solid)', color: 'var(--text-main)', border: '1px solid var(--border-color)' } }} />
      <div style={STYLES.shell}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 'clamp(24px, 4vw, 32px)', fontWeight: 900 }}>🧑‍💼 Real Recruiter Sessions</h1>
            <p style={{ margin: '6px 0 0 0', color: 'var(--text-muted)', fontSize: 14 }}>
              1:1 live video mock interviews with experienced engineers & recruiters. Pay by card, UPI, netbanking or wallet — then meet face to face in the live room.
            </p>
          </div>
          <button onClick={() => router.push('/recruiter')} style={STYLES.ghostBtn}>← AI Recruiter</button>
        </div>

        {/* Fresh payment instructions (after creating a booking) */}
        <AnimatePresence>
          {payment && (
            <motion.section initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} style={{ ...STYLES.panel, border: '1px solid rgba(251,191,36,0.5)', background: 'rgba(251,191,36,0.06)' }}>
              <h2 style={{ ...STYLES.sectionTitle, color: '#fbbf24' }}>Complete Your Payment — ₹{payment.amountInr}</h2>

              {(payment.razorpayAvailable || razorpayAvailable) && (
                <div style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '1px dashed var(--border-color)' }}>
                  <button
                    onClick={() => payOnline(payment.bookingId)}
                    disabled={!!payingBookingId}
                    style={{ ...STYLES.primaryBtn, fontSize: 15, padding: '15px 32px', opacity: payingBookingId ? 0.6 : 1 }}
                  >
                    {payingBookingId ? 'Opening gateway…' : '💳 Pay Online — Card · UPI · NetBanking · Wallet'}
                  </button>
                  <span style={{ display: 'block', marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                    Instant confirmation — no waiting for manual verification.
                  </span>
                </div>
              )}

              <p style={{ margin: '0 0 14px 0', fontSize: 14, lineHeight: 1.7 }}>
                {(payment.razorpayAvailable || razorpayAvailable) ? 'Or pay manually: ' : ''}
                Pay <strong style={{ fontSize: 17 }}>₹{payment.amountInr}</strong> to UPI ID{' '}
                <strong
                  style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                  title="Click to copy"
                  onClick={() => { navigator.clipboard?.writeText(payment.upiId); toast.success('UPI ID copied'); }}
                >{payment.upiId}</strong>{' '}
                from any UPI app (GPay / PhonePe / Paytm). Mention reference <code>{String(payment.bookingId).slice(-8)}</code>.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <a href={payment.upiLink} style={{ ...STYLES.primaryBtn, textDecoration: 'none', display: 'inline-block' }}>📲 Open UPI App (mobile)</a>
                <input
                  placeholder="Paste UTR / transaction reference after paying"
                  value={utrInputs[payment.bookingId] || ''}
                  onChange={(e) => setUtrInputs(prev => ({ ...prev, [payment.bookingId]: e.target.value }))}
                  style={{ ...STYLES.input, flex: 1, minWidth: 240, width: 'auto' }}
                />
                <button onClick={() => submitUtr(payment.bookingId)} style={STYLES.primaryBtn}>Submit Reference</button>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Admin: applications waiting on a decision */}
        {isAdmin && pendingApps.length > 0 && (
          <section style={{ ...STYLES.panel, border: '1px solid rgba(34,211,238,0.45)' }}>
            <h2 style={{ ...STYLES.sectionTitle, color: '#22d3ee' }}>Recruiter Applications ({pendingApps.length})</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pendingApps.map(a => (
                <div key={a.id} style={{ padding: 16, borderRadius: 14, background: 'var(--bg-card)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ fontSize: 14 }}>
                      <strong>{a.name}</strong>
                      <span style={{ color: 'var(--text-muted)' }}> · {a.title} · {a.company} · ₹{a.feeInr}/session</span>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {a.user?.email}{a.contactPhone ? ` · 📞 ${a.contactPhone}` : ''}
                    </span>
                  </div>
                  {a.expertise?.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {a.expertise.map((e: string) => (
                        <span key={e} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: 'rgba(165,180,252,0.12)', color: '#a5b4fc', border: '1px solid rgba(165,180,252,0.25)' }}>{e}</span>
                      ))}
                    </div>
                  )}
                  {a.bio && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>{a.bio}</p>}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button onClick={() => decideApplication(a.id, 'approve')} style={{ ...STYLES.primaryBtn, padding: '10px 20px', fontSize: 13, background: '#4ade80' }}>✓ Approve & List</button>
                    <button onClick={() => decideApplication(a.id, 'reject')} style={STYLES.ghostBtn}>Reject</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Recruiter Directory */}
        <section style={STYLES.panel}>
          <h2 style={STYLES.sectionTitle}>Available Recruiters</h2>
          {!loaded ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading directory…</p>
          ) : recruiters.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.7 }}>
              No recruiters are listed yet. {isAdmin ? 'Add one below, or approve a pending application.' : 'Check back soon — or apply below and become the first.'}
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {recruiters.map(r => (
                <div key={r.id} style={{ background: 'var(--bg-card)', border: `1px solid ${selected?.id === r.id ? 'var(--accent-primary)' : 'var(--border-color)'}`, borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #22d3ee)', display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 18, color: '#020617', flexShrink: 0 }}>
                      {r.name.charAt(0)}
                    </div>
                    <div>
                      <strong style={{ display: 'block', fontSize: 15 }}>{r.name}</strong>
                      <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{r.title} · {r.company}</span>
                    </div>
                  </div>
                  {r.expertise?.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {r.expertise.map((e: string) => (
                        <span key={e} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: 'rgba(165,180,252,0.12)', color: '#a5b4fc', border: '1px solid rgba(165,180,252,0.25)' }}>{e}</span>
                      ))}
                    </div>
                  )}
                  {r.bio && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>{r.bio}</p>}
                  <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 }}>
                    <div style={{ fontSize: 13 }}>
                      <strong style={{ fontSize: 18 }}>₹{r.totalInr}</strong>
                      <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11 }}>₹{r.feeInr} recruiter + ₹{r.platformFeeInr} platform</span>
                    </div>
                    <button onClick={() => setSelected(selected?.id === r.id ? null : r)} style={{ ...STYLES.primaryBtn, padding: '10px 20px', fontSize: 13 }}>
                      {selected?.id === r.id ? 'Selected ✓' : 'Book'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Slot picker for the selected recruiter */}
          <AnimatePresence>
            {selected && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
                <div style={{ marginTop: 20, padding: 20, borderRadius: 14, background: 'var(--bg-card)', border: '1px solid var(--accent-primary)', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <strong style={{ fontSize: 14 }}>Request a slot with {selected.name} — total ₹{selected.totalInr}</strong>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <input type="datetime-local" value={preferredAt} onChange={(e) => setPreferredAt(e.target.value)} style={{ ...STYLES.input, width: 'auto', flex: '0 0 auto' }} />
                    <input placeholder="Anything the recruiter should focus on? (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...STYLES.input, flex: 1, minWidth: 220, width: 'auto' }} />
                    <button disabled={isBooking} onClick={createBooking} style={{ ...STYLES.primaryBtn, opacity: isBooking ? 0.6 : 1 }}>
                      {isBooking ? 'Requesting…' : 'Request Slot →'}
                    </button>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>The slot locks after payment — instantly for online payment, or once the admin verifies a manual UPI transfer.</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Become a recruiter — users apply here, listing goes live after my approval */}
        {!isAdmin && loaded && (
          <section style={STYLES.panel}>
            <h2 style={STYLES.sectionTitle}>Become a Recruiter</h2>
            {myApplication?.status === 'PENDING' ? (
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>
                ⏳ Your application (<strong>{myApplication.title} · {myApplication.company}</strong>) is under review.
                The admin will approve or reject it — check back here for the result.
              </p>
            ) : myApplication?.status === 'APPROVED' ? (
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>
                ✅ You are live in the directory at <strong>₹{myApplication.feeInr}/session</strong>. Candidates can book you now.
                Contact the admin if you want to change your listing.
              </p>
            ) : (
              <>
                {myApplication?.status === 'REJECTED' && (
                  <p style={{ margin: '0 0 14px 0', fontSize: 13.5, color: '#fbbf24', lineHeight: 1.6 }}>
                    Your previous application was not accepted. Update the details below and reapply.
                  </p>
                )}
                {!showApplyForm ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                    <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.7, flex: 1, minWidth: 240 }}>
                      Experienced engineer or hiring manager? Take paid 1:1 mock interviews here — you set your fee,
                      the platform brings candidates and handles payment collection.
                    </p>
                    <button onClick={() => setShowApplyForm(true)} style={STYLES.primaryBtn}>Apply to be a Recruiter →</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <RecruiterFormFields form={applyForm} setForm={setApplyForm} />
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button disabled={savingRecruiter} onClick={submitApplication} style={{ ...STYLES.primaryBtn, opacity: savingRecruiter ? 0.6 : 1 }}>
                        {savingRecruiter ? 'Sending…' : 'Send Application to Admin'}
                      </button>
                      <button onClick={() => setShowApplyForm(false)} style={STYLES.ghostBtn}>Cancel</button>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Your listing appears in the directory only after the admin verifies and approves it.
                    </span>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* Admin: list a recruiter directly (no application needed) */}
        {isAdmin && (
          <section style={STYLES.panel}>
            <h2 style={STYLES.sectionTitle}>Add a Recruiter Listing</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <RecruiterFormFields form={adminForm} setForm={setAdminForm} />
              <div>
                <button disabled={savingRecruiter} onClick={adminAddRecruiter} style={{ ...STYLES.primaryBtn, opacity: savingRecruiter ? 0.6 : 1 }}>
                  {savingRecruiter ? 'Saving…' : '+ List Recruiter'}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Recruiter's own schedule — sessions candidates booked WITH them */}
        {assignedBookings.length > 0 && (
          <section style={{ ...STYLES.panel, border: '1px solid rgba(74,222,128,0.4)' }}>
            <h2 style={{ ...STYLES.sectionTitle, color: '#4ade80' }}>My Interview Assignments (as Recruiter)</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {assignedBookings.map(b => (
                <div key={b.id} style={{ padding: 16, borderRadius: 14, background: 'var(--bg-card)', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ fontSize: 14 }}>
                    <strong>{b.user?.name || b.user?.username}</strong>
                    <span style={{ color: 'var(--text-muted)' }}> · {new Date(b.preferredAt).toLocaleString()} · you earn ₹{b.recruiterFeeInr}</span>
                    {b.note && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>Focus: {b.note}</span>}
                  </div>
                  {b.status === 'CONFIRMED' ? (
                    <button
                      onClick={() => router.push(`/recruiter/call/${b.id}`)}
                      style={{ ...STYLES.primaryBtn, padding: '10px 22px', fontSize: 13, background: '#4ade80' }}
                    >
                      🎥 Join as Interviewer
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#a5b4fc' }}>COMPLETED</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* My Bookings / Admin Verification Queue */}
        <section style={STYLES.panel}>
          <h2 style={STYLES.sectionTitle}>{isAdmin ? 'All Bookings (Admin Verification Queue)' : 'My Bookings'}</h2>
          {bookings.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No bookings yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {bookings.map(b => {
                const meta = STATUS_META[b.status] || STATUS_META.PENDING_PAYMENT;
                return (
                  <div key={b.id} style={{ padding: 16, borderRadius: 14, background: 'var(--bg-card)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ fontSize: 14 }}>
                        <strong>{b.recruiter?.name}</strong>
                        <span style={{ color: 'var(--text-muted)' }}> · {new Date(b.preferredAt).toLocaleString()} · ₹{b.totalInr}</span>
                        {isAdmin && b.user && <span style={{ color: 'var(--text-muted)' }}> · {b.user.email}</span>}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 800, color: meta.color, border: `1px solid ${meta.color}55`, padding: '4px 12px', borderRadius: 999, background: `${meta.color}11` }}>
                        {meta.label}
                      </span>
                    </div>

                    {b.status === 'PENDING_PAYMENT' && !isAdmin && (
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        {razorpayAvailable && (
                          <button
                            onClick={() => payOnline(b.id)}
                            disabled={!!payingBookingId}
                            style={{ ...STYLES.primaryBtn, padding: '10px 20px', fontSize: 13, opacity: payingBookingId ? 0.6 : 1 }}
                          >
                            💳 Pay Online
                          </button>
                        )}
                        <input
                          placeholder="Paid via UPI? Paste your UTR reference"
                          value={utrInputs[b.id] || ''}
                          onChange={(e) => setUtrInputs(prev => ({ ...prev, [b.id]: e.target.value }))}
                          style={{ ...STYLES.input, flex: 1, minWidth: 200, width: 'auto' }}
                        />
                        <button onClick={() => submitUtr(b.id)} style={{ ...STYLES.primaryBtn, padding: '10px 20px', fontSize: 13 }}>Submit</button>
                        <button onClick={() => cancelBooking(b.id)} style={STYLES.ghostBtn}>Cancel</button>
                      </div>
                    )}

                    {b.status === 'CONFIRMED' && (
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                          onClick={() => router.push(`/recruiter/call/${b.id}`)}
                          style={{ ...STYLES.primaryBtn, padding: '10px 22px', fontSize: 13, background: '#4ade80' }}
                        >
                          🎥 Join Live Interview
                        </button>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          Room opens anytime — join at your slot: {new Date(b.preferredAt).toLocaleString()}
                        </span>
                      </div>
                    )}

                    {b.upiTransactionRef && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>UTR: <code>{b.upiTransactionRef}</code></span>
                    )}

                    {isAdmin && b.status === 'AWAITING_VERIFICATION' && (
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button onClick={() => adminVerify(b.id)} style={{ ...STYLES.primaryBtn, padding: '10px 20px', fontSize: 13, background: '#4ade80' }}>✓ Verify & Confirm</button>
                        <button onClick={() => cancelBooking(b.id)} style={STYLES.ghostBtn}>Reject / Cancel</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
