export interface Env {
  PROVIDERS: KVNamespace;
  SCORES: KVNamespace;
}

type SeedProvider = {
  id: string;
  name: string;
  specialties: string[];
  tier: "founding_brain";
  happy_trail: number;
  quality: number;
  reliability: number;
  trust: number;
  payout_wallet?: string;
};

const SEED_PROVIDERS: SeedProvider[] = [
  {
    id: "founding-claude-haiku",
    name: "Claude Haiku General",
    specialties: [
      "other/general",
      "creative/writing",
      "creative/music",
      "creative/storytelling",
      "creative/brainstorm",
      "creative/persona",
      "relationships/dating",
      "relationships/marriage",
      "relationships/conflict",
      "relationships/parenting",
      "relationships/social",
      "wellness/fitness",
      "wellness/sleep",
      "wellness/diet",
      "wellness/recovery"
    ],
    tier: "founding_brain",
    happy_trail: 75,
    quality: 75,
    reliability: 75,
    trust: 75
  },
  {
    id: "founding-moby-dick",
    name: "Moby Dick Whale Tracker",
    specialties: ["crypto/whale-tracking", "crypto/onchain-analysis", "trading/thesis"],
    tier: "founding_brain",
    happy_trail: 82,
    quality: 82,
    reliability: 82,
    trust: 82
  },
  {
    id: "founding-pi-signals",
    name: "PI Signals",
    specialties: ["trading/signals", "trading/risk", "trading/defi"],
    tier: "founding_brain",
    happy_trail: 80,
    quality: 80,
    reliability: 80,
    trust: 80
  },
  {
    id: "founding-proteenclaw",
    name: "Proteenclaw",
    specialties: ["social/shill", "social/meme", "social/thread", "crypto/whale-tracking"],
    tier: "founding_brain",
    happy_trail: 78,
    quality: 78,
    reliability: 78,
    trust: 78,
    payout_wallet: "0x170992058429d3d52615fef70c1006f5e5d6467c"
  }
];

export async function seedFoundingProviders(env: Env): Promise<void> {
  const now = new Date().toISOString();

  for (const provider of SEED_PROVIDERS) {
    try {
      const providerRecord = {
        id: provider.id,
        name: provider.name,
        description: "Founding Brain provider",
        specialties: provider.specialties,
        payout_wallet: provider.payout_wallet ?? null,
        callback_url: null,
        referral_code: null,
        human_in_loop: false,
        tier: provider.tier,
        created_at: now
      };

      const scoreRecord = {
        happy_trail: provider.happy_trail,
        quality: provider.quality,
        reliability: provider.reliability,
        trust: provider.trust,
        total_thoughts: 0,
        rated_thoughts: 0,
        happy_rate: 0,
        sad_rate: 0,
        active_days: 0,
        last_active: now,
        tier: provider.tier,
        flags: [] as string[]
      };

      await env.PROVIDERS.put(`provider:${provider.id}`, JSON.stringify(providerRecord));
      await env.SCORES.put(`score:${provider.id}`, JSON.stringify(scoreRecord));

      console.log(`Seeded provider ${provider.id}`);
    } catch (err) {
      console.error(`Failed to seed provider ${provider.id}`, err);
    }
  }
}

// Optional CLI invocation when run in a Worker environment
export default {
  async fetch(): Promise<Response> {
    return new Response(
      "Seed script module. Import seedFoundingProviders(env) and execute manually.",
      { status: 200 }
    );
  }
};
