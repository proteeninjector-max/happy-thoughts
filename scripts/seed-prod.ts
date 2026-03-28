import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const WRANGLER_PATH = join(ROOT, "wrangler.toml");

function parseTomlString(source: string, key: string): string | null {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"));
  return match ? match[1] : null;
}

function parseKvBindings(source: string): Record<string, string> {
  const lines = source.split(/\r?\n/);
  const out: Record<string, string> = {};
  let currentBinding: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "[[kv_namespaces]]") {
      currentBinding = null;
      continue;
    }
    const bindingMatch = line.match(/^binding\s*=\s*"([^"]+)"$/);
    if (bindingMatch) {
      currentBinding = bindingMatch[1];
      continue;
    }
    const idMatch = line.match(/^id\s*=\s*"([^"]+)"$/);
    if (idMatch && currentBinding) {
      out[currentBinding] = idMatch[1];
      currentBinding = null;
    }
  }

  return out;
}

type ProviderRecord = {
  id: string;
  name: string;
  description: string;
  specialties: string[];
  payout_wallet: string | null;
  callback_url: string;
  referral_code: null;
  human_in_loop: boolean;
  sla_ms: number;
  internal_provider: boolean;
  tier: "founding_brain";
  created_at: string;
};

type ScoreRecord = {
  happy_trail: number;
  quality: number;
  reliability: number;
  trust: number;
  total_thoughts: number;
  rated_thoughts: number;
  happy_rate: number;
  sad_rate: number;
  active_days: number;
  last_active: string;
  tier: "founding_brain";
  flags: string[];
};

type SeedItem = {
  id: string;
  provider: Omit<ProviderRecord, "created_at">;
  score: Omit<ScoreRecord, "last_active">;
};

const SEED_PROVIDERS: SeedItem[] = [
  {
    id: "claude_haiku",
    provider: {
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
      payout_wallet: "0x170992058429d3d52615fef70c1006f5e5d6467c",
      callback_url: "internal://claude_haiku",
      referral_code: null,
      human_in_loop: false,
      sla_ms: 6000,
      internal_provider: true,
      tier: "founding_brain"
    },
    score: {
      happy_trail: 75,
      quality: 75,
      reliability: 75,
      trust: 75,
      total_thoughts: 0,
      rated_thoughts: 0,
      happy_rate: 0,
      sad_rate: 0,
      active_days: 0,
      tier: "founding_brain",
      flags: []
    }
  },
  {
    id: "moby_dick",
    provider: {
      id: "moby_dick",
      name: "Moby Dick Whale Tracker",
      description:
        "Internal whale-tracking provider. Fetches whale flow and positioning context for crypto market answers.",
      specialties: ["crypto/whale-tracking", "crypto/onchain-analysis"],
      payout_wallet: "0x170992058429d3d52615fef70c1006f5e5d6467c",
      callback_url: "internal://moby",
      referral_code: null,
      human_in_loop: false,
      sla_ms: 4000,
      internal_provider: true,
      tier: "founding_brain"
    },
    score: {
      happy_trail: 82,
      quality: 82,
      reliability: 82,
      trust: 82,
      total_thoughts: 0,
      rated_thoughts: 0,
      happy_rate: 0,
      sad_rate: 0,
      active_days: 0,
      tier: "founding_brain",
      flags: []
    }
  },
  {
    id: "pi_signals",
    provider: {
      id: "pi_signals",
      name: "PI Signals",
      description:
        "Internal signal provider. Reads latest V3 signal data and returns structured trading signal answers.",
      specialties: ["trading/signals", "trading/risk", "trading/defi"],
      payout_wallet: "0x170992058429d3d52615fef70c1006f5e5d6467c",
      callback_url: "internal://pi_signals",
      referral_code: null,
      human_in_loop: false,
      sla_ms: 4000,
      internal_provider: true,
      tier: "founding_brain"
    },
    score: {
      happy_trail: 80,
      quality: 80,
      reliability: 80,
      trust: 80,
      total_thoughts: 0,
      rated_thoughts: 0,
      happy_rate: 0,
      sad_rate: 0,
      active_days: 0,
      tier: "founding_brain",
      flags: []
    }
  },
  {
    id: "pi_thesis",
    provider: {
      id: "pi_thesis",
      name: "PI Thesis",
      description:
        "Internal synthesis provider. Calls PI Signals and Moby internally, then returns a unified trading thesis.",
      specialties: ["trading/thesis"],
      payout_wallet: "0x170992058429d3d52615fef70c1006f5e5d6467c",
      callback_url: "internal://pi_thesis",
      referral_code: null,
      human_in_loop: false,
      sla_ms: 5000,
      internal_provider: true,
      tier: "founding_brain"
    },
    score: {
      happy_trail: 80,
      quality: 80,
      reliability: 80,
      trust: 80,
      total_thoughts: 0,
      rated_thoughts: 0,
      happy_rate: 0,
      sad_rate: 0,
      active_days: 0,
      tier: "founding_brain",
      flags: []
    }
  }
];

async function putKv(
  accountId: string,
  namespaceId: string,
  apiToken: string,
  key: string,
  value: unknown
): Promise<void> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(value)
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
}

async function main() {
  const toml = readFileSync(WRANGLER_PATH, "utf8");
  const accountId = parseTomlString(toml, "account_id");
  const kv = parseKvBindings(toml);
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId) {
    throw new Error("Could not find account_id in wrangler.toml");
  }
  if (!apiToken) {
    throw new Error("CLOUDFLARE_API_TOKEN is not set in the environment");
  }
  if (!kv.PROVIDERS || !kv.SCORES) {
    throw new Error("Could not find PROVIDERS and SCORES namespace IDs in wrangler.toml");
  }

  const now = new Date().toISOString();
  let successCount = 0;
  let failCount = 0;

  console.log(`Using account_id=${accountId}`);
  console.log(`PROVIDERS namespace=${kv.PROVIDERS}`);
  console.log(`SCORES namespace=${kv.SCORES}`);
  console.log(`Seeding ${SEED_PROVIDERS.length} founding providers...`);

  for (const item of SEED_PROVIDERS) {
    const providerKey = `provider:${item.id}`;
    const scoreKey = `score:${item.id}`;
    const providerRecord: ProviderRecord = {
      ...item.provider,
      created_at: now
    };
    const scoreRecord: ScoreRecord = {
      ...item.score,
      last_active: now
    };

    try {
      await putKv(accountId, kv.PROVIDERS, apiToken, providerKey, providerRecord);
      console.log(`✅ PROVIDERS write ok: ${providerKey}`);
      successCount += 1;
    } catch (error) {
      console.error(`❌ PROVIDERS write failed: ${providerKey}`);
      console.error(error);
      failCount += 1;
    }

    try {
      await putKv(accountId, kv.SCORES, apiToken, scoreKey, scoreRecord);
      console.log(`✅ SCORES write ok: ${scoreKey}`);
      successCount += 1;
    } catch (error) {
      console.error(`❌ SCORES write failed: ${scoreKey}`);
      console.error(error);
      failCount += 1;
    }
  }

  console.log(`\nDone. Successes: ${successCount} | Failures: ${failCount}`);

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Fatal error while seeding production KV:");
  console.error(error);
  process.exit(1);
});
