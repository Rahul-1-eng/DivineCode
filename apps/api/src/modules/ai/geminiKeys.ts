/**
 * @file geminiKeys.ts
 * @author Rahul
 * @description Gemini API key pool with automatic failover. Configure multiple
 * keys as GEMINI_API_KEYS="key1,key2,key3" (legacy GEMINI_API_KEY / AI_API_KEY
 * still work as pool members). When a key hits its quota (429), the pool
 * rotates to the next key WITHOUT a redeploy and the admin is emailed
 * immediately — once per key per outage, never spammed. Exhausted keys are
 * retried after a cooldown because free-tier quotas reset daily.
 */

import axios from 'axios';
import { sendMail, adminEmail, emailEnabled } from '../email/emailService';

const EXHAUST_COOLDOWN_MS = 60 * 60 * 1000; // retry an exhausted key hourly — daily quotas reset at midnight PT

// key → when it was marked quota-exhausted
const exhaustedAt = new Map<string, number>();
// keys whose exhaustion has already been emailed this outage (cleared on recovery)
const alerted = new Set<string>();

/** Full configured pool, deduped, in priority order. */
export function geminiKeyPool(): string[] {
  return Array.from(new Set([
    ...(process.env.GEMINI_API_KEYS || '').split(',').map(k => k.trim()),
    (process.env.GEMINI_API_KEY || '').trim(),
    (process.env.AI_API_KEY || '').trim()
  ].filter(Boolean)));
}

export function geminiConfigured(): boolean {
  return geminiKeyPool().length > 0;
}

/** Keys currently believed to have quota. Falls back to the full pool when everything is exhausted — better to retry than to hard-fail. */
function usableKeys(): string[] {
  const pool = geminiKeyPool();
  const now = Date.now();
  const fresh = pool.filter(k => {
    const at = exhaustedAt.get(k);
    return !at || now - at > EXHAUST_COOLDOWN_MS;
  });
  return fresh.length > 0 ? fresh : pool;
}

function maskKey(key: string): string {
  return key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '****';
}

function isQuotaError(err: any): boolean {
  const status = err?.response?.status;
  const msg = String(err?.response?.data?.error?.message || err?.message || '').toLowerCase();
  return status === 429 || msg.includes('quota') || msg.includes('resource_exhausted');
}

function markExhausted(key: string) {
  const firstTime = !exhaustedAt.has(key) || Date.now() - (exhaustedAt.get(key) || 0) > EXHAUST_COOLDOWN_MS;
  exhaustedAt.set(key, Date.now());
  if (!firstTime || alerted.has(key)) return;
  alerted.add(key);

  const pool = geminiKeyPool();
  const left = usableKeys().filter(k => k !== key).length;
  console.warn(`[Gemini Pool] Key ${maskKey(key)} hit its quota. ${left}/${pool.length} keys still usable.`);

  if (!emailEnabled()) return;
  const allDead = left === 0;
  sendMail(adminEmail(),
    allDead
      ? '🚨 [DivineCode] ALL Gemini API keys exhausted — AI features degraded'
      : `⚠️ [DivineCode] Gemini key ${maskKey(key)} hit quota — auto-switched to backup`,
    allDead ? 'Every Gemini key is out of quota' : 'A Gemini key ran out of quota',
    allDead
      ? `Key <code>${maskKey(key)}</code> was the last usable Gemini key and it just hit its quota limit. AI chat, the AI Recruiter and test-case generation will fail until a quota resets (free tiers reset daily at midnight PT) or a new key is added.<br/><br/>
         <strong>No redeploy needed to add capacity:</strong> append a fresh key to the <code>GEMINI_API_KEYS</code> env var (comma-separated) and restart the service — the pool picks it up automatically. Exhausted keys are retried every hour in case the quota has reset.`
      : `Key <code>${maskKey(key)}</code> ran out of quota and the platform <strong>automatically switched</strong> to a backup key — no action needed right now, nothing is down.<br/><br/>
         Keys still usable: <strong>${left} of ${pool.length}</strong>. Consider topping up the pool (<code>GEMINI_API_KEYS</code>, comma-separated) before the remaining ones run dry. This exhausted key will be retried automatically every hour since free-tier quotas reset daily.`);
}

function markHealthy(key: string) {
  if (exhaustedAt.has(key)) {
    exhaustedAt.delete(key);
    alerted.delete(key);
    console.log(`[Gemini Pool] Key ${maskKey(key)} recovered.`);
  }
}

/**
 * POSTs a generateContent request, rotating through the key pool on quota
 * errors. Non-quota errors (safety blocks, bad model, 5xx) are thrown to the
 * caller unchanged — those are not the key's fault.
 */
export async function geminiGenerateContent(model: string, body: any, timeoutMs = 45000): Promise<any> {
  const keys = usableKeys();
  if (keys.length === 0) throw new Error('No Gemini API key configured (GEMINI_API_KEYS / GEMINI_API_KEY / AI_API_KEY).');

  let lastErr: any;
  for (const key of keys) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const { data } = await axios.post(url, body, { timeout: timeoutMs });
      markHealthy(key);
      return data;
    } catch (err: any) {
      lastErr = err;
      if (isQuotaError(err)) {
        markExhausted(key);
        continue; // quota is per-key — the next key gets a clean shot
      }
      throw err; // model/safety/network problem — rotating keys won't help
    }
  }
  throw lastErr;
}
