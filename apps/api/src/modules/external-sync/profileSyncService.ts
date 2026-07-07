/**
 * @file profileSyncService.ts
 * @author Rahul Kumar Sahoo
 * @description Core application logic for the platform feature.
 */

import { Platform } from '@prisma/client';
import { prisma } from '../../prisma/client';
import { estimateUnifiedRating } from '../ratings/recommendationMath';
import axios from 'axios';

export async function syncUserRatings(userId: string) {
  const handles = await prisma.externalHandle.findMany({ where: { userId } });
  const ratingInputs = [];

  for (const h of handles) {
    try {
      if (h.platform === Platform.CODEFORCES) {
        // Fetch official Codeforces Rating
        const res = await axios.get(`https://codeforces.com/api/user.info?handles=${h.handle}`);
        if (res.data.status === 'OK') {
          const rating = res.data.result[0].rating || 1200;
          const maxRating = res.data.result[0].maxRating || rating;
          ratingInputs.push({ platform: Platform.CODEFORCES, rating, solvedCount: 50 });
          await prisma.externalHandle.update({ where: { id: h.id }, data: { rating, maxRating } });
        }
      } else if (h.platform === Platform.LEETCODE) {
        // Fetch LeetCode stats using a reliable public proxy API
        const res = await axios.get(`https://leetcode-stats-api.herokuapp.com/${h.handle}`);
        if (res.data.status === 'success') {
          const solvedCount = res.data.totalSolved || 0;
          // Estimate an LC rating bonus based on questions solved
          const estimatedLcRating = 1200 + (solvedCount * 1.5);
          ratingInputs.push({ platform: Platform.LEETCODE, rating: estimatedLcRating, solvedCount });
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
          await prisma.externalHandle.update({ where: { id: h.id }, data: { rating, maxRating } });
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
          await prisma.externalHandle.update({ where: { id: h.id }, data: { rating } });
        }
      }
    } catch (error) {
      console.error(`[Sync] Failed to fetch ${h.platform} stats for handle: ${h.handle}`);
    }
  }

  // Calculate the new unified Global Rating using your mathematical weights
  let newGlobalRating = 1200;
  if (ratingInputs.length > 0) {
    newGlobalRating = estimateUnifiedRating(ratingInputs);
  }

  // Update the user's global profile
  await prisma.user.update({
    where: { id: userId },
    data: { globalRating: newGlobalRating }
  });

  return newGlobalRating;
}