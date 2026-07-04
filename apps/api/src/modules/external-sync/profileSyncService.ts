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
      }
      // Add more platforms like AtCoder here easily!
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