import { describe, it, expect } from "vitest";
import worker from "../src/index";
import { updateScore, type ScoreRecord } from "../src/scoring";
import { runDecay } from "../src/decay";

class MockKV implements KVNamespace {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string }): Promise<{ keys: { name: string }[] }> {
    const prefix = options?.prefix ?? "";
    const keys: { name: string }[] = [];
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) keys.push({ name: key });
    }
    return { keys };
  }
}

function makeEnv() {
  return {
    PROVIDERS: new MockKV(),
    SCORES: new MockKV(),
    THOUGHTS: new MockKV(),
    CACHE: new MockKV(),
    BUNDLES: new MockKV(),
    BUYERS: new MockKV(),
    FEEDBACK: new MockKV(),
    FLAGS: new MockKV(),
    REFERRALS: new MockKV(),
    AGREEMENTS: new MockKV(),
    PROFIT_WALLET: "0x170992058429d3d52615fef70c1006f5e5d6467c",
    OWNER_KEY: "test-owner",
    OWNER_KEY_HEADER: "X-OWNER-KEY"
  } as any;
}

async function seedProvider(env: any, providerId = "prov_1") {
  const provider = {
    id: providerId,
    name: "Test Provider",
    description: "Test thought",
    specialties: ["trading/signals"],
    payout_wallet: "0xabc",
    callback_url: "internal://pi_signals",
    delivery_mode: "webhook",
    delivery_status: "ready",
    tier: "thinker"
  };
  const score = {
    happy_trail: 82,
    quality: 80,
    reliability: 80,
    trust: 80,
    total_thoughts: 10,
    rated_thoughts: 5,
    happy_rate: 0.9,
    sad_rate: 0.1,
    active_days: 10,
    last_active: new Date().toISOString(),
    tier: "thinker",
    flags: [] as string[],
    reuse_rate: 0.2,
    weekly_delta: 4
  };
  await env.PROVIDERS.put(`provider:${providerId}`, JSON.stringify(provider));
  await env.SCORES.put(`score:${providerId}`, JSON.stringify(score));
  return { provider, score };
}

describe("HappyThoughts Phase 2", () => {
  it("POST /think returns 200 with thought fields", async () => {
    const env = makeEnv();
    await seedProvider(env);
    const body = JSON.stringify({
      prompt: "Test prompt",
      specialty: "trading/signals",
      buyer_wallet: "0xbuyer"
    });
    const res = await worker.fetch(
      new Request("https://test/think", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-OWNER-KEY": "test-owner"
        },
        body
      }),
      env,
      {} as any
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.thought_id).toMatch(/^ht_/);
    expect(json.thought).toBeTruthy();
    expect(json.disclaimer).toBeTruthy();
    expect(typeof json.confidence).toBe("number");
  });

  it("POST /think missing prompt returns 400", async () => {
    const env = makeEnv();
    const body = JSON.stringify({ buyer_wallet: "0xbuyer" });
    const res = await worker.fetch(
      new Request("https://test/think", {
        method: "POST",
        headers: { "content-type": "application/json", "X-OWNER-KEY": "test-owner" },
        body
      }),
      env,
      {} as any
    );
    expect(res.status).toBe(400);
  });

  it("POST /think missing buyer_wallet returns 400", async () => {
    const env = makeEnv();
    const body = JSON.stringify({ prompt: "hi", specialty: "trading/signals" });
    const res = await worker.fetch(
      new Request("https://test/think", {
        method: "POST",
        headers: { "content-type": "application/json", "X-OWNER-KEY": "test-owner" },
        body
      }),
      env,
      {} as any
    );
    expect(res.status).toBe(400);
  });

  it("POST /think no providers returns 404", async () => {
    const env = makeEnv();
    const body = JSON.stringify({
      prompt: "Test prompt",
      specialty: "trading/signals",
      buyer_wallet: "0xbuyer"
    });
    const res = await worker.fetch(
      new Request("https://test/think", {
        method: "POST",
        headers: { "content-type": "application/json", "X-OWNER-KEY": "test-owner" },
        body
      }),
      env,
      {} as any
    );
    expect(res.status).toBe(404);
  });

  it("POST /feedback valid happy rating returns 200", async () => {
    const env = makeEnv();
    const { provider } = await seedProvider(env, "prov_feedback");

    await env.BUYERS.put(
      "buyer:0xbuyer",
      JSON.stringify({ total_paid: 3, last_ratings: {} })
    );

    await env.THOUGHTS.put(
      "thought:ht_test",
      JSON.stringify({
        thought_id: "ht_test",
        provider_id: provider.id,
        buyer_wallet: "0xbuyer",
        response: "ok"
      })
    );

    const body = JSON.stringify({
      thought_id: "ht_test",
      provider_id: provider.id,
      rating: "happy",
      buyer_wallet: "0xbuyer"
    });

    const res = await worker.fetch(
      new Request("https://test/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("applied");
  });

  it("POST /feedback missing buyer profile returns 400", async () => {
    const env = makeEnv();
    const { provider } = await seedProvider(env, "prov_feedback2");

    await env.THOUGHTS.put(
      "thought:ht_test2",
      JSON.stringify({
        thought_id: "ht_test2",
        provider_id: provider.id,
        buyer_wallet: "0xbuyer",
        response: "ok"
      })
    );

    const body = JSON.stringify({
      thought_id: "ht_test2",
      provider_id: provider.id,
      rating: "happy",
      buyer_wallet: "0xbuyer"
    });

    const res = await worker.fetch(
      new Request("https://test/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(400);
  });

  it("POST /feedback invalid rating returns 400", async () => {
    const env = makeEnv();
    const { provider } = await seedProvider(env, "prov_feedback3");

    await env.BUYERS.put(
      "buyer:0xbuyer",
      JSON.stringify({ total_paid: 3, last_ratings: {} })
    );

    await env.THOUGHTS.put(
      "thought:ht_test3",
      JSON.stringify({
        thought_id: "ht_test3",
        provider_id: provider.id,
        buyer_wallet: "0xbuyer",
        response: "ok"
      })
    );

    const body = JSON.stringify({
      thought_id: "ht_test3",
      provider_id: provider.id,
      rating: "meh",
      buyer_wallet: "0xbuyer"
    });

    const res = await worker.fetch(
      new Request("https://test/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(400);
  });

  it("POST /dispute valid dispute returns 200", async () => {
    const env = makeEnv();
    const { provider } = await seedProvider(env, "prov_dispute");

    await env.THOUGHTS.put(
      "thought:ht_dispute",
      JSON.stringify({
        thought_id: "ht_dispute",
        provider_id: provider.id,
        buyer_wallet: "0xbuyer",
        response: "ok"
      })
    );

    const body = JSON.stringify({
      thought_id: "ht_dispute",
      provider_id: provider.id,
      reason: "wrong",
      buyer_wallet: "0xbuyer"
    });

    const res = await worker.fetch(
      new Request("https://test/dispute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dispute_id).toMatch(/^dispute_/);
  });

  it("POST /dispute wrong buyer_wallet returns 400", async () => {
    const env = makeEnv();
    const { provider } = await seedProvider(env, "prov_dispute2");

    await env.THOUGHTS.put(
      "thought:ht_dispute2",
      JSON.stringify({
        thought_id: "ht_dispute2",
        provider_id: provider.id,
        buyer_wallet: "0xbuyer",
        response: "ok"
      })
    );

    const body = JSON.stringify({
      thought_id: "ht_dispute2",
      provider_id: provider.id,
      reason: "wrong",
      buyer_wallet: "0xother"
    });

    const res = await worker.fetch(
      new Request("https://test/dispute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(400);
  });

  it("GET /score/:id known provider returns 200", async () => {
    const env = makeEnv();
    const { provider } = await seedProvider(env, "prov_score");

    const res = await worker.fetch(new Request(`https://test/score/${provider.id}`), env, {} as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.provider_id).toBe(provider.id);
    expect(json.components).toBeTruthy();
  });

  it("GET /score/:id unknown provider returns 404", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://test/score/unknown"), env, {} as any);
    expect(res.status).toBe(404);
  });

  it("GET /route returns providers array (max 3)", async () => {
    const env = makeEnv();
    await seedProvider(env, "prov_route1");
    await seedProvider(env, "prov_route2");
    await seedProvider(env, "prov_route3");
    await seedProvider(env, "prov_route4");

    const res = await worker.fetch(new Request("https://test/route"), env, {} as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.providers)).toBe(true);
    expect(json.providers.length).toBeLessThanOrEqual(3);
  });

  it("GET /leaderboard returns 5 boards", async () => {
    const env = makeEnv();
    await seedProvider(env, "prov_lb1");
    await seedProvider(env, "prov_lb2");

    const res = await worker.fetch(new Request("https://test/leaderboard"), env, {} as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.boards.top_thinkers).toBeTruthy();
    expect(json.boards.most_productive).toBeTruthy();
    expect(json.boards.cult_classics).toBeTruthy();
    expect(json.boards.weekly_mover).toBeTruthy();
    expect(json.boards.rising_stars).toBeTruthy();
  });

  it("GET /legal/tos returns text/plain", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://test/legal/tos"), env, {} as any);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
  });

  it("GET /legal/privacy returns text/plain", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://test/legal/privacy"), env, {} as any);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
  });

  it("GET /legal/provider-agreement returns text/plain", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://test/legal/provider-agreement"), env, {} as any);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
  });

  it("GET /legal/aup returns text/plain", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://test/legal/aup"), env, {} as any);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
  });

  it("GET /docs returns endpoints list", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://test/docs"), env, {} as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.endpoints)).toBe(true);
  });

  it("GET /preview returns sample thought", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://test/preview"), env, {} as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sample_thought_id).toBeTruthy();
  });
});

