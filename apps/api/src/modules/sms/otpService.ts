/**
 * @file otpService.ts
 * @author Rahul
 * @description Mobile OTP delivery for free-trial phone verification. Real SMS
 * goes out through Fast2SMS when FAST2SMS_API_KEY is set; without it the code
 * falls back to the account's email (Gmail pipeline). If neither channel is
 * configured the caller is told OTP is unavailable — nothing is ever faked.
 */

import axios from 'axios';
import crypto from 'crypto';
import { emailEnabled, mailPhoneOtp } from '../email/emailService';

const FAST2SMS_API_KEY = (process.env.FAST2SMS_API_KEY || '').trim();

export function smsEnabled(): boolean {
  return !!FAST2SMS_API_KEY;
}

/** Which channel an OTP can actually be delivered on right now. */
export function otpChannel(): 'SMS' | 'EMAIL' | 'NONE' {
  if (smsEnabled()) return 'SMS';
  if (emailEnabled()) return 'EMAIL';
  return 'NONE';
}

export function generateOtp(): string {
  // crypto-random 6 digits, never starting with 0 so it survives numeric parsing
  return String(crypto.randomInt(100000, 1000000));
}

export function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export function verifyOtpHash(code: string, hash: string | null): boolean {
  if (!hash || !/^\d{6}$/.test(code)) return false;
  const candidate = hashOtp(code);
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
  } catch {
    return false;
  }
}

/**
 * Delivers the OTP and reports the channel used. SMS failures fall back to
 * email so a flaky gateway never strands the user mid-verification.
 */
export async function deliverOtp(phone: string, email: string, code: string): Promise<'SMS' | 'EMAIL'> {
  if (smsEnabled()) {
    try {
      // Fast2SMS OTP route: sends "<code> is your verification code" to the number.
      const res = await axios.post('https://www.fast2sms.com/dev/bulkV2',
        { variables_values: code, route: 'otp', numbers: phone },
        { headers: { authorization: FAST2SMS_API_KEY }, timeout: 15000 }
      );
      if (res.data?.return === true) {
        console.log(`[OTP] SMS sent to ${phone.slice(0, 2)}******${phone.slice(-2)}`);
        return 'SMS';
      }
      console.error('[OTP] Fast2SMS rejected the send:', res.data?.message || res.data);
    } catch (err: any) {
      console.error('[OTP] Fast2SMS send failed:', err?.response?.data?.message || err?.message);
    }
  }
  if (emailEnabled()) {
    mailPhoneOtp(email, code, phone);
    return 'EMAIL';
  }
  throw new Error('OTP_CHANNEL_UNAVAILABLE');
}
