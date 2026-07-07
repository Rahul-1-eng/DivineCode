/**
 * @file activityMonitor.ts
 * @author Rahul
 * @description Live user-activity telemetry for the admin Monitoring tab.
 * Every authenticated API request updates the user's presence (last seen +
 * what they are doing right now) and meaningful actions are appended to an
 * in-memory ring buffer that the admin panel streams from. Nothing here ever
 * touches the DB on the hot path, so it adds zero latency to user requests.
 */

import { Request, Response, NextFunction } from 'express';

export type ActivityEvent = {
  id: number;
  email: string;
  method: string;
  path: string;
  action: string;
  at: number; // epoch ms
};

export type PresenceEntry = {
  email: string;
  lastSeen: number;
  lastAction: string;
  lastPath: string;
};

const MAX_EVENTS = 2000;
const events: ActivityEvent[] = [];
const presence = new Map<string, PresenceEntry>(); // keyed by lowercased email
let nextEventId = 1;

// Polling UIs re-request the same GET every few seconds; collapse repeats so
// the feed shows what users DO, not what their browsers refresh.
const DEDUPE_WINDOW_MS = 30_000;
const lastLogged = new Map<string, number>(); // email|method|path → epoch ms

// Pure heartbeat endpoints: they prove the user is online but say nothing
// about what they are doing — presence only, never logged as events.
const PRESENCE_ONLY = [/^\/api\/v2\/notifications/, /^\/api\/v2\/leaderboard/];

/** Turn method + path into a sentence an admin can read at a glance. */
function describeAction(method: string, path: string): string {
  const isWrite = method !== 'GET';
  const rules: Array<[RegExp, string, string]> = [
    // [matcher, label when writing, label when viewing]
    [/^\/api\/v2\/submissions/, 'Submitted code for judging', 'Reviewing submissions'],
    [/^\/api\/v2\/interview\/.+\/mock/, 'Answering the AI voice interviewer', 'AI mock interview'],
    [/^\/api\/v2\/interview/, 'Working on interview prep', 'Browsing interview prep'],
    [/^\/api\/v2\/recruiter\/sessions\/.+\/turn/, 'Speaking in an AI recruiter interview', 'AI recruiter interview'],
    [/^\/api\/v2\/recruiter\/sessions\/.+\/run/, 'Running code in a recruiter interview', 'Recruiter interview'],
    [/^\/api\/v2\/recruiter\/sessions/, 'In a live recruiter interview session', 'Viewing a recruiter session'],
    [/^\/api\/v2\/recruiter/, 'Using the recruiter marketplace', 'Browsing the recruiter marketplace'],
    [/^\/api\/v2\/live/, 'Streaming on DivineLive', 'Watching DivineLive'],
    [/^\/api\/v2\/community/, 'Posting in the community', 'Reading the community'],
    [/^\/api\/v2\/contests\/.+\/(join|register)/, 'Joined a contest', 'Viewing a contest'],
    [/^\/api\/v2\/contests/, 'Contest arena action', 'Browsing contest arenas'],
    [/^\/api\/v2\/duel/, 'Playing a code duel', 'Browsing duels'],
    [/^\/api\/v2\/problems/, 'Working on a problem', 'Reading a problem'],
    [/^\/api\/v2\/coins/, 'Coin store transaction', 'Browsing the coin store'],
    [/^\/api\/v2\/payments?/, 'Making a payment', 'Viewing payments'],
    [/^\/api\/v2\/feedback/, 'Submitted feedback', 'Viewing feedback'],
    [/^\/api\/v2\/profile/, 'Updated their profile', 'Viewing a profile'],
    [/^\/api\/v2\/ai/, 'Chatting with the AI assistant', 'AI assistant'],
    [/^\/api\/v2\/auth/, 'Signing in / verifying OTP', 'Auth check'],
    [/^\/api\/v2\/search/, 'Searching the platform', 'Searching the platform'],
    [/^\/api\/v2\/games/, 'Playing arcade games', 'Playing arcade games']
  ];
  for (const [pattern, writeLabel, readLabel] of rules) {
    if (pattern.test(path)) return isWrite ? writeLabel : readLabel;
  }
  // Fallback stays honest about the raw route so nothing is invisible.
  const section = path.replace(/^\/api\/v2\//, '').split('/')[0] || 'platform';
  return isWrite ? `Action on ${section}` : `Browsing ${section}`;
}

/**
 * Express middleware. Mount on /api — it observes and never rejects; any
 * internal error falls through so monitoring can never take the API down.
 */
export function activityMonitor() {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const email = String(req.headers['x-user-email'] || '').trim();
      if (!email || !email.includes('@')) return next();

      const path = (req.originalUrl || req.url || '').split('?')[0];

      // The admin panel itself polls /admin/monitor every few seconds —
      // recording that would bury real user activity under admin noise.
      if (path.startsWith('/api/v2/admin')) return next();

      const action = describeAction(req.method, path);
      const now = Date.now();

      presence.set(email.toLowerCase(), { email, lastSeen: now, lastAction: action, lastPath: path });

      if (PRESENCE_ONLY.some(p => p.test(path))) return next();

      // Writes are always real actions; identical GETs are collapsed.
      if (req.method === 'GET') {
        const key = `${email.toLowerCase()}|${req.method}|${path}`;
        const last = lastLogged.get(key) || 0;
        if (now - last < DEDUPE_WINDOW_MS) return next();
        lastLogged.set(key, now);
        // keep the dedupe map from growing forever
        if (lastLogged.size > 5000) {
          for (const [k, t] of lastLogged) {
            if (now - t > DEDUPE_WINDOW_MS) lastLogged.delete(k);
          }
        }
      }

      events.push({ id: nextEventId++, email, method: req.method, path, action, at: now });
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    } catch (err) {
      console.warn('[ActivityMonitor] record failed:', (err as any)?.message);
    }
    next();
  };
}

/** Snapshot for the admin endpoint: newest events first + full presence map. */
export function getMonitorSnapshot(limit = 300): { events: ActivityEvent[]; presence: PresenceEntry[] } {
  return {
    events: events.slice(-limit).reverse(),
    presence: Array.from(presence.values()).sort((a, b) => b.lastSeen - a.lastSeen)
  };
}