describe("HappyThoughts Phase 3", () => {
  it("updateScore — suspension gate", async () => {
    const now = Date.now();
    const score: ScoreRecord = {
      provider_id: "prov_susp",
      quality: 50,
      reliability: 50,
      trust: 50,
      happy_trail: 50,
      tier: "thinker",
      total_thoughts: 10,
      total_cached: 0,
      reuse_rate: 0,
      created_at: now - 1000,
      last_active: now - 1000,
      suspended_until: now + 100_000,
      consecutive_happy: 0,
      days_active_no_sad: 0,
      weekly_delta: 0,
      delta_log: [],
      daily_delta: 0,
      flags: [],
      hidden: false
    };

    const updated = updateScore({ ...score }, { type: "happy_rating" }, { SCORES: new MockKV() } as any);
    expect(updated.quality).toBe(score.quality);
  });

  it("updateScore — freeze gate", async () => {
    const now = Date.now();
    const base: ScoreRecord = {
      provider_id: "prov_freeze",
      quality: 50,
      reliability: 50,
      trust: 50,
      happy_trail: 50,
      tier: "thinker",
      total_thoughts: 10,
      total_cached: 0,
      reuse_rate: 0,
      created_at: now - 1000,
      last_active: now - 1000,
      frozen_until: now + 100_000,
      consecutive_happy: 0,
      days_active_no_sad: 0,
      weekly_delta: 0,
      delta_log: [],
      daily_delta: 0,
      flags: [],
      hidden: false
    };

    const blocked = updateScore({ ...base }, { type: "cache_reuse" }, { SCORES: new MockKV() } as any);
    expect(blocked.quality).toBe(base.quality);

    const penalty = updateScore({ ...base }, { type: "dispute_upheld" }, { SCORES: new MockKV() } as any);
    expect(penalty.quality).toBeLessThan(base.quality);
  });

  it("updateScore — velocity cap", async () => {
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const score: ScoreRecord = {
      provider_id: "prov_cap",
      quality: 50,
      reliability: 50,
      trust: 50,
      happy_trail: 50,
      tier: "thinker",
      total_thoughts: 10,
      total_cached: 0,
      reuse_rate: 0,
      created_at: now - 1000,
      last_active: now - 1000,
      consecutive_happy: 0,
      days_active_no_sad: 0,
      weekly_delta: 0,
      delta_log: [],
      daily_delta: 3,
      daily_delta_date: today,
      flags: [],
      hidden: false
    };

    const updated = updateScore({ ...score }, { type: "happy_rating" }, { SCORES: new MockKV() } as any);
    expect(updated.quality).toBe(score.quality);
  });

  it("updateScore — new provider cap", async () => {
    const now = Date.now();
    const score: ScoreRecord = {
      provider_id: "prov_new",
      quality: 90,
      reliability: 90,
      trust: 90,
      happy_trail: 90,
      tier: "thinker",
      total_thoughts: 1,
      total_cached: 0,
      reuse_rate: 0,
      created_at: now,
      last_active: now,
      consecutive_happy: 0,
      days_active_no_sad: 0,
      weekly_delta: 0,
      delta_log: [],
      daily_delta: 0,
      flags: [],
      hidden: false
    };

    const updated = updateScore({ ...score }, { type: "happy_rating" }, { SCORES: new MockKV() } as any);
    expect(updated.happy_trail).toBeLessThanOrEqual(65);
    expect(updated.cap_applied).toBe(true);
  });

  it("updateScore — streak: 10 consecutive happy", async () => {
    const now = Date.now();
    const score: ScoreRecord = {
      provider_id: "prov_streak",
      quality: 50,
      reliability: 50,
      trust: 50,
      happy_trail: 50,
      tier: "thinker",
      total_thoughts: 10,
      total_cached: 0,
      reuse_rate: 0,
      created_at: now - 1000,
      last_active: now - 1000,
      consecutive_happy: 9,
      days_active_no_sad: 0,
      weekly_delta: 0,
      delta_log: [],
      daily_delta: 0,
      flags: [],
      hidden: false
    };

    const updated = updateScore({ ...score }, { type: "happy_rating" }, { SCORES: new MockKV() } as any);
    expect(updated.consecutive_happy).toBe(0);
    expect(updated.quality).toBeGreaterThanOrEqual(55);
  });

  it("updateScore — streak: sad resets consecutive_happy", async () => {
    const now = Date.now();
    const score: ScoreRecord = {
      provider_id: "prov_streak2",
      quality: 50,
      reliability: 50,
      trust: 50,
      happy_trail: 50,
      tier: "thinker",
      total_thoughts: 10,
      total_cached: 0,
      reuse_rate: 0,
      created_at: now - 1000,
      last_active: now - 1000,
      consecutive_happy: 7,
      days_active_no_sad: 0,
      weekly_delta: 0,
      delta_log: [],
      daily_delta: 0,
      flags: [],
      hidden: false
    };

    const updated = updateScore({ ...score }, { type: "sad_rating" }, { SCORES: new MockKV() } as any);
    expect(updated.consecutive_happy).toBe(0);
  });

  it("updateScore — weekly_delta accumulates", async () => {
    const now = Date.now();
    const score: ScoreRecord = {
      provider_id: "prov_weekly",
      quality: 50,
      reliability: 50,
      trust: 50,
      happy_trail: 50,
      tier: "thinker",
      total_thoughts: 10,
      total_cached: 0,
      reuse_rate: 0,
      created_at: now - 1000,
      last_active: now - 1000,
      consecutive_happy: 0,
      days_active_no_sad: 0,
      weekly_delta: 0,
      delta_log: [],
      daily_delta: 0,
      flags: [],
      hidden: false
    };

    let updated = updateScore({ ...score }, { type: "happy_rating" }, { SCORES: new MockKV() } as any);
    updated = updateScore(updated, { type: "happy_rating" }, { SCORES: new MockKV() } as any);
    expect(updated.weekly_delta).toBeGreaterThan(0);
    expect(updated.delta_log.length).toBe(2);
  });

  it("runDecay — decays inactive provider", async () => {
    const env = { SCORES: new MockKV(), PROVIDERS: new MockKV() } as any;
    const now = Date.now();
    const score: ScoreRecord = {
      provider_id: "prov_decay",
      quality: 50,
      reliability: 50,
      trust: 50,
      happy_trail: 60,
      tier: "thinker",
      total_thoughts: 10,
      total_cached: 0,
      reuse_rate: 0,
      created_at: now - 1000,
      last_active: now - 20 * 86_400_000,
      consecutive_happy: 0,
      days_active_no_sad: 0,
      weekly_delta: 0,
      delta_log: [],
      daily_delta: 0,
      flags: [],
      hidden: false
    };
    await env.SCORES.put(`score:${score.provider_id}`, JSON.stringify(score));

    const result = await runDecay(env);
    const updatedRaw = await env.SCORES.get(`score:${score.provider_id}`);
    const updated = updatedRaw ? JSON.parse(updatedRaw) : null;
    expect(result.decayed).toBe(1);
    expect(updated.happy_trail).toBeLessThan(score.happy_trail);
  });

  it("runDecay — does not decay founding_brain", async () => {
    const env = { SCORES: new MockKV(), PROVIDERS: new MockKV() } as any;
    const now = Date.now();
    const score: ScoreRecord = {
      provider_id: "prov_founder",
      quality: 50,
      reliability: 50,
      trust: 50,
      happy_trail: 60,
      tier: "founding_brain",
      total_thoughts: 10,
      total_cached: 0,
      reuse_rate: 0,
      created_at: now - 1000,
      last_active: now - 20 * 86_400_000,
      consecutive_happy: 0,
      days_active_no_sad: 0,
      weekly_delta: 0,
      delta_log: [],
      daily_delta: 0,
      flags: [],
      hidden: false
    };
    await env.SCORES.put(`score:${score.provider_id}`, JSON.stringify(score));

    const result = await runDecay(env);
    const updatedRaw = await env.SCORES.get(`score:${score.provider_id}`);
    const updated = updatedRaw ? JSON.parse(updatedRaw) : null;
    expect(result.decayed).toBe(0);
    expect(updated.happy_trail).toBe(score.happy_trail);
  });

  it("runDecay — sets hidden flag at 60 days", async () => {
    const env = { SCORES: new MockKV(), PROVIDERS: new MockKV() } as any;
    const now = Date.now();
    const score: ScoreRecord = {
      provider_id: "prov_hidden",
      quality: 50,
      reliability: 50,
      trust: 50,
      happy_trail: 28,
      tier: "thinker",
      total_thoughts: 10,
      total_cached: 0,
      reuse_rate: 0,
      created_at: now - 1000,
      last_active: now - 61 * 86_400_000,
      consecutive_happy: 0,
      days_active_no_sad: 0,
      weekly_delta: 0,
      delta_log: [],
      daily_delta: 0,
      flags: [],
      hidden: false
    };
    await env.SCORES.put(`score:${score.provider_id}`, JSON.stringify(score));

    const result = await runDecay(env);
    const updatedRaw = await env.SCORES.get(`score:${score.provider_id}`);
    const updated = updatedRaw ? JSON.parse(updatedRaw) : null;
    expect(result.hidden).toBe(1);
    expect(updated.hidden).toBe(true);
  });
});

