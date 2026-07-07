/**
 * @file coins.tsx
 * @author Rahul
 * @description Coin wallet — buy coins with real money (₹10 → 50 🪙 anchor)
 * once the 3 free AI-interview trials are burned. Razorpay for instant credit,
 * manual UPI + UTR as the zero-dependency path, admin coupon codes and
 * lucky-day discounts on top. Admins also verify UTRs and mint coupons here.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import toast, { Toaster } from 'react-hot-toast';
import { fetchApi } from '../lib/api';
import ContextLoader from '../components/ContextLoader';

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
  CREDITED: { label: 'Credited ✓', color: '#4ade80' },
  CANCELLED: { label: 'Cancelled', color: '#f87171' }
};

const STYLES: Record<string, React.CSSProperties> = {
  main: { minHeight: '100vh', padding: 'clamp(20px, 4vw, 50px)', background: 'var(--bg-main-gradient)', color: 'var(--text-main)', boxSizing: 'border-box' },
  shell: { maxWidth: 1050, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 },
  panel: { background: 'var(--bg-panel-solid)', padding: 'clamp(20px, 3vw, 32px)', borderRadius: 20, border: '1px solid var(--border-color)' },
  sectionTitle: { margin: '0 0 16px 0', fontSize: 19, fontWeight: 900, color: 'var(--text-main)' },
  input: { padding: '13px 16px', borderRadius: 12, background: 'var(--bg-main)', color: 'var(--text-main)', border: '1px solid var(--border-color)', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  primaryBtn: { padding: '13px 26px', borderRadius: 999, border: 0, background: 'linear-gradient(135deg, #a5b4fc, #22d3ee)', color: '#020617', fontWeight: 900, fontSize: 14, cursor: 'pointer' },
  ghostBtn: { padding: '11px 20px', borderRadius: 999, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-main)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }
};

export default function CoinsWallet() {
  const router = useRouter();

  const [loaded, setLoaded] = useState(false);
  const [balance, setBalance] = useState(0);
  const [sessionCost, setSessionCost] = useState(100);
  const [packs, setPacks] = useState<any[]>([]);
  const [luckyDeal, setLuckyDeal] = useState<any>(null);
  const [razorpayAvailable, setRazorpayAvailable] = useState(false);
  const [upiId, setUpiId] = useState('');
  const [purchases, setPurchases] = useState<any[]>([]);
  const [pendingVerifications, setPendingVerifications] = useState<any[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  // Coupon state
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<any>(null); // { code, percentOff }

  // Active payment instructions after creating a purchase
  const [payment, setPayment] = useState<any>(null);
  const [buyingPackId, setBuyingPackId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [utrInputs, setUtrInputs] = useState<Record<string, string>>({});

  // Admin coupon manager
  const [coupons, setCoupons] = useState<any[]>([]);
  const [newCoupon, setNewCoupon] = useState({ code: '', percentOff: '20', appliesTo: 'BOTH', maxUses: '', expiresAt: '' });

  const loadAll = async () => {
    try {
      const [packRes, purchRes] = await Promise.all([
        fetchApi('/api/v2/coins/packs'),
        fetchApi('/api/v2/coins/purchases')
      ]);
      setBalance(packRes.balance ?? purchRes.balance ?? 0);
      setSessionCost(packRes.sessionCost || 100);
      setPacks(packRes.packs || []);
      setLuckyDeal(packRes.luckyDeal || null);
      setRazorpayAvailable(!!packRes.razorpayAvailable);
      setUpiId(packRes.upiId || '');
      setPurchases(purchRes.purchases || []);
      setPendingVerifications(purchRes.pendingVerifications || []);
      setIsAdmin(!!purchRes.viewerIsAdmin);
      if (purchRes.viewerIsAdmin) {
        fetchApi('/api/v2/coins/coupons').then(r => setCoupons(r.coupons || [])).catch(() => {});
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load the coin store.');
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const applyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) return;
    try {
      const res = await fetchApi('/api/v2/coins/coupons/preview', {
        method: 'POST',
        body: JSON.stringify({ code, context: 'COINS' })
      });
      setCoupon(res);
      toast.success(`Coupon ${res.code} applied — ${res.percentOff}% off!`, { icon: '🎟️' });
    } catch (err: any) {
      setCoupon(null);
      toast.error(err?.message || 'Invalid coupon.');
    }
  };

  // Final price shown per pack: server applies best-of(lucky, coupon); mirror it.
  const finalPrice = (p: any) => {
    const luckyPct = luckyDeal?.coinPackPercentOff || 0;
    const pct = Math.max(luckyPct, coupon?.percentOff || 0);
    return Math.max(0, Math.round(p.priceInr * (100 - pct) / 100));
  };

  const buyPack = async (pack: any) => {
    if (buyingPackId) return;
    setBuyingPackId(pack.id);
    try {
      const res = await fetchApi('/api/v2/coins/purchases', {
        method: 'POST',
        body: JSON.stringify({ packId: pack.id, couponCode: coupon?.code })
      });
      if (res.credited) {
        toast.success(`${res.coins} coins credited — fully covered by your coupon! 🎉`, { duration: 6000 });
        setCoupon(null); setCouponInput('');
        loadAll();
      } else {
        setPayment({ ...res.payment, purchaseId: res.purchase.id, coins: pack.coins });
        toast.success('Purchase started — complete the payment below.', { icon: '🪙' });
        loadAll();
      }
    } catch (err: any) {
      toast.error(err?.message || 'Could not start the purchase.');
    } finally {
      setBuyingPackId(null);
    }
  };

  const payOnline = async (purchaseId: string) => {
    if (payingId) return;
    setPayingId(purchaseId);
    try {
      const order = await fetchApi(`/api/v2/coins/purchases/${purchaseId}/pay/order`, { method: 'POST', body: JSON.stringify({}) });
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
        modal: { ondismiss: () => setPayingId(null) },
        handler: async (resp: any) => {
          try {
            const v = await fetchApi(`/api/v2/coins/purchases/${purchaseId}/pay/verify`, { method: 'POST', body: JSON.stringify(resp) });
            toast.success(`Payment verified — ${v.coins} coins credited! New balance: ${v.newBalance} 🪙`, { icon: '🎉', duration: 6000 });
            setPayment(null);
            loadAll();
          } catch (err: any) {
            toast.error(err?.message || 'Payment made but verification failed — contact the admin with your payment ID.');
          } finally {
            setPayingId(null);
          }
        }
      });
      rzp.on('payment.failed', (resp: any) => {
        toast.error(resp?.error?.description || 'Payment failed — nothing was charged. Try again or use manual UPI.');
        setPayingId(null);
      });
      rzp.open();
    } catch (err: any) {
      toast.error(err?.message || 'Could not start the online payment.');
      setPayingId(null);
    }
  };

  const submitUtr = async (purchaseId: string) => {
    const ref = (utrInputs[purchaseId] || '').trim();
    if (ref.length < 6) return toast.error('Enter the UTR / transaction reference from your UPI app.');
    try {
      await fetchApi(`/api/v2/coins/purchases/${purchaseId}/payment`, {
        method: 'POST',
        body: JSON.stringify({ upiTransactionRef: ref })
      });
      toast.success('Reference submitted — coins land once the admin verifies.', { icon: '✅' });
      setPayment(null);
      loadAll();
    } catch (err: any) {
      toast.error(err?.message || 'Could not submit the reference.');
    }
  };

  const adminVerify = async (purchaseId: string) => {
    try {
      await fetchApi(`/api/v2/coins/purchases/${purchaseId}/verify`, { method: 'POST', body: JSON.stringify({}) });
      toast.success('Verified — coins credited to the buyer.', { icon: '🔓' });
      loadAll();
    } catch (err: any) {
      toast.error(err?.message || 'Verification failed.');
    }
  };

  const createCoupon = async () => {
    try {
      const res = await fetchApi('/api/v2/coins/coupons', {
        method: 'POST',
        body: JSON.stringify({
          code: newCoupon.code || undefined,
          percentOff: Number(newCoupon.percentOff),
          appliesTo: newCoupon.appliesTo,
          maxUses: newCoupon.maxUses ? Number(newCoupon.maxUses) : undefined,
          expiresAt: newCoupon.expiresAt || undefined
        })
      });
      toast.success(`Coupon ${res.coupon.code} minted — ${res.coupon.percentOff}% off.`, { icon: '🎟️' });
      setNewCoupon({ code: '', percentOff: '20', appliesTo: 'BOTH', maxUses: '', expiresAt: '' });
      fetchApi('/api/v2/coins/coupons').then(r => setCoupons(r.coupons || [])).catch(() => {});
    } catch (err: any) {
      toast.error(err?.message || 'Could not create the coupon.');
    }
  };

  const deactivateCoupon = async (id: string) => {
    try {
      await fetchApi(`/api/v2/coins/coupons/${id}/deactivate`, { method: 'POST', body: JSON.stringify({}) });
      toast.success('Coupon deactivated.');
      fetchApi('/api/v2/coins/coupons').then(r => setCoupons(r.coupons || [])).catch(() => {});
    } catch (err: any) {
      toast.error(err?.message || 'Failed.');
    }
  };

  return (
    <main style={STYLES.main}>
      <Toaster position="top-center" toastOptions={{ style: { background: 'var(--bg-panel-solid)', color: 'var(--text-main)', border: '1px solid var(--border-color)' } }} />
      <div style={STYLES.shell}>

        {/* Header + balance */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 'clamp(26px, 4vw, 34px)', fontWeight: 900 }}>🪙 Coin Wallet</h1>
            <p style={{ margin: '6px 0 0 0', color: 'var(--text-muted)', fontSize: 14 }}>
              AI interview sessions cost {sessionCost} coins after your free trials. Anchor rate: <strong>50 coins = ₹10</strong>.
            </p>
          </div>
          <div style={{ padding: '14px 26px', borderRadius: 16, background: 'var(--bg-card)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Balance</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: '#fbbf24' }}>{balance} 🪙</div>
          </div>
        </div>

        {/* Lucky day banner */}
        {luckyDeal?.label && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            style={{ padding: '14px 20px', borderRadius: 14, background: 'rgba(74,222,128,0.09)', border: '1px solid rgba(74,222,128,0.4)', color: '#4ade80', fontWeight: 700, fontSize: 14 }}>
            {luckyDeal.label}
          </motion.div>
        )}

        {/* Coupon */}
        <section style={STYLES.panel}>
          <h2 style={STYLES.sectionTitle}>🎟️ Have a coupon?</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              value={couponInput}
              onChange={e => setCouponInput(e.target.value.toUpperCase())}
              placeholder="COUPON CODE"
              style={{ ...STYLES.input, flex: '1 1 200px', fontFamily: 'monospace', letterSpacing: 2 }}
            />
            <button onClick={applyCoupon} style={STYLES.primaryBtn}>Apply</button>
            {coupon && (
              <button onClick={() => { setCoupon(null); setCouponInput(''); }} style={STYLES.ghostBtn}>
                ✕ Remove {coupon.code} (−{coupon.percentOff}%)
              </button>
            )}
          </div>
          <p style={{ margin: '10px 0 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
            Coupons and lucky-day deals don't stack — you automatically get whichever discount is bigger.
          </p>
        </section>

        {/* Packs */}
        <section style={STYLES.panel}>
          <h2 style={STYLES.sectionTitle}>Buy Coins</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {packs.map(p => {
              const price = finalPrice(p);
              const slashed = price < p.priceInr;
              return (
                <motion.div key={p.id} whileHover={{ y: -4 }}
                  style={{ padding: 22, borderRadius: 16, background: 'var(--bg-card)', border: p.tag === 'Most popular' ? '1px solid #a5b4fc' : '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
                  {p.tag && (
                    <span style={{ position: 'absolute', top: -10, right: 12, padding: '3px 12px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: 'linear-gradient(135deg,#a5b4fc,#22d3ee)', color: '#020617' }}>{p.tag}</span>
                  )}
                  <div style={{ fontSize: 30, fontWeight: 900, color: '#fbbf24' }}>{p.coins} 🪙</div>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>
                    {slashed && <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)', fontSize: 14, marginRight: 8 }}>₹{p.priceInr}</span>}
                    ₹{price}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>≈ {(p.coins / Math.max(1, price)).toFixed(1)} coins/₹</div>
                  <button disabled={!!buyingPackId} onClick={() => buyPack(p)} style={{ ...STYLES.primaryBtn, opacity: buyingPackId ? 0.6 : 1 }}>
                    {buyingPackId === p.id ? 'Starting…' : price === 0 ? 'Claim Free' : 'Buy Now'}
                  </button>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* Fresh payment instructions */}
        <AnimatePresence>
          {payment && (
            <motion.section initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              style={{ ...STYLES.panel, border: '1px solid rgba(251,191,36,0.5)', background: 'rgba(251,191,36,0.06)' }}>
              <h2 style={{ ...STYLES.sectionTitle, color: '#fbbf24' }}>Complete Your Payment — ₹{payment.amountInr} for {payment.coins} 🪙</h2>

              {(payment.razorpayAvailable || razorpayAvailable) && (
                <div style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '1px dashed var(--border-color)' }}>
                  <button onClick={() => payOnline(payment.purchaseId)} disabled={!!payingId}
                    style={{ ...STYLES.primaryBtn, fontSize: 15, padding: '15px 32px', opacity: payingId ? 0.6 : 1 }}>
                    💳 Pay ₹{payment.amountInr} Online (Card / UPI / NetBanking)
                  </button>
                  <span style={{ display: 'block', marginTop: 8, fontSize: 12.5, color: 'var(--text-muted)' }}>
                    Instant credit — no waiting for manual verification.
                  </span>
                </div>
              )}

              <p style={{ margin: '0 0 14px 0', fontSize: 14, lineHeight: 1.7 }}>
                {(payment.razorpayAvailable || razorpayAvailable) ? 'Or pay manually: ' : ''}
                Pay <strong style={{ fontSize: 17 }}>₹{payment.amountInr}</strong> to UPI ID{' '}
                <strong style={{ cursor: 'pointer', textDecoration: 'underline dotted' }} title="Click to copy"
                  onClick={() => { navigator.clipboard?.writeText(payment.upiId); toast.success('UPI ID copied'); }}>
                  {payment.upiId}
                </strong>{' '}
                from any UPI app, then submit the UTR below.
              </p>
              <a href={payment.upiLink} style={{ display: 'inline-block', marginBottom: 16, fontSize: 13, color: '#22d3ee' }}>
                📱 Open in UPI app
              </a>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <input
                  value={utrInputs[payment.purchaseId] || ''}
                  onChange={e => setUtrInputs(s => ({ ...s, [payment.purchaseId]: e.target.value }))}
                  placeholder="UTR / Transaction Reference"
                  style={{ ...STYLES.input, flex: '1 1 220px' }}
                />
                <button onClick={() => submitUtr(payment.purchaseId)} style={STYLES.primaryBtn}>Submit UTR</button>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Admin: pending UTR verifications */}
        {isAdmin && pendingVerifications.length > 0 && (
          <section style={{ ...STYLES.panel, border: '1px solid rgba(34,211,238,0.4)' }}>
            <h2 style={{ ...STYLES.sectionTitle, color: '#22d3ee' }}>🔐 Admin — UTRs Awaiting Verification</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pendingVerifications.map(p => (
                <div key={p.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                    <strong>{p.user?.username || p.user?.email}</strong> · {p.coins} 🪙 for ₹{p.amountInr}
                    {p.couponCode ? <> · coupon <code>{p.couponCode}</code></> : null}
                    <br />UTR: <code style={{ color: '#fbbf24' }}>{p.upiTransactionRef}</code>
                  </div>
                  <button onClick={() => adminVerify(p.id)} style={STYLES.primaryBtn}>✓ Verify & Credit</button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Admin: coupon manager */}
        {isAdmin && (
          <section style={STYLES.panel}>
            <h2 style={STYLES.sectionTitle}>🎟️ Admin — Coupons</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
              <input value={newCoupon.code} onChange={e => setNewCoupon(s => ({ ...s, code: e.target.value.toUpperCase() }))} placeholder="CODE (auto if blank)" style={STYLES.input} />
              <input value={newCoupon.percentOff} onChange={e => setNewCoupon(s => ({ ...s, percentOff: e.target.value }))} placeholder="% off (1–100)" type="number" min={1} max={100} style={STYLES.input} />
              <select value={newCoupon.appliesTo} onChange={e => setNewCoupon(s => ({ ...s, appliesTo: e.target.value }))} style={STYLES.input}>
                <option value="BOTH">Coins + AI Sessions</option>
                <option value="COINS">Coins only</option>
                <option value="AI_SESSION">AI Sessions only</option>
              </select>
              <input value={newCoupon.maxUses} onChange={e => setNewCoupon(s => ({ ...s, maxUses: e.target.value }))} placeholder="Max uses (∞ if blank)" type="number" min={1} style={STYLES.input} />
              <input value={newCoupon.expiresAt} onChange={e => setNewCoupon(s => ({ ...s, expiresAt: e.target.value }))} type="datetime-local" style={STYLES.input} />
            </div>
            <button onClick={createCoupon} style={STYLES.primaryBtn}>+ Mint Coupon</button>

            {coupons.length > 0 && (
              <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {coupons.map(c => (
                  <div key={c.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border-color)', fontSize: 13 }}>
                    <span>
                      <code style={{ fontWeight: 800, color: '#a5b4fc' }}>{c.code}</code> · {c.percentOff}% · {c.appliesTo}
                      · used {c.usedCount}{c.maxUses ? `/${c.maxUses}` : ''}
                      {c.expiresAt ? ` · expires ${new Date(c.expiresAt).toLocaleDateString('en-IN')}` : ''}
                      {!c.active && <strong style={{ color: '#f87171' }}> · INACTIVE</strong>}
                    </span>
                    {c.active && <button onClick={() => deactivateCoupon(c.id)} style={{ ...STYLES.ghostBtn, padding: '6px 14px', fontSize: 12 }}>Deactivate</button>}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Purchase history */}
        <section style={STYLES.panel}>
          <h2 style={STYLES.sectionTitle}>Purchase History</h2>
          {!loaded ? (
            <ContextLoader context="coins" compact />
          ) : purchases.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No purchases yet — grab a pack above when your free trials run out.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {purchases.map(p => {
                const meta = STATUS_META[p.status] || { label: p.status, color: 'var(--text-muted)' };
                return (
                  <div key={p.id} style={{ padding: 14, borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontSize: 14 }}>
                        <strong>{p.coins} 🪙</strong> for ₹{p.amountInr}
                        {p.discountInr > 0 && <span style={{ color: '#4ade80', fontSize: 12.5 }}> (saved ₹{p.discountInr}{p.couponCode ? ` · ${p.couponCode}` : ''})</span>}
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>{new Date(p.createdAt).toLocaleString('en-IN')}</span>
                      </div>
                      <span style={{ padding: '5px 14px', borderRadius: 999, fontSize: 12, fontWeight: 800, color: meta.color, border: `1px solid ${meta.color}` }}>{meta.label}</span>
                    </div>
                    {p.status === 'PENDING_PAYMENT' && (
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
                        {razorpayAvailable && (
                          <button onClick={() => payOnline(p.id)} disabled={!!payingId} style={{ ...STYLES.primaryBtn, padding: '10px 20px', fontSize: 13, opacity: payingId ? 0.6 : 1 }}>
                            💳 Pay Online
                          </button>
                        )}
                        <input
                          value={utrInputs[p.id] || ''}
                          onChange={e => setUtrInputs(s => ({ ...s, [p.id]: e.target.value }))}
                          placeholder="UTR (if paid manually)"
                          style={{ ...STYLES.input, flex: '1 1 180px', padding: '10px 14px', fontSize: 13 }}
                        />
                        <button onClick={() => submitUtr(p.id)} style={{ ...STYLES.ghostBtn }}>Submit UTR</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <button onClick={() => router.push('/recruiter')} style={{ ...STYLES.ghostBtn, alignSelf: 'center' }}>
          ← Back to AI Recruiter
        </button>
      </div>
    </main>
  );
}
