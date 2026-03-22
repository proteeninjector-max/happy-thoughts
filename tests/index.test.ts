import { describe, it, expect } from "vitest";
import worker from "../src/index";

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