describe("HappyThoughts Phase 4", () => {
  it("Self-dealing — blocked and penalized", async () => {
    const env = makeEnv();
    const providerId = "prov_self";
    const buyerWallet = "0xSELF";

    await env.PROVIDERS.put(
      `provider:${providerId}`,
      JSON.stringify({
        id: providerId,
        name: "Self Dealer",
        description: "Desc",
        specialties: ["trading/signals"],
        payout_wallet: "0xabc",
        wallet: buyerWallet,
        tier: "thinker"
      })
    );
    await env.SCORES.put(
      `score:${providerId}`,
      JSON.stringify({
        provider_id: providerId,
        quality: 50,
        reliability: 50,
        trust: 50,
        happy_trail: 50,
        tier: "thinker",
        total_thoughts: 10,
        total_cached: 0,
        reuse_rate: 0,
        created_at: Date.now() - 1000,
        last_active: Date.now() - 1000,
        consecutive_happy: 0,
        days_active_no_sad: 0,
        weekly_delta: 0,
        delta_log: [],
        daily_delta: 0,
        flags: [],
        hidden: false
      })
    );

    await env.THOUGHTS.put(
      "thought:selfdeal",
      JSON.stringify({
        thought_id: "selfdeal",
        provider_id: providerId,
        buyer_wallet: buyerWallet,
        response: "ok"
      })
    );

    await env.BUYERS.put(
      `buyer:${buyerWallet}`,
      JSON.stringify({ total_paid: 3, last_ratings: {} })
    );

    const res = await worker.fetch(
      new Request("https://test/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thought_id: "selfdeal",
          provider_id: providerId,
          rating: "happy",
          buyer_wallet: buyerWallet
        })
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(JSON.stringify(json)).toMatch(/self-dealing detected/i);
  });

  it("Self-dealing — score penalty applied", async () => {
    const env = makeEnv();
    const providerId = "prov_self2";
    const buyerWallet = "0xSELF2";

    await env.PROVIDERS.put(
      `provider:${providerId}`,
      JSON.stringify({
        id: providerId,
        name: "Self Dealer",
        description: "Desc",
        specialties: ["trading/signals"],
        payout_wallet: "0xabc",
        wallet: buyerWallet,
        tier: "thinker"
      })
    );
    await env.SCORES.put(
      `score:${providerId}`,
      JSON.stringify({
        provider_id: providerId,
        quality: 50,
        reliability: 50,
        trust: 50,
        happy_trail: 50,
        tier: "thinker",
        total_thoughts: 10,
        total_cached: 0,
        reuse_rate: 0,
        created_at: Date.now() - 1000,
        last_active: Date.now() - 1000,
        consecutive_happy: 0,
        days_active_no_sad: 0,
        weekly_delta: 0,
        delta_log: [],
        daily_delta: 0,
        flags: [],
        hidden: false
      })
    );

    await env.THOUGHTS.put(
      "thought:selfdeal2",
      JSON.stringify({
        thought_id: "selfdeal2",
        provider_id: providerId,
        buyer_wallet: buyerWallet,
        response: "ok"
      })
    );

    await env.BUYERS.put(
      `buyer:${buyerWallet}`,
      JSON.stringify({ total_paid: 3, last_ratings: {} })
    );

    await worker.fetch(
      new Request("https://test/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thought_id: "selfdeal2",
          provider_id: providerId,
          rating: "happy",
          buyer_wallet: buyerWallet
        })
      }),
      env,
      {} as any
    );

    const updatedRaw = await env.SCORES.get(`score:${providerId}`);
    const updated = updatedRaw ? JSON.parse(updatedRaw) : null;
    expect(updated.quality).toBe(40);
  });

  it("Challenger routing — thought record flagged", async () => {
    const env = makeEnv();
    const { provider } = await seedProvider(env, "prov_chal");

    await env.THOUGHTS.put(
      "thought:chal",
      JSON.stringify({
        thought_id: "chal",
        provider_id: provider.id,
        buyer_wallet: "0xbuyer",
        response: "ok",
        challenger: true
      })
    );

    await env.BUYERS.put(
      "buyer:0xbuyer",
      JSON.stringify({ total_paid: 3, last_ratings: {} })
    );

    const res = await worker.fetch(
      new Request("https://test/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thought_id: "chal",
          provider_id: provider.id,
          rating: "happy",
          buyer_wallet: "0xbuyer"
        })
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("applied");
  });

  it("/refund — success", async () => {
    const env = makeEnv();
    const { provider } = await seedProvider(env, "prov_refund");

    await env.THOUGHTS.put(
      "thought:refund1",
      JSON.stringify({
        thought_id: "refund1",
        provider_id: provider.id,
        buyer_wallet: "0xbuyer",
        response: "ok"
      })
    );

    const res = await worker.fetch(
      new Request("https://test/refund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thought_id: "refund1",
          buyer_wallet: "0xbuyer",
          reason: "not satisfied"
        })
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("refunded");
  });

  it("/refund — wrong buyer blocked", async () => {
    const env = makeEnv();
    const { provider } = await seedProvider(env, "prov_refund2");

    await env.THOUGHTS.put(
      "thought:refund2",
      JSON.stringify({
        thought_id: "refund2",
        provider_id: provider.id,
        buyer_wallet: "0xbuyer",
        response: "ok"
      })
    );

    const res = await worker.fetch(
      new Request("https://test/refund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thought_id: "refund2",
          buyer_wallet: "0xother",
          reason: "not satisfied"
        })
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(400);
  });

  it("/refund — double refund blocked", async () => {
    const env = makeEnv();
    const { provider } = await seedProvider(env, "prov_refund3");

    await env.THOUGHTS.put(
      "thought:refund3",
      JSON.stringify({
        thought_id: "refund3",
        provider_id: provider.id,
        buyer_wallet: "0xbuyer",
        response: "ok",
        refunded: true
      })
    );

    const res = await worker.fetch(
      new Request("https://test/refund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thought_id: "refund3",
          buyer_wallet: "0xbuyer",
          reason: "duplicate"
        })
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(JSON.stringify(json)).toMatch(/already been refunded/i);
  });

  it("/refund — score penalty applied", async () => {
    const env = makeEnv();
    const { provider, score } = await seedProvider(env, "prov_refund4");

    await env.SCORES.put(`score:${provider.id}`, JSON.stringify({ ...score, provider_id: provider.id }));

    await env.THOUGHTS.put(
      "thought:refund4",
      JSON.stringify({
        thought_id: "refund4",
        provider_id: provider.id,
        buyer_wallet: "0xbuyer",
        response: "ok"
      })
    );

    await worker.fetch(
      new Request("https://test/refund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thought_id: "refund4",
          buyer_wallet: "0xbuyer",
          reason: "not satisfied"
        })
      }),
      env,
      {} as any
    );

    const updatedRaw = await env.SCORES.get(`score:${provider.id}`);
    const updated = updatedRaw ? JSON.parse(updatedRaw) : null;
    expect(updated.quality).toBeLessThan(80);
    expect(updated.frozen_until).toBeTruthy();
  });
});

