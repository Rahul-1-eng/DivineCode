/**
 * @file coinRoutes.ts
 * @author Rahul
 * @description Coin wallet top-ups (₹10 → 50 🪙 anchor) so users can keep doing
 * AI interviews after their 3 free trials. Same dual payment rail as recruiter
 * bookings — Razorpay (instant, signature-verified) or manual UPI + UTR with
 * admin verification — plus admin-minted coupon codes and lucky-day discounts.
 */

import { Router } from 'express';
import { prisma } from '../prisma/client';
import { resolvedViewerFromRequest } from '../modules/contests/contestRules';
import { createRazorpayOrder, verifyRazorpaySignature, razorpayEnabled, razorpayKeyId } from '../modules/payments/razorpayService';
import { todayLuckyDeal, validateCoupon, redeemCoupon, applyPercentOff, CouponError } from '../modules/payments/promoService';
import { mailCoinPurchaseCreated, mailCoinPurchaseUnderVerification, mailCoinsCredited } from '../modules/email/emailService';

export const coinRouter = Router();

// Anchor rate: ₹10 = 50 coins. Bigger packs carry a built-in bulk bonus.
const COIN_PACKS = [
  { id: 'spark', coins: 50, priceInr: 10, tag: null as string | null },
  { id: 'surge', coins: 150, priceInr: 25, tag: 'Save 17%' },
  { id: 'storm', coins: 350, priceInr: 50, tag: 'Most popular' },
  { id: 'divine', coins: 800, priceInr: 100, tag: 'Best value' }
];

const PLATFORM_UPI_ID = (process.env.PLATFORM_UPI_ID || process.env.ADMIN_UPI_ID || 'divinecode@upi').trim();

async function requireUser(req: any) {
  const viewer = await resolvedViewerFromRequest(req, true);
  if (!viewer.email) return null;
  return prisma.user.findUnique({ where: { email: viewer.email } });
}

/**
 * Credits a paid purchase exactly once: coins + activity log + coupon burn.
 * Safe to call twice — an already-CREDITED purchase is returned untouched.
 */
async function creditPurchase(purchaseId: string): Promise<{ purchase: any; newBalance: number; alreadyCredited: boolean }> {
  return prisma.$transaction(async (tx) => {
    const purchase = await tx.coinPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase) throw new Error('PURCHASE_NOT_FOUND');
    if (purchase.status === 'CREDITED') {
      const owner = await tx.user.findUnique({ where: { id: purchase.userId }, select: { coins: true } });
      return { purchase, newBalance: owner?.coins ?? 0, alreadyCredited: true };
    }

    const user = await tx.user.update({
      where: { id: purchase.userId },
      data: { coins: { increment: purchase.coins } }
    });

    const updated = await tx.coinPurchase.update({
      where: { id: purchase.id },
      data: { status: 'CREDITED' }
    });

    await tx.activityLog.create({
      data: {
        userId: purchase.userId,
        eventDescription: `Purchased ${purchase.coins} coins for ₹${purchase.amountInr}${purchase.couponCode ? ` (coupon ${purchase.couponCode})` : ''}`,
        coinDelta: purchase.coins
      }
    });

    // Coupon burns when the money actually lands, not when the purchase is
    // drafted — an abandoned checkout never wastes the code.
    if (purchase.couponCode) {
      const coupon = await tx.coupon.findUnique({ where: { code: purchase.couponCode } });
      if (coupon) {
        const existing = await tx.couponRedemption.findUnique({
          where: { couponId_userId: { couponId: coupon.id, userId: purchase.userId } }
        });
        if (!existing) await redeemCoupon(tx, coupon.id, purchase.userId, 'COINS', purchase.id);
      }
    }

    return { purchase: updated, newBalance: user.coins, alreadyCredited: false };
  }, { timeout: 30000, maxWait: 10000 });
}

// -----------------------------------------------------------------------------
// Packs + wallet state (the buy-coins page loads everything from here)
// -----------------------------------------------------------------------------
coinRouter.get('/packs', async (req, res) => {
  try {
    const user = await requireUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const lucky = todayLuckyDeal();
    res.json({
      success: true,
      balance: user.coins,
      sessionCost: 100,
      razorpayAvailable: razorpayEnabled(),
      upiId: PLATFORM_UPI_ID,
      luckyDeal: { level: lucky.level, label: lucky.label, coinPackPercentOff: lucky.coinPackPercentOff },
      packs: COIN_PACKS.map(p => ({
        ...p,
        // What the pack costs TODAY before any coupon
        effectivePriceInr: applyPercentOff(p.priceInr, lucky.coinPackPercentOff)
      }))
    });
  } catch (err: any) {
    console.error('[Coin Packs Error]', err);
    res.status(500).json({ error: 'Failed to load coin packs.' });
  }
});

