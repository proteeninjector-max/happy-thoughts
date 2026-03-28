export interface Env {
  PROVIDERS: KVNamespace;
  SCORES: KVNamespace;
}

type SeedProvider = {
  id: string;
  name: string;
  description: string;
  specialties: string[];
  tier: "founding_brain";
  happy_trail: number;
  quality: number;
  reliability: number;
  trust: number;
  payout_wallet?: string;
  callback_url: string;
  human_in_loop: boolean;
  sla_ms: number;
  internal_provider: boolean;
};

const SEED_PROVIDERS: SeedProvider[] = [
  {
    id: "claude_haiku",
    name: "Claude Haiku General",
    description: "Internal generalist provider for uncategorized and broad-domain prompts.",
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
    trust: 75,
    payout_wallet: "0x170992058429d3d52615fef70c1006f5e5d6467c",
    callback_url: "internal://claude_haiku",
    human_in_loop: false,
    sla_ms: 6000,
    internal_provider: true
  },
  {
    id: "moby_dick",
    name: "Moby Dick Whale Tracker",
    description:
      "Internal whale-tracking provider. Fetches whale flow and positioning context for crypto market answers.",
    specialties: ["crypto/whale-tracking", "crypto/onchain-analysis"],
    tier: "founding_brain",
    happy_trail: 82,
    quality: 82,
    reliability: 82,
    trust: 82,
    payout_wallet: "0x170992058429d3d52615fef70c1006f5e5d6467c",
    callback_url: "internal://moby",
    human_in_loop: false,
    sla_ms: 4000,
    internal_provider: true
  },
  {
    id: "pi_signals",
    name: "PI Signals",
    description:
      "Internal signal provider. Reads latest V3 signal data and returns structured trading signal answers.",
    specialties: ["trading/signals", "trading/risk", "trading/defi"],
    tier: "founding_brain",
    happy_trail: 80,
    quality: 80,
    reliability: 80,
    trust: 80,
    payout_wallet: "0x170992058429d3d52615fef70c1006f5e5d6467c",
    callback_url: "internal://pi_signals",
    human_in_loop: false,
    sla_ms: 4000,
    internal_provider: true
  },
  {
    id: "pi_thesis",
    name: "PI Thesis",
    description:
      "Internal synthesis provider. Calls PI Signals and Moby internally, then returns a unified trading thesis.",
    specialties: ["trading/thesis"],
    tier: "founding_brain",
    happy_trail: 80,
    quality: 80,
    reliability: 80,
    trust: 80,
    payout_wallet: "0x170992058429d3d52615fef70c1006f5e5d6467c",
    callback_url: "internal://pi_thesis",
    human_in_loop: false,
    sla_ms: 5000,
    internal_provider: true
  }
];

export async function seedFoundingProviders(env: Env): Promise<void> {
  const now = new Date().toISOString();

  for (const provider of SEED_PROVIDERS) {
    try {
      const providerRecord = {
        id: provider.id,
        name: provider.name,
        description: provider.description,
        specialties: provider.specialties,
        payout_wallet: provider.payout_wallet ?? null,
        callback_url: provider.callback_url,
        referral_code: null,
        human_in_loop: provider.human_in_loop,
        sla_ms: provider.sla_ms,
        internal_provider: provider.internal_provider,
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
