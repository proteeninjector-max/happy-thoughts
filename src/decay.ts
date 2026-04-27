import { ScoreRecord, saveScore } from "./scoring";

const DECAY_RATE = 0.5; // points per day
const DECAY_FLOOR = 30; // happy_trail floor
const INACTIVE_DAYS = 14; // days before decay starts
const HIDDEN_DAYS = 60; // days before hidden from /discover
const MS_PER_DAY = 86_400_000;

function round2(v: number) {
  return Number(v.toFixed(2));
}

export async function runDecay(env: {
  SCORES: KVNamespace;
  PROVIDERS: KVNamespace;
}): Promise<{ processed: number; decayed: number; hidden: number }> {
  const now = Date.now();
  let processed = 0;
  let decayed = 0;
  let hidden = 0;

  // List all score records
  let cursor: string | undefined;
  do {
    const page = await env.SCORES.list({ prefix: "score:", cursor });
    cursor = page.list_complete ? undefined : page.cursor;

    for (const key of page.keys) {
      processed++;
      const raw = await env.SCORES.get(key.name);
      if (!raw) continue;

      const score: ScoreRecord = JSON.parse(raw);

      // Skip suspended providers — decay still applies (spec doesn't exempt them)
      // Skip Founding Brain providers from decay
      if (score.tier === "founding_brain") continue;

      const daysSinceActive = (now - score.last_active) / MS_PER_DAY;

      // Hidden flag: >60 days inactive
      if (daysSinceActive > HIDDEN_DAYS && !score.hidden) {
        score.hidden = true;
        hidden++;
        console.log(`[DECAY] hidden: ${score.provider_id} (${Math.floor(daysSinceActive)}d inactive)`);
      }

      // Decay: >14 days inactive
      if (daysSinceActive > INACTIVE_DAYS) {
        if (score.happy_trail <= DECAY_FLOOR) {
          // Already at floor — no decay needed, but still save hidden flag if changed
          if (score.hidden) await saveScore(score, env as any);
          continue;
        }

        // Decay is -0.5/day applied to quality (which feeds happy_trail)
        // Days of decay = daysSinceActive - INACTIVE_DAYS (only count days past threshold)
        // But cron runs daily so we apply 1 day of decay per run
        const decayAmount = DECAY_RATE;
        score.quality = round2(Math.max(0, score.quality - decayAmount));

        // Recompute happy_trail
        const newHappyTrail = round2(
          score.quality * 0.5 + score.reliability * 0.3 + score.trust * 0.2
        );
        score.happy_trail = Math.max(DECAY_FLOOR, newHappyTrail);

        // Recompute tier (founding_brain already excluded above)
        if (score.happy_trail >= 80 && score.total_thoughts >= 200) {
          score.tier = "verified_brain";
        } else if (score.happy_trail >= 65 && score.total_thoughts >= 50) {
          score.tier = "trusted_thinker";
        } else {
          score.tier = "thinker";
        }

        await saveScore(score, env as any);
        decayed++;
        console.log(
          `[DECAY] decayed: ${score.provider_id} happy_trail=${score.happy_trail} (${Math.floor(daysSinceActive)}d inactive)`
        );
      }
    }
  } while (cursor);

  console.log(`[DECAY] run complete — processed: ${processed}, decayed: ${decayed}, hidden: ${hidden}`);
  return { processed, decayed, hidden };
}
