/**
 * @file banGuard.ts
 * @author Rahul
 * @description Global ban enforcement. Every authenticated mutating request is
 * checked against the user's bannedUntil timestamp; blocked users get a 403
 * with the reason and expiry. Ban states are cached in-memory for 60s so the
 * guard never adds a DB round-trip to hot paths — the admin block/unblock
 * endpoints clear the cache entry immediately, so moderation still lands
 * instantly on the node that served the admin action.
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../prisma/client';

const CACHE_TTL_MS = 60 * 1000;

type BanState = { bannedUntil: Date | null; banReason: string | null; checkedAt: number };
const banCache = new Map<string, BanState>();

export function clearBanCache(email?: string | null) {
  if (email) banCache.delete(email.toLowerCase());
}

async function getBanState(email: string): Promise<BanState> {
  const key = email.toLowerCase();
  const cached = banCache.get(key);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) return cached;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { bannedUntil: true, banReason: true }
  });
  const state: BanState = {
    bannedUntil: user?.bannedUntil || null,
    banReason: user?.banReason || null,
    checkedAt: Date.now()
  };
  banCache.set(key, state);
  return state;
}

/**
 * Express middleware. Reads become allowed, writes from banned users get 403.
 * Identity comes from the same x-user-email header the rest of the API uses.
 */
export function banGuard() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Only police mutating verbs — banned users may still look around.
      if (req.method === 'GET' || req.method === 'OPTIONS' || req.method === 'HEAD') return next();

      const email = String(req.headers['x-user-email'] || '').trim();
      if (!email || !email.includes('@')) return next(); // anonymous → auth layer's problem

      const state = await getBanState(email);
      if (state.bannedUntil && state.bannedUntil.getTime() > Date.now()) {
        return res.status(403).json({
          error: `Your account is blocked${state.banReason ? `: ${state.banReason}` : ''}. Restriction lifts on ${state.bannedUntil.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST.`,
          code: 'ACCOUNT_BANNED',
          bannedUntil: state.bannedUntil,
          reason: state.banReason
        });
      }
      next();
    } catch (err) {
      // The guard must never take the API down — fail open on internal errors.
      console.error('[BanGuard] check failed:', (err as any)?.message);
      next();
    }
  };
}