describe("HappyThoughts Phase 5", () => {
  it("POST /bundle — success", async () => {
    const env = makeEnv();
    const { provider } = await seedProvider(env, "prov_bundle");

    await env.THOUGHTS.put(
      "thought:bundle1",
      JSON.stringify({
        thought_id: "bundle1",
        provider_id: provider.id,
        buyer_wallet: "0xbuyer",
        response: "ok"
      })
    );
    await env.THOUGHTS.put(
      "thought:bundle2",
      JSON.stringify({
        thought_id: "bundle2",
        provider_id: provider.id,
        buyer_wallet: "0xbuyer",
        response: "ok"
      })
    );

    const res = await worker.fetch(
      new Request("https://test/bundle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider_id: provider.id,
          name: "Starter Bundle",
          thought_ids: ["bundle1", "bundle2"],
          price_usdc: 0.1,
          description: "Two thoughts"
        })
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bundle_id).toBeTruthy();
    expect(json.provider_earning).toBe(0.07);
    expect(json.broker_earning).toBe(0.03);
  });

  it("POST /bundle — too many thoughts", async () => {
    const env = makeEnv();
    const { provider } = await seedProvider(env, "prov_bundle2");

    const thoughtIds = Array.from({ length: 11 }, (_, i) => `t${i}`);
    const res = await worker.fetch(
      new Request("https://test/bundle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider_id: provider.id,
          name: "Big Bundle",
          thought_ids: thoughtIds,
          price_usdc: 0.2,
          description: "Too many"
        })
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(JSON.stringify(json)).toMatch(/limited to 10/i);
  });

  it("POST /bundle — unknown thought", async () => {
    const env = makeEnv();
    const { provider } = await seedProvider(env, "prov_bundle3");

    const res = await worker.fetch(
      new Request("https://test/bundle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider_id: provider.id,
          name: "Missing Thought",
          thought_ids: ["missing"],
          price_usdc: 0.1,
          description: "Missing"
        })
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(JSON.stringify(json)).toMatch(/unknown thought_id/i);
  });

  it("POST /bundle — thought belongs to different provider", async () => {
    const env = makeEnv();
    const { provider } = await seedProvider(env, "prov_bundle4");

    await env.THOUGHTS.put(
      "thought:other",
      JSON.stringify({
        thought_id: "other",
        provider_id: "other_provider",
        buyer_wallet: "0xbuyer",
        response: "ok"
      })
    );

    const res = await worker.fetch(
      new Request("https://test/bundle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider_id: provider.id,
          name: "Mismatch",
          thought_ids: ["other"],
          price_usdc: 0.1,
          description: "Mismatch"
        })
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(400);
  });

  it("GET /bundle/:id — success", async () => {
    const env = makeEnv();
    const bundleId = "bundle_123";
    await env.BUNDLES.put(
      `bundle:${bundleId}`,
      JSON.stringify({
        bundle_id: bundleId,
        provider_id: "prov_bundle5",
        name: "Bundle",
        thought_ids: ["a"],
        thought_count: 1,
        price_usdc: 0.1,
        provider_earning: 0.07,
        broker_earning: 0.03,
        profit_wallet: env.PROFIT_WALLET,
        created_at: new Date().toISOString(),
        active: true
      })
    );

    const res = await worker.fetch(new Request(`https://test/bundle/${bundleId}`), env, {} as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bundle_id).toBe(bundleId);
  });

  it("GET /bundle/:id — not found", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://test/bundle/nonexistent"), env, {} as any);
    expect(res.status).toBe(404);
  });

  it("GET /referral/:wallet — success", async () => {
    const env = makeEnv();
    const wallet = "0xref";
    await env.REFERRALS.put(
      `referral:${wallet}`,
      JSON.stringify({
        referral_code: wallet,
        referrals: [{ provider_id: "prov1", wallet: "0xabc", referred_at: new Date().toISOString() }],
        total_referred: 1,
        created_at: new Date().toISOString()
      })
    );

    const res = await worker.fetch(new Request(`https://test/referral/${wallet}`), env, {} as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total_referred).toBe(1);
  });

  it("GET /referral/:wallet — not found", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://test/referral/unknownwallet"), env, {} as any);
    expect(res.status).toBe(404);
  });
});

