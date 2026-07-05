/**
 * @file razorpayService.ts
 * @author Rahul
 * @description Razorpay order + signature verification over the raw REST API.
 * One gateway covers every payment mode — cards, UPI intent/collect,
 * netbanking, wallets — Razorpay Checkout decides what to show the payer.
 */

import axios from 'axios';
import crypto from 'crypto';

const KEY_ID = (process.env.RAZORPAY_KEY_ID || '').trim();
const KEY_SECRET = (process.env.RAZORPAY_KEY_SECRET || '').trim();

export function razorpayEnabled(): boolean {
  return !!(KEY_ID && KEY_SECRET);
}

export function razorpayKeyId(): string {
  return KEY_ID;
}

export interface RazorpayOrder {
  id: string;
  amount: number; // paise
  currency: string;
}

// Creates a gateway order for the given INR amount. `receipt` ties the order
// back to our booking id so reconciliation in the Razorpay dashboard is trivial.
export async function createRazorpayOrder(amountInr: number, receipt: string, notes?: Record<string, string>): Promise<RazorpayOrder> {
  if (!razorpayEnabled()) {
    throw new Error('RAZORPAY_NOT_CONFIGURED');
  }
  const res = await axios.post(
    'https://api.razorpay.com/v1/orders',
    {
      amount: Math.round(amountInr * 100), // Razorpay wants paise
      currency: 'INR',
      receipt: receipt.substring(0, 40),
      notes: notes || {}
    },
    {
      auth: { username: KEY_ID, password: KEY_SECRET },
      timeout: 15000
    }
  );
  return { id: res.data.id, amount: res.data.amount, currency: res.data.currency };
}

// Checkout hands the client an order_id + payment_id + signature; the signature
// is HMAC-SHA256(order_id|payment_id, key_secret). Verifying it server-side is
// what proves the payment actually happened — never trust the client alone.
export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!razorpayEnabled() || !orderId || !paymentId || !signature) return false;
  const expected = crypto
    .createHmac('sha256', KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
