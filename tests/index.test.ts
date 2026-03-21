import { describe, it, expect } from "vitest";
import worker, { verifyX402Payment } from "../src/index";

type KVEntry = { key: string; value: string };

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
    PROFIT_WALLET: "0x170992058429d3d52615fef70c1006f5e5d6467c"
  } as any;
}

describe("HappyThoughts Phase 1", () => {
  it("GET /health returns ok", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://test/health"), env, {} as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
  });

  it("GET /discover returns empty array when no providers", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://test/discover"), env, {} as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBe(0);
  });

  it("POST /register missing fields returns 400", async () => {
    const env = makeEnv();
    const body = JSON.stringify({ name: "A" });
    const res = await worker.fetch(
      new Request("https://test/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x402-payment": JSON.stringify({ payer: "0xabc", amount: 0.25, token: "USDC", network: "Base" })
        },
        body
      }),
      env,
      {} as any
    );
    expect(res.status).toBe(400);
  });

  it("POST /register invalid specialty returns 400", async () => {
    const env = makeEnv();
    const body = JSON.stringify({
      name: "Test",
      description: "Desc",
      specialties: ["trading/unknown"],
      payout_wallet: "0xabc"
    });
    const res = await worker.fetch(
      new Request("https://test/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x402-payment": JSON.stringify({ payer: "0xabc", amount: 0.25, token: "USDC", network: "Base" })
        },
        body
      }),
      env,
      {} as any
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toMatch(/unknown specialties/i);
  });

  it("POST /register valid payload returns 201", async () => {
    const env = makeEnv();
    const body = JSON.stringify({
      name: "Test",
      description: "Desc",
      specialties: ["trading/signals"],
      payout_wallet: "0xabc"
    });
    const res = await worker.fetch(
      new Request("https://test/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x402-payment": JSON.stringify({ payer: "0xabc", amount: 0.25, token: "USDC", network: "Base" })
        },
        body
      }),
      env,
      {} as any
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.tier).toBe("thinker");
  });
});
