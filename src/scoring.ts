export interface ScoreRecord {
  provider_id: string;
  quality: number;
  reliability: number;
  trust: number;
  happy_trail: number;
  tier: string;
  total_thoughts: number;
  total_cached: number;
  reuse_rate: number;
  created_at: number;
  last_active: number;
  suspended_until?: number;
  frozen_until?: number;
  consecutive_happy: number;
  days_active_no_sad: number;
  last_active_day?: string;
  last_sad_day?: string;
  weekly_delta: number;
  delta_log: Array<{ ts: number; delta: number }>;
  daily_delta: number;
  daily_delta_date?: string;
  flags: string[];
  hidden: boolean;
  cap_applied?: boolean;
}

export type ScoreUpdateEvent =
  | { type: "happy_rating" }
  | { type: "sad_rating" }
  | { type: "hallucinated"; verified_buyer: boolean }
  | { type: "cache_reuse" }
  | { type: "returning_buyer" }
  | { type: "challenger_happy" }
  | { type: "sla_met" }
  | { type: "sla_exceeded_2x" }
  | { type: "refund" }
  | { type: "dispute_upheld" };

export interface Env {
  SCORES: KVNamespace;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function todayString(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function updateScore(score: ScoreRecord, event: ScoreUpdateEvent, env: Env): ScoreRecord {
  const now = Date.now();

  if (score.suspended_until && score.suspended_until > now) {
    console.log("[SCORE] blocked — suspended");
    return score;
  }

  if (score.frozen_until && score.frozen_until > now) {
    if (event.type !== "refund" && event.type !== "dispute_upheld") {
      console.log("[SCORE] blocked — frozen");
      return score;
    }
  }

  let qualityDelta = 0;
  let reliabilityDelta = 0;
  let trustDelta = 0;

  switch (event.type) {
    case "happy_rating":
      qualityDelta += 2;
      break;
    case "sad_rating":
      qualityDelta -= 3;
      break;
    case "hallucinated":
      if (event.verified_buyer) {
        qualityDelta -= 5;
        if (!score.flags.includes("yellow_flag")) score.flags.push("yellow_flag");
      }
      break;
    case "cache_reuse":
      qualityDelta += 0.5;
      break;
    case "returning_buyer":
      qualityDelta += 1;
      break;
    case "challenger_happy":
      qualityDelta += 4;
      break;
    case "sla_met":
      reliabilityDelta += 0.5;
      break;
    case "sla_exceeded_2x":
      reliabilityDelta -= 1;
      break;
    case "refund":
      qualityDelta -= 10;
      trustDelta -= 5;
      score.frozen_until = now + 48 * 3600 * 1000;
      break;
    case "dispute_upheld":
      qualityDelta -= 8;
      trustDelta -= 3;
      break;
  }

  const hasPositiveDelta = qualityDelta + reliabilityDelta + trustDelta > 0;
  const today = todayString(now);
  if (score.daily_delta_date !== today) {
    score.daily_delta_date = today;
    score.daily_delta = 0;
  }

  if (hasPositiveDelta && score.daily_delta >= 3) {
    qualityDelta = 0;
    reliabilityDelta = 0;
    trustDelta = 0;
  }

  score.quality = clamp(score.quality + qualityDelta);
  score.reliability = clamp(score.reliability + reliabilityDelta);
  score.trust = clamp(score.trust + trustDelta);

  if (hasPositiveDelta) {
    score.daily_delta = round2(score.daily_delta + (qualityDelta + reliabilityDelta + trustDelta));
  }

  const computedHappyTrail = round2(
    score.quality * 0.5 + score.reliability * 0.3 + score.trust * 0.2
  );

  const withinNewProviderWindow = now - score.created_at < 30 * 24 * 3600 * 1000;
  if (withinNewProviderWindow && computedHappyTrail > 65) {
    score.happy_trail = 65;
    score.cap_applied = true;
  } else {
    score.happy_trail = computedHappyTrail;
  }

  if (score.tier === "founding_brain") {
    score.tier = "founding_brain";
  } else if (score.happy_trail >= 80 && score.total_thoughts >= 200) {
    score.tier = "verified_brain";
  } else if (score.happy_trail >= 65 && score.total_thoughts >= 50) {
    score.tier = "trusted_thinker";
  } else {
    score.tier = "thinker";
  }

  const deltaSum = round2(qualityDelta + reliabilityDelta + trustDelta);
  const logEntry = { ts: now, delta: deltaSum };
  score.delta_log = (score.delta_log || []).concat(logEntry);
  const sevenDaysAgo = now - 7 * 24 * 3600 * 1000;
  score.delta_log = score.delta_log.filter((entry) => entry.ts >= sevenDaysAgo);
  score.weekly_delta = round2(score.delta_log.reduce((sum, entry) => sum + entry.delta, 0));

  score.last_active = now;

  return score;
}

export async function saveScore(score: ScoreRecord, env: Env): Promise<void> {
  await env.SCORES.put(`score:${score.provider_id}`, JSON.stringify(score));
}

export async function loadScore(provider_id: string, env: Env): Promise<ScoreRecord | null> {
  const raw = await env.SCORES.get(`score:${provider_id}`);
  if (!raw) return null;
  return JSON.parse(raw);
}