// Coupon dry-run so the UI can show the discounted price before committing.
coinRouter.post('/coupons/preview', async (req, res) => {
  try {
    const user = await requireUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const context = req.body?.context === 'AI_SESSION' ? 'AI_SESSION' : 'COINS';
    const coupon = await validateCoupon(req.body?.code, context, user.id);
    res.json({ success: true, code: coupon.code, percentOff: coupon.percentOff, appliesTo: coupon.appliesTo });
  } catch (err: any) {
    if (err instanceof CouponError) return res.status(400).json({ error: err.message });
    console.error('[Coupon Preview Error]', err);
    res.status(500).json({ error: 'Failed to check the coupon.' });
  }
});

// -----------------------------------------------------------------------------
// Create a purchase → payment instructions (or instant credit if fully free)
// -----------------------------------------------------------------------------
coinRouter.post('/purchases', async (req, res) => {
  try {
    const user = await requireUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const pack = COIN_PACKS.find(p => p.id === String(req.body?.packId || ''));
    if (!pack) return res.status(400).json({ error: 'Pick a valid coin pack.' });

    const lucky = todayLuckyDeal();
    let percentOff = lucky.coinPackPercentOff;
    let couponCode: string | null = null;

    // Lucky day and coupon never stack — the buyer silently gets the better one.
    if (req.body?.couponCode) {
      const coupon = await validateCoupon(req.body.couponCode, 'COINS', user.id);
      if (coupon.percentOff > percentOff) {
        percentOff = coupon.percentOff;
        couponCode = coupon.code;
      }
    }

    const amountInr = applyPercentOff(pack.priceInr, percentOff);
    const discountInr = pack.priceInr - amountInr;

    const purchase = await prisma.coinPurchase.create({
      data: {
        userId: user.id,
        coins: pack.coins,
        amountInr,
        listPriceInr: pack.priceInr,
        discountInr,
        couponCode,
        status: 'PENDING_PAYMENT'
      }
    });

    // A 100%-off coupon means there is nothing to pay — credit on the spot.
    if (amountInr === 0) {
      await prisma.coinPurchase.update({ where: { id: purchase.id }, data: { paymentMethod: 'COUPON' } });
      const { newBalance } = await creditPurchase(purchase.id);
      mailCoinsCredited(user.email, { coins: pack.coins, amountInr: 0, newBalance });
      return res.status(201).json({ success: true, credited: true, coins: pack.coins, newBalance });
    }

    mailCoinPurchaseCreated(user.email, { id: purchase.id, coins: pack.coins, amountInr }, PLATFORM_UPI_ID);

    res.status(201).json({
      success: true,
      purchase,
      payment: {
        razorpayAvailable: razorpayEnabled(),
        upiId: PLATFORM_UPI_ID,
        amountInr,
        reference: purchase.id,
        upiLink: `upi://pay?pa=${encodeURIComponent(PLATFORM_UPI_ID)}&pn=${encodeURIComponent('DivineCode')}&am=${amountInr}&cu=INR&tn=${encodeURIComponent('Coins ' + purchase.id.slice(-8))}`,
        instructions: `Pay ₹${amountInr} online below, or manually to ${PLATFORM_UPI_ID} via any UPI app and submit the UTR. Coins land once payment is verified.`
      }
    });
  } catch (err: any) {
    if (err instanceof CouponError) return res.status(400).json({ error: err.message });
    console.error('[Coin Purchase Create Error]', err);
    res.status(500).json({ error: 'Failed to start the coin purchase.' });
  }
});