describe("HappyThoughts registration", () => {
  it("POST /register defaults delivery_mode to hosted and issues a provider token", async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      new Request("https://test/register", {
        method: "POST",
        headers: { "content-type": "application/json", "X-OWNER-KEY": "test-owner" },
        body: JSON.stringify({
          name: "Hosted Bot",
          description: "No infra needed.",
          specialties: ["crypto/whale-tracking"],
          payout_wallet: "0x5555555555555555555555555555555555555555",
          accept_tos: true,
          accept_privacy: true,
          accept_provider_agreement: true,
          accept_aup: true
        })
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(201);
    const json: any = await res.json();
    expect(json.delivery_mode).toBe("hosted");
    expect(json.delivery_status).toBe("ready");
    expect(json.provider_token).toMatch(/^htp_/);
    expect(json.provider_api_base).toBe("https://test/provider");

    const provider = JSON.parse((await env.PROVIDERS.get(`provider:${json.provider_id}`)) as string);
    expect(provider.delivery_mode).toBe("hosted");
    expect(provider.delivery_status).toBe("ready");
    expect(typeof provider.provider_token_hash).toBe("string");
    expect(provider.provider_token_hash).not.toBe(json.provider_token);
  });

  it("POST /register requires callback_url when delivery_mode=webhook", async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      new Request("https://test/register", {
        method: "POST",
        headers: { "content-type": "application/json", "X-OWNER-KEY": "test-owner" },
        body: JSON.stringify({
          name: "Webhook Bot",
          description: "Needs push delivery.",
          specialties: ["crypto/whale-tracking"],
          payout_wallet: "0x6666666666666666666666666666666666666666",
          delivery_mode: "webhook",
          accept_tos: true,
          accept_privacy: true,
          accept_provider_agreement: true,
          accept_aup: true
        })
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.message).toContain("callback_url is required when delivery_mode=webhook");
  });
  it("POST /register creates a provider with clean bot metadata", async () => {
    const env = makeEnv();

    const res = await worker.fetch(
      new Request("https://test/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-OWNER-KEY": "test-owner"
        },
        body: JSON.stringify({
          name: "Moby Brain",
          description: "Tracks whales and spits thoughts.",
          slug: "moby-brain",
          specialties: ["crypto/whale-tracking", "trading/thesis", "crypto/whale-tracking"],
          payout_wallet: "0x1111111111111111111111111111111111111111",
          callback_url: "https://bots.example.com/webhook",
          avatar_url: "https://bots.example.com/avatar.png",
          website_url: "https://bots.example.com",
          x_handle: "@mobybrain",
          tags: ["Whale", "trading", "whale"],
          sample_outputs: ["First sample", "Second sample"],
          bot_type: "signal-bot",
          model: "claude-haiku",
          agent_framework: "openclaw",
          runtime: "worker",
          accept_tos: true,
          accept_privacy: true,
          accept_provider_agreement: true,
          accept_aup: true
        })
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(201);
    const json: any = await res.json();
    expect(json.provider_id).toBe("moby-brain");
    expect(json.slug).toBe("moby-brain");
    expect(json.status).toBe("active");
    expect(json.specialties).toEqual(["crypto/whale-tracking", "trading/thesis"]);

    const providerRaw = await env.PROVIDERS.get("provider:moby-brain");
    expect(providerRaw).toBeTruthy();
    const provider = JSON.parse(providerRaw as string);
    expect(provider.tags).toEqual(["trading", "whale"]);
    expect(provider.x_handle).toBe("mobybrain");
    expect(provider.provider_kind).toBe("signal-bot");
    expect(provider.status).toBe("active");

    const agreementRaw = await env.AGREEMENTS.get("agreement:moby-brain");
    expect(agreementRaw).toBeTruthy();
    const agreement = JSON.parse(agreementRaw as string);
    expect(agreement.accept_tos).toBe(true);
    expect(agreement.accept_provider_agreement).toBe(true);

    const stakeRaw = await env.AGREEMENTS.get("stake:moby-brain");
    expect(stakeRaw).toBeTruthy();
  });

  it("POST /register rejects duplicate payout wallet registrations", async () => {
    const env = makeEnv();

    const body = {
      name: "Bot One",
      description: "First bot",
      specialties: ["trading/signals"],
      payout_wallet: "0x2222222222222222222222222222222222222222",
      accept_tos: true,
      accept_privacy: true,
      accept_provider_agreement: true,
      accept_aup: true
    };

    const first = await worker.fetch(
      new Request("https://test/register", {
        method: "POST",
        headers: { "content-type": "application/json", "X-OWNER-KEY": "test-owner" },
        body: JSON.stringify(body)
      }),
      env,
      {} as any
    );
    expect(first.status).toBe(201);

    const second = await worker.fetch(
      new Request("https://test/register", {
        method: "POST",
        headers: { "content-type": "application/json", "X-OWNER-KEY": "test-owner" },
        body: JSON.stringify({
          ...body,
          name: "Bot Two",
          slug: "bot-two"
        })
      }),
      env,
      {} as any
    );

    expect(second.status).toBe(400);
    const json: any = await second.json();
    expect(json.message).toContain("payout_wallet already has an active provider registration");
  });

  it("POST /register stores the canonical record shape for later docs/llm.txt use", async () => {
    const env = makeEnv();
    const payload = {
      name: "PI Signals",
      description: "Structured trading signals and risk framing.",
      slug: "pi-signals",
      specialties: ["trading/signals", "trading/risk", "trading/defi"],
      payout_wallet: "0x3333333333333333333333333333333333333333",
      callback_url: "https://signals.example.com/webhook",
      avatar_url: "https://signals.example.com/avatar.png",
      website_url: "https://signals.example.com",
      x_handle: "proteeninjector",
      tags: ["signals", "risk", "perps"],
      sample_outputs: [
        "BTC long setup with clear invalidation.",
        "SOL scalp idea with defined TP/SL."
      ],
      bot_type: "trading-bot",
      model: "claude-3.7-sonnet",
      agent_framework: "openclaw",
      runtime: "worker",
      human_in_loop: false,
      accept_tos: true,
      accept_privacy: true,
      accept_provider_agreement: true,
      accept_aup: true
    };

    const res = await worker.fetch(
      new Request("https://test/register", {
        method: "POST",
        headers: { "content-type": "application/json", "X-OWNER-KEY": "test-owner" },
        body: JSON.stringify(payload)
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(201);

    const provider = JSON.parse((await env.PROVIDERS.get("provider:pi-signals")) as string);
    const score = JSON.parse((await env.SCORES.get("score:pi-signals")) as string);
    const agreement = JSON.parse((await env.AGREEMENTS.get("agreement:pi-signals")) as string);
    const stake = JSON.parse((await env.AGREEMENTS.get("stake:pi-signals")) as string);

    expect(provider).toMatchObject({
      id: "pi-signals",
      slug: "pi-signals",
      name: "PI Signals",
      payout_wallet: payload.payout_wallet,
      callback_url: payload.callback_url,
      provider_kind: "trading-bot",
      status: "active",
      registration_mode: "single_provider_per_payout_wallet",
      tags: ["perps", "risk", "signals"],
      sample_outputs: payload.sample_outputs,
      specialties: ["trading/defi", "trading/risk", "trading/signals"]
    });

    expect(score).toMatchObject({
      happy_trail: 45,
      quality: 45,
      reliability: 45,
      trust: 45,
      registration_status: "active",
      tier: "thinker"
    });

    expect(agreement).toMatchObject({
      provider_id: "pi-signals",
      payout_wallet: payload.payout_wallet,
      accept_tos: true,
      accept_privacy: true,
      accept_provider_agreement: true,
      accept_aup: true
    });
    expect(agreement.agreement_versions).toMatchObject({
      tos: "1.0",
      privacy: "1.0",
      provider_agreement: "1.0",
      aup: "1.0"
    });

    expect(stake).toMatchObject({
      provider_id: "pi-signals",
      payout_wallet: payload.payout_wallet,
      amount: 0.25,
      status: "paid",
      stake_type: "registration",
      forfeited: false
    });
  });
});

describe("HappyThoughts provider hosted mode", () => {
  it("provider can inspect self and rotate token", async () => {
    const env = makeEnv();
    const registerRes = await worker.fetch(
      new Request("https://test/register", {
        method: "POST",
        headers: { "content-type": "application/json", "X-OWNER-KEY": "test-owner" },
        body: JSON.stringify({
          name: "Hosted Provider",
          description: "Hosted mode provider.",
          specialties: ["crypto/whale-tracking"],
          payout_wallet: "0x7777777777777777777777777777777777777777",
          accept_tos: true,
          accept_privacy: true,
          accept_provider_agreement: true,
          accept_aup: true
        })
      }),
      env,
      {} as any
    );

    const registered: any = await registerRes.json();
    const token = registered.provider_token;

    const meRes = await worker.fetch(
      new Request("https://test/provider/me", {
        headers: { authorization: `Bearer ${token}` }
      }),
      env,
      {} as any
    );

    expect(meRes.status).toBe(200);
    const me: any = await meRes.json();
    expect(me.provider_id).toBe(registered.provider_id);
    expect(me.delivery_mode).toBe("hosted");

    const rotateRes = await worker.fetch(
      new Request("https://test/provider/token/rotate", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` }
      }),
      env,
      {} as any
    );

    expect(rotateRes.status).toBe(200);
    const rotated: any = await rotateRes.json();
    expect(rotated.provider_token).toMatch(/^htp_/);
    expect(rotated.provider_token).not.toBe(token);
  });

  it("provider can pause, resume, and revoke token", async () => {
    const env = makeEnv();
    const registerRes = await worker.fetch(
      new Request("https://test/register", {
        method: "POST",
        headers: { "content-type": "application/json", "X-OWNER-KEY": "test-owner" },
        body: JSON.stringify({
          name: "Hosted Ops",
          description: "Hosted ops provider.",
          specialties: ["social/viral"],
          payout_wallet: "0x7878787878787878787878787878787878787878",
          accept_tos: true,
          accept_privacy: true,
          accept_provider_agreement: true,
          accept_aup: true
        })
      }),
      env,
      {} as any
    );

    const registered: any = await registerRes.json();
    const token = registered.provider_token;
    const providerId = registered.provider_id;

    const pauseRes = await worker.fetch(
      new Request("https://test/provider/control/pause", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` }
      }),
      env,
      {} as any
    );
    expect(pauseRes.status).toBe(200);
    const pausedNextRes = await worker.fetch(
      new Request("https://test/provider/jobs/next", {
        headers: { authorization: `Bearer ${token}` }
      }),
      env,
      {} as any
    );
    const pausedNext: any = await pausedNextRes.json();
    expect(pausedNext.status).toBe("paused");

    const resumeRes = await worker.fetch(
      new Request("https://test/provider/control/resume", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` }
      }),
      env,
      {} as any
    );
    expect(resumeRes.status).toBe(200);

    const revokeRes = await worker.fetch(
      new Request("https://test/provider/control/revoke-token", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` }
      }),
      env,
      {} as any
    );
    expect(revokeRes.status).toBe(200);

    const meAfterRevoke = await worker.fetch(
      new Request("https://test/provider/me", {
        headers: { authorization: `Bearer ${token}` }
      }),
      env,
      {} as any
    );
    expect(meAfterRevoke.status).toBe(401);

    const provider = JSON.parse((await env.PROVIDERS.get(`provider:${providerId}`)) as string);
    expect(provider.provider_token_hash).toBeNull();
  });

  it("provider can lease and complete a hosted job", async () => {
    const env = makeEnv();
    const registerRes = await worker.fetch(
      new Request("https://test/register", {
        method: "POST",
        headers: { "content-type": "application/json", "X-OWNER-KEY": "test-owner" },
        body: JSON.stringify({
          name: "Hosted Jobs",
          description: "Hosted jobs provider.",
          specialties: ["crypto/whale-tracking"],
          payout_wallet: "0x8888888888888888888888888888888888888888",
          accept_tos: true,
          accept_privacy: true,
          accept_provider_agreement: true,
          accept_aup: true
        })
      }),
      env,
      {} as any
    );

    const registered: any = await registerRes.json();
    const providerId = registered.provider_id;
    const token = registered.provider_token;

    await env.THOUGHTS.put(
      `provider-job:${providerId}:job_123`,
      JSON.stringify({
        job_id: "job_123",
        thought_id: "ht_job_123",
        provider_id: providerId,
        prompt: "Analyze the whale flow.",
        specialty: "crypto/whale-tracking",
        status: "queued",
        created_at: new Date().toISOString()
      })
    );

    const nextRes = await worker.fetch(
      new Request("https://test/provider/jobs/next", {
        headers: { authorization: `Bearer ${token}` }
      }),
      env,
      {} as any
    );

    expect(nextRes.status).toBe(200);
    const next: any = await nextRes.json();
    expect(next.job.job_id).toBe("job_123");
    expect(next.job.status).toBe("leased");

    const respondRes = await worker.fetch(
      new Request("https://test/provider/jobs/job_123/respond", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ thought: "Meaningful whale attention.", confidence: 0.83 })
      }),
      env,
      {} as any
    );

    expect(respondRes.status).toBe(200);
    const respondedJob = JSON.parse((await env.THOUGHTS.get(`provider-job:${providerId}:job_123`)) as string);
    expect(respondedJob.status).toBe("completed");
    expect(respondedJob.response.thought).toBe("Meaningful whale attention.");
  });

  it("/think can route through a hosted provider queue", async () => {
    const env = makeEnv();
    const registerRes = await worker.fetch(
      new Request("https://test/register", {
        method: "POST",
        headers: { "content-type": "application/json", "X-OWNER-KEY": "test-owner" },
        body: JSON.stringify({
          name: "Hosted Think",
          description: "Hosted think provider.",
          specialties: ["crypto/whale-tracking"],
          payout_wallet: "0x9999999999999999999999999999999999999999",
          accept_tos: true,
          accept_privacy: true,
          accept_provider_agreement: true,
          accept_aup: true
        })
      }),
      env,
      {} as any
    );

    const registered: any = await registerRes.json();
    const providerId = registered.provider_id;
    const token = registered.provider_token;

    const thinkPromise = worker.fetch(
      new Request("https://test/think", {
        method: "POST",
        headers: { "content-type": "application/json", "X-OWNER-KEY": "test-owner" },
        body: JSON.stringify({
          prompt: "Track the whale move.",
          specialty: "crypto/whale-tracking",
          buyer_wallet: "0xbuyer"
        })
      }),
      env,
      {} as any
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    const nextRes = await worker.fetch(
      new Request("https://test/provider/jobs/next", {
        headers: { authorization: `Bearer ${token}` }
      }),
      env,
      {} as any
    );
    const next: any = await nextRes.json();
    expect(next.job.provider_id).toBe(providerId);

    await worker.fetch(
      new Request(`https://test/provider/jobs/${next.job.job_id}/respond`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ thought: "Hosted provider says whale attention is real.", confidence: 0.91 })
      }),
      env,
      {} as any
    );

    const thinkRes = await thinkPromise;
    expect(thinkRes.status).toBe(200);
    const thinkJson: any = await thinkRes.json();
    expect(thinkJson.provider_id).toBe(providerId);
    expect(thinkJson.thought).toContain("Hosted provider says whale attention is real.");
  });
});

