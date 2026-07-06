/**
 * @file promoService.ts
 * @author Rahul
 * @description Discount engine: deterministic "lucky days" plus admin-minted
 * coupon codes. Lucky days come from a pure hash of the IST calendar date, so
 * every server instance agrees on the deal without any shared state. Coupons
 * and lucky days never stack — the buyer gets whichever is better.
 */

import crypto from 'crypto';
import { prisma } from '../../prisma/client';

// -----------------------------------------------------------------------------
// Lucky days
// -----------------------------------------------------------------------------

export interface LuckyDeal {
  level: 'NONE' | 'DISCOUNT' | 'FREE';
  // AI Recruiter sessions (coin-priced, platform-internal — safe to zero out)
  aiSessionPercentOff: number;
  // Coin packs (real money — capped at 50% so lucky days can't be farmed)
  coinPackPercentOff: number;
  // Real recruiter bookings: only the PLATFORM fee is discounted; the
  // recruiter's own fee is their income and is never touched.
  platformFeePercentOff: number;
  label: string | null;
}

function istDateKey(now = new Date()): string {
  // en-CA gives YYYY-MM-DD directly
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** Same date → same deal, on every instance, forever. Roughly 1 free day and 4 discount days a month. */
export function todayLuckyDeal(now = new Date()): LuckyDeal {
  const key = istDateKey(now);
  const roll = crypto.createHash('sha256').update(`divinecode-lucky-${key}`).digest()[0] % 100;

  if (roll < 4) {
    return {
      level: 'FREE',
      aiSessionPercentOff: 100,
      coinPackPercentOff: 50,
      platformFeePercentOff: 100,
      label: '🍀 LUCKY DAY — AI interviews are FREE today, coin packs 50% off, zero platform fee on recruiter bookings!'
    };
  }
  if (roll < 17) {
    return {
      level: 'DISCOUNT',
      aiSessionPercentOff: 50,
      coinPackPercentOff: 20,
      platformFeePercentOff: 50,
      label: '🍀 Lucky day — 50% off AI interviews, 20% off coin packs, half platform fee on recruiter bookings!'
    };
  }
  return { level: 'NONE', aiSessionPercentOff: 0, coinPackPercentOff: 0, platformFeePercentOff: 0, label: null };
}

// -----------------------------------------------------------------------------
// Coupons
// -----------------------------------------------------------------------------

export type CouponContext = 'COINS' | 'AI_SESSION';

export class CouponError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CouponError';
  }
}

/**
 * Resolves a coupon code to its discount, enforcing active/expiry/cap/scope and
 * the one-redemption-per-user rule. Throws CouponError with a user-facing
 * message when the code can't be applied.
 */
export async function validateCoupon(rawCode: string, context: CouponContext, userId: string) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) throw new CouponError('Enter a coupon code.');

  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon || !coupon.active) throw new CouponError('This coupon code is not valid.');
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) throw new CouponError('This coupon has expired.');
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) throw new CouponError('This coupon has been fully redeemed.');
  if (coupon.appliesTo !== 'BOTH' && coupon.appliesTo !== context) {
    throw new CouponError(context === 'COINS'
      ? 'This coupon only works on AI interview sessions.'
      : 'This coupon only works on coin purchases.');
  }

  const alreadyUsed = await prisma.couponRedemption.findUnique({
    where: { couponId_userId: { couponId: coupon.id, userId } }
  });
  if (alreadyUsed) throw new CouponError('You have already used this coupon.');

  return coupon;
}

/**
 * Burns the coupon for this user inside the caller's transaction. The unique
 * (couponId, userId) constraint is the concurrency guard — a double redeem
 * throws and rolls the whole transaction back.
 */
export async function redeemCoupon(tx: any, couponId: string, userId: string, context: CouponContext, refId?: string) {
  await tx.couponRedemption.create({
    data: { couponId, userId, context, refId: refId || null }
  });
  await tx.coupon.update({
    where: { id: couponId },
    data: { usedCount: { increment: 1 } }
  });
}

/** Applies a percent discount to an amount, never returning below zero. */
export function applyPercentOff(amount: number, percentOff: number): number {
  const pct = Math.max(0, Math.min(100, Math.round(percentOff)));
  return Math.max(0, Math.round(amount * (100 - pct) / 100));
}