// -----------------------------------------------------------------------------
// Online payment (Razorpay) — mirrors the booking flow exactly.
// -----------------------------------------------------------------------------
coinRouter.post('/purchases/:id/pay/order', async (req, res) => {
  try {
    const user = await requireUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!razorpayEnabled()) {
      return res.status(503).json({ error: 'Online payment is not configured yet — pay via the manual UPI option instead.' });
    }

    const purchase = await prisma.coinPurchase.findUnique({ where: { id: req.params.id } });
    if (!purchase || purchase.userId !== user.id) return res.status(404).json({ error: 'Purchase not found.' });
    if (purchase.status !== 'PENDING_PAYMENT') {
      return res.status(409).json({ error: 'This purchase is not awaiting payment.', status: purchase.status });
    }

    const order = await createRazorpayOrder(purchase.amountInr, purchase.id, {
      purchaseId: purchase.id,
      coins: String(purchase.coins)
    });

    await prisma.coinPurchase.update({
      where: { id: purchase.id },
      data: { razorpayOrderId: order.id, paymentMethod: 'RAZORPAY' }
    });

    res.json({
      success: true,
      keyId: razorpayKeyId(),
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      name: 'DivineCode',
      description: `${purchase.coins} coins top-up`,
      prefill: { name: user.name || user.username, email: user.email }
    });
  } catch (err: any) {
    console.error('[Coin Razorpay Order Error]', err?.response?.data || err?.message);
    res.status(502).json({ error: 'Could not reach the payment gateway. Try again, or use the manual UPI option.' });
  }
});

coinRouter.post('/purchases/:id/pay/verify', async (req, res) => {
  try {
    const user = await requireUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const purchase = await prisma.coinPurchase.findUnique({ where: { id: req.params.id } });
    if (!purchase || purchase.userId !== user.id) return res.status(404).json({ error: 'Purchase not found.' });
    if (purchase.status === 'CREDITED') {
      return res.json({ success: true, credited: true }); // double-submit from checkout is harmless
    }
    if (purchase.status !== 'PENDING_PAYMENT') {
      return res.status(409).json({ error: 'This purchase is not awaiting payment.', status: purchase.status });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (purchase.razorpayOrderId !== razorpay_order_id) {
      return res.status(400).json({ error: 'Payment does not match this purchase.' });
    }
    if (!verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return res.status(400).json({ error: 'Payment signature verification failed. If money was deducted it will auto-refund — contact the admin otherwise.' });
    }

    await prisma.coinPurchase.update({
      where: { id: purchase.id },
      data: { razorpayPaymentId: String(razorpay_payment_id) }
    });
    const { newBalance } = await creditPurchase(purchase.id);

    mailCoinsCredited(user.email, { coins: purchase.coins, amountInr: purchase.amountInr, newBalance });

    res.json({ success: true, credited: true, coins: purchase.coins, newBalance });
  } catch (err: any) {
    console.error('[Coin Razorpay Verify Error]', err);
    res.status(500).json({ error: 'Payment verification failed. Contact the admin with your payment ID.' });
  }
});

// -----------------------------------------------------------------------------
// Manual UPI: buyer submits the UTR, admin verifies, coins credit.
// -----------------------------------------------------------------------------
coinRouter.post('/purchases/:id/payment', async (req, res) => {
  try {
    const user = await requireUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const purchase = await prisma.coinPurchase.findUnique({ where: { id: req.params.id } });
    if (!purchase || purchase.userId !== user.id) return res.status(404).json({ error: 'Purchase not found.' });
    if (purchase.status !== 'PENDING_PAYMENT') {
      return res.status(409).json({ error: 'This purchase is not awaiting payment.', status: purchase.status });
    }

    const ref = String(req.body?.upiTransactionRef || '').trim();
    if (ref.length < 6 || ref.length > 40) {
      return res.status(400).json({ error: 'Enter the UPI transaction reference (UTR) shown in your payment app.' });
    }

    const updated = await prisma.coinPurchase.update({
      where: { id: purchase.id },
      data: { status: 'AWAITING_VERIFICATION', upiTransactionRef: ref, paymentMethod: 'UPI_MANUAL' }
    });

    mailCoinPurchaseUnderVerification(user.email, {
      id: purchase.id, coins: purchase.coins, amountInr: purchase.amountInr, upiTransactionRef: ref
    });

    res.json({ success: true, purchase: updated });
  } catch (err: any) {
    console.error('[Coin UTR Error]', err);
    res.status(500).json({ error: 'Failed to record the payment reference.' });
  }
});

coinRouter.post('/purchases/:id/verify', async (req, res) => {
  try {
    const user = await requireUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin permit required.' });

    const purchase = await prisma.coinPurchase.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { email: true } } }
    });
    if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });
    if (purchase.status !== 'AWAITING_VERIFICATION') {
      return res.status(409).json({ error: 'This purchase is not awaiting verification.', status: purchase.status });
    }

    const { newBalance } = await creditPurchase(purchase.id);
    mailCoinsCredited(purchase.user.email, { coins: purchase.coins, amountInr: purchase.amountInr, newBalance });

    res.json({ success: true, credited: true });
  } catch (err: any) {
    console.error('[Coin Verify Error]', err);
    res.status(500).json({ error: 'Failed to verify the purchase.' });
  }
});