describe("HappyThoughts internal consensus", () => {
  it("POST /internal/consensus returns panel answers plus blended output", async () => {
    const env = makeEnv();
    env.OWNER_KEY = "test-owner";
    env.CEREBRAS_API_KEY = "cerebras-test";
    env.MISTRAL_API_KEY = "mistral-test";
    env.GEMMA_AI_API_KEY = "google-test";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("api.cerebras.ai")) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Cerebras answer" } }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("api.mistral.ai")) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Mistral answer" } }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("models/gemma-4-31b-it:generateContent")) {
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Gemma answer" }] } }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("models/gemini-2.5-flash:generateContent")) {
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Blended final answer" }] } }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("not mocked", { status: 500 });
    }) as any;

    try {
      const res = await worker.fetch(
        new Request("https://test/internal/consensus", {
          method: "POST",
          headers: { "content-type": "application/json", "X-OWNER-KEY": "test-owner" },
          body: JSON.stringify({
            prompt: "What is the best way to validate a new AI marketplace concept?",
            specialty: "other/general"
          })
        }),
        env,
        {} as any
      );

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.mode).toBe("consensus_v1");
      expect(json.providers).toHaveLength(3);
      expect(json.providers.map((p: any) => p.provider)).toEqual([
        "cerebras",
        "mistral",
        "google_gemma"
      ]);
      expect(json.final_answer).toBe("Blended final answer");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("HappyThoughts Phase 7", () => {
  it("POST /internal/think — owner bypass", async () => {
    const env = makeEnv();
    env.OWNER_KEY = "test-owner";
    await seedProvider(env, "prov_internal");

    const res = await worker.fetch(
      new Request("https://test/internal/think", {
        method: "POST",
        headers: { "content-type": "application/json", "X-OWNER-KEY": "test-owner" },
        body: JSON.stringify({
          prompt: "Test prompt",
          specialty: "trading/signals",
          buyer_wallet: "0xbuyer"
        })
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.thought_id).toBeTruthy();
  });

  it("GET /internal/shill-template — returns template", async () => {
    const env = makeEnv();
    env.OWNER_KEY = "test-owner";

    const res = await worker.fetch(
      new Request("https://test/internal/shill-template?date=2026-03-22&specialty=social/shill", {
        headers: { "X-OWNER-KEY": "test-owner" }
      }),
      env,
      {} as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.date).toBe("2026-03-22");
    expect(json.platforms).toContain("arena");
  });
});
