import { Platform } from '@prisma/client';

type ExternalRatingInput = {
  platform?: Platform | string;
  rating?: number;
  solvedCount?: number;
};

const platformCalibration: Record<string, { slope: number; intercept: number; confidence: number }> = {
  [Platform.CODEFORCES]: { slope: 1, intercept: 0, confidence: 1 },
  [Platform.ATCODER]: { slope: 1.08, intercept: 80, confidence: 0.9 },
  [Platform.LEETCODE]: { slope: 0.92, intercept: 120, confidence: 0.75 },
  [Platform.CODECHEF]: { slope: 0.95, intercept: 60, confidence: 0.75 },
  [Platform.HACKERRANK]: { slope: 0.8, intercept: 250, confidence: 0.45 },
  [Platform.DIVINECODE]: { slope: 1, intercept: 0, confidence: 1 },
  [Platform.OTHER]: { slope: 0.85, intercept: 180, confidence: 0.35 }
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function platformKey(value: ExternalRatingInput['platform']) {
  const normalized = String(value || Platform.OTHER).toUpperCase();
  if (normalized.includes('CODEFORCES')) return Platform.CODEFORCES;
  if (normalized.includes('ATCODER')) return Platform.ATCODER;
  if (normalized.includes('LEETCODE')) return Platform.LEETCODE;
  if (normalized.includes('CODECHEF')) return Platform.CODECHEF;
  if (normalized.includes('HACKERRANK')) return Platform.HACKERRANK;
  if (normalized.includes('DIVINECODE')) return Platform.DIVINECODE;
  return Platform.OTHER;
}

export function normalizeExternalRating(input: ExternalRatingInput) {
  const rating = Number(input.rating || 1200);
  const platform = platformKey(input.platform);
  const calibration = platformCalibration[platform];
  return Math.round(clamp(rating * calibration.slope + calibration.intercept, 400, 3600));
}

export function estimateUnifiedRating(ratings: ExternalRatingInput[], fallback = 1200) {
  if (!ratings.length) return fallback;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const rating of ratings) {
    const platform = platformKey(rating.platform);
    const calibration = platformCalibration[platform];
    const practiceWeight = Math.log2(Math.max(2, Number(rating.solvedCount || 1) + 1));
    const weight = calibration.confidence * practiceWeight;
    weightedSum += normalizeExternalRating(rating) * weight;
    totalWeight += weight;
  }

  if (!totalWeight) return fallback;
  return Math.round(weightedSum / totalWeight);
}

export function recommendationBand(input: {
  ratings?: ExternalRatingInput[];
  currentRating?: number;
  targetMode?: 'comfort' | 'growth' | 'duel';
}) {
  const ability = input.currentRating || estimateUnifiedRating(input.ratings || []);
  const mode = input.targetMode || 'growth';
  const offsets = {
    comfort: [-150, 100],
    growth: [-50, 250],
    duel: [150, 450]
  }[mode];

  return {
    unifiedRating: ability,
    ratingFloor: clamp(ability + offsets[0], 400, 3500),
    ratingCeil: clamp(ability + offsets[1], 500, 3600),
    mode
  };
}