coinRouter.post('/purchases/:id/cancel', async (req, res) => {
  try {
    const user = await requireUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const purchase = await prisma.coinPurchase.findUnique({ where: { id: req.params.id } });
    if (!purchase || (purchase.userId !== user.id && user.role !== 'ADMIN')) {
      return res.status(404).json({ error: 'Purchase not found.' });
    }
    if (purchase.status !== 'PENDING_PAYMENT') {
      return res.status(409).json({ error: 'Only an unpaid purchase can be cancelled.', status: purchase.status });
    }

    const updated = await prisma.coinPurchase.update({ where: { id: purchase.id }, data: { status: 'CANCELLED' } });
    res.json({ success: true, purchase: updated });
  } catch (err: any) {
    console.error('[Coin Cancel Error]', err);
    res.status(500).json({ error: 'Failed to cancel the purchase.' });
  }
});

// My purchase history; admins additionally get the pending-UTR queue.
coinRouter.get('/purchases', async (req, res) => {
  try {
    const user = await requireUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const isAdmin = user.role === 'ADMIN';
    const purchases = await prisma.coinPurchase.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    const pendingVerifications = isAdmin
      ? await prisma.coinPurchase.findMany({
          where: { status: 'AWAITING_VERIFICATION' },
          include: { user: { select: { email: true, username: true } } },
          orderBy: { createdAt: 'asc' }
        })
      : [];

    res.json({ success: true, purchases, pendingVerifications, viewerIsAdmin: isAdmin, balance: user.coins });
  } catch (err: any) {
    console.error('[Coin Purchases List Error]', err);
    res.status(500).json({ error: 'Failed to load purchases.' });
  }
});

// -----------------------------------------------------------------------------
// Admin coupon management
// -----------------------------------------------------------------------------
coinRouter.post('/coupons', async (req, res) => {
  try {
    const user = await requireUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin permit required.' });

    const percentOff = Math.round(Number(req.body?.percentOff));
    if (!Number.isFinite(percentOff) || percentOff < 1 || percentOff > 100) {
      return res.status(400).json({ error: 'percentOff must be between 1 and 100.' });
    }

    const scope = ['COINS', 'AI_SESSION', 'BOTH'].includes(req.body?.appliesTo) ? req.body.appliesTo : 'BOTH';
    const code = String(req.body?.code || `DIVINE${Math.random().toString(36).substring(2, 8)}`)
      .trim().toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 24);
    if (code.length < 4) return res.status(400).json({ error: 'Coupon code must be at least 4 characters.' });

    const maxUses = req.body?.maxUses ? Math.max(1, Math.round(Number(req.body.maxUses))) : null;
    const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
    if (expiresAt && isNaN(expiresAt.getTime())) return res.status(400).json({ error: 'Invalid expiry date.' });

    const coupon = await prisma.coupon.create({
      data: { code, percentOff, appliesTo: scope, maxUses, expiresAt, active: true }
    });

    res.status(201).json({ success: true, coupon });
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'A coupon with this code already exists.' });
    console.error('[Coupon Create Error]', err);
    res.status(500).json({ error: 'Failed to create the coupon.' });
  }
});

coinRouter.get('/coupons', async (req, res) => {
  try {
    const user = await requireUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin permit required.' });

    const coupons = await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    res.json({ success: true, coupons });
  } catch (err: any) {
    console.error('[Coupon List Error]', err);
    res.status(500).json({ error: 'Failed to load coupons.' });
  }
});

coinRouter.post('/coupons/:id/deactivate', async (req, res) => {
  try {
    const user = await requireUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin permit required.' });

    const coupon = await prisma.coupon.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ success: true, coupon });
  } catch (err: any) {
    console.error('[Coupon Deactivate Error]', err);
    res.status(500).json({ error: 'Failed to deactivate the coupon.' });
  }
});
