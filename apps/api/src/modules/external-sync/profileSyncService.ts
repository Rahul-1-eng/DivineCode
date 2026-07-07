/**
 * @file profileSyncService.ts
 * @author Rahul Kumar Sahoo
 * @description Pulls live ratings/solved counts from Codeforces, LeetCode,
 * AtCoder and CodeChef for every linked handle and recomputes the user's
 * unified global rating. Called after handle linking, from the manual
 * refresh route, and by the daily refresh cron.
 */

import { Platform } from '@prisma/client';
import { prisma } from '../../prisma/client';
import { estimateUnifiedRating } from '../ratings/recommendationMath';
import axios from 'axios';

// LeetCode has no REST API; the public GraphQL endpoint is the official way
// to read solved counts. (The old leetcode-stats herokuapp proxy is dead.)
async function fetchLeetCodeSolvedCount(handle: string): Promise<number | null> {
  const res = await axios.post(
    'https://leetcode.com/graphql',
    {
      query: `query userStats($username: String!) {
        matchedUser(username: $username) {
          submitStatsGlobal { acSubmissionNum { difficulty count } }
        }
      }`,
      variables: { username: handle }
    },
    { headers: { 'Content-Type': 'application/json', Referer: 'https://leetcode.com' }, timeout: 10000 }
  );
  const acStats = res.data?.data?.matchedUser?.submitStatsGlobal?.acSubmissionNum;
  if (!Array.isArray(acStats)) return null;
  const all = acStats.find((s: any) => s.difficulty === 'All');
  return Number(all?.count) || 0;
}

export async function syncUserRatings(userId: string) {
  const handles = await prisma.externalHandle.findMany({ where: { userId } });
  const ratingInputs = [];

  for (const h of handles) {
    try {
      if (h.platform === Platform.CODEFORCES) {
        // Fetch official Codeforces Rating
        const res = await axios.get(`https://codeforces.com/api/user.info?handles=${encodeURIComponent(h.handle)}`, { timeout: 10000 });
        if (res.data.status === 'OK') {
          const rating = res.data.result[0].rating || 1200;
          const maxRating = res.data.result[0].maxRating || rating;
          ratingInputs.push({ platform: Platform.CODEFORCES, rating, solvedCount: 50 });
          await prisma.externalHandle.update({ where: { id: h.id }, data: { rating, maxRating, lastSyncAt: new Date() } });
        }
      } else if (h.platform === Platform.LEETCODE) {
        const solvedCount = await fetchLeetCodeSolvedCount(h.handle);
        if (solvedCount !== null) {
          // Estimate an LC rating bonus based on questions solved
          const estimatedLcRating = 1200 + (solvedCount * 1.5);
          ratingInputs.push({ platform: Platform.LEETCODE, rating: estimatedLcRating, solvedCount });
          await prisma.externalHandle.update({ where: { id: h.id }, data: { rating: Math.round(estimatedLcRating), lastSyncAt: new Date() } });
        }
      } else if (h.platform === Platform.ATCODER) {
        // AtCoder publishes each user's full contest history as JSON.
        const res = await axios.get(`https://atcoder.jp/users/${encodeURIComponent(h.handle)}/history/json`, { timeout: 10000 });
        if (Array.isArray(res.data) && res.data.length > 0) {
          const last = res.data[res.data.length - 1];
          const rating = Number(last.NewRating) || 1200;
          const maxRating = res.data.reduce((m: number, r: any) => Math.max(m, Number(r.NewRating) || 0), rating);
          // AtCoder ratings run ~400 lower than Codeforces at the same skill level
          ratingInputs.push({ platform: Platform.ATCODER, rating: rating + 400, solvedCount: res.data.length });
          await prisma.externalHandle.update({ where: { id: h.id }, data: { rating, maxRating, lastSyncAt: new Date() } });
        }
      } else if (h.platform === Platform.CODECHEF) {
        // No public CodeChef API — extract the rating number from the profile page.
        const res = await axios.get(`https://www.codechef.com/users/${encodeURIComponent(h.handle)}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 10000
        });
        const match = String(res.data).match(/class="rating-number"[^>]*>\s*(\d{3,4})/);
        if (match) {
          const rating = Number(match[1]);
          ratingInputs.push({ platform: Platform.CODECHEF, rating, solvedCount: 30 });
          await prisma.externalHandle.update({ where: { id: h.id }, data: { rating, lastSyncAt: new Date() } });
        }
      }
    } catch (error) {
      console.error(`[Sync] Failed to fetch ${h.platform} stats for handle: ${h.handle}`);
    }
  }

  // Every fetch failed (network fault / platform down) — keep the existing
  // global rating instead of silently resetting the user to 1200.
  if (ratingInputs.length === 0) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { globalRating: true } });
    return user?.globalRating ?? 1200;
  }

  // Calculate the new unified Global Rating using your mathematical weights
  const newGlobalRating = estimateUnifiedRating(ratingInputs);

  // Update the user's global profile
  await prisma.user.update({
    where: { id: userId },
    data: { globalRating: newGlobalRating }
  });

  return newGlobalRating;
}