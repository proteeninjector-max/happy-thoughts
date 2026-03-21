type X402VerificationResult =
  | { ok: true; payer: string; amount: number; token: string; network: string }
  | { ok: false; response: Response };

const X402_HEADER = "x402-payment"; // expected JSON payload

export async function verifyX402Payment(
  request: Request,
  requiredAmount: number
): Promise<X402VerificationResult> {
  const raw = request.headers.get(X402_HEADER);
  if (!raw) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error: "payment_required",
          message: "x402 payment header missing",
          requiredAmount,
          token: "USDC",
          network: "Base",
          header: X402_HEADER
        }),
        { status: 402, headers: { "content-type": "application/json" } }
      )
    };
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error: "payment_required",
          message: "invalid x402 payment payload",
          requiredAmount,
          token: "USDC",
          network: "Base",
          header: X402_HEADER
        }),
        { status: 402, headers: { "content-type": "application/json" } }
      )
    };
  }

  const amount = Number(payload.amount);
  const token = String(payload.token || "USDC");
  const network = String(payload.network || "Base");
  const payer = String(payload.payer || payload.wallet || "");

  if (!payer || !Number.isFinite(amount) || amount < requiredAmount) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error: "payment_required",
          message: "insufficient x402 payment",
          requiredAmount,
          token: "USDC",
          network: "Base",
          header: X402_HEADER
        }),
        { status: 402, headers: { "content-type": "application/json" } }
      )
    };
  }

  return { ok: true, payer, amount, token, network };
}

const SPECIALTY_LEAVES = new Set([
  "trading/signals",
  "trading/thesis",
  "trading/risk",
  "trading/defi",
  "trading/yield",
  "trading/memecoin",
  "crypto/whale-tracking",
  "crypto/onchain-analysis",
  "crypto/nft",
  "crypto/protocol",
  "medicine/diagnosis-support",
  "medicine/drug-interactions",
  "medicine/mental-health",
  "medicine/nutrition",
  "legal/contracts",
  "legal/ip",
  "legal/employment",
  "legal/criminal",
  "legal/compliance",
  "finance/personal-finance",
  "finance/tax",
  "finance/real-estate",
  "finance/budgeting",
  "engineering/mechanical",
  "engineering/software",
  "engineering/electrical",
  "engineering/aerospace",
  "engineering/materials",
  "science/biology",
  "science/chemistry",
  "science/physics",
  "science/research-design",
  "science/environment",
  "education/tutoring",
  "education/curriculum",
  "education/exam-prep",
  "education/learning-disability",
  "wellness/fitness",
  "wellness/sleep",
  "wellness/mental-health",
  "wellness/diet",
  "wellness/recovery",
  "relationships/dating",
  "relationships/marriage",
  "relationships/conflict",
  "relationships/parenting",
  "relationships/social",
  "creative/writing",
  "creative/music",
  "creative/storytelling",
  "creative/brainstorm",
  "creative/persona",
  "social/shill",
  "social/meme",
  "social/thread",
  "social/copywriting",
  "social/viral",
  "dream/interpret",
  "dream/symbolism",
  "dream/recurring",
  "dream/lucid",
  "other/general"
]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function badRequest(message: string, details?: unknown): Response {
  return jsonResponse({ error: "bad_request", message, details }, 400);
}

function validateSpecialties(specialties: string[]): string[] {
  return specialties.filter((s) => !SPECIALTY_LEAVES.has(s));
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const payment = await verifyX402Payment(request, 0.25);
  if (!payment.ok) return payment.response;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const { name, description, specialties, payout_wallet, callback_url, referral_code, human_in_loop } = body || {};

  if (!name || !description || !Array.isArray(specialties) || specialties.length === 0 || !payout_wallet) {
    return badRequest("missing required fields", {
      required: ["name", "description", "specialties[]", "payout_wallet"]
    });
  }

  const invalid = validateSpecialties(specialties);
  if (invalid.length > 0) {
    return badRequest("unknown specialties", { invalid, allowed: Array.from(SPECIALTY_LEAVES) });
  }

  const provider_id = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  const providerRecord = {
    id: provider_id,
    name,
    description,
    specialties,
    payout_wallet,
    callback_url: callback_url ?? null,
    referral_code: referral_code ?? null,
    human_in_loop: Boolean(human_in_loop),
    tier: "thinker",
    created_at: timestamp
  };

  const scoreRecord = {
    happy_trail: 45,
    quality: 45,
    reliability: 45,
    trust: 45,
    total_thoughts: 0,
    rated_thoughts: 0,
    happy_rate: 0,
    sad_rate: 0,
    active_days: 0,
    last_active: timestamp,
    tier: "thinker",
    flags: [] as string[]
  };

  const agreementRecord = {
    wallet: payment.payer,
    provider_id,
    agreed_at: timestamp,
    tos_version: "1.0"
  };

  const stakeRecord = {
    amount: 0.25,
    status: "paid",
    paid_at: timestamp
  };

  await env.PROVIDERS.put(`provider:${provider_id}`, JSON.stringify(providerRecord));
  await env.SCORES.put(`score:${provider_id}`, JSON.stringify(scoreRecord));
  await env.AGREEMENTS.put(`agreement:${payment.payer}`, JSON.stringify(agreementRecord));
  await env.PROVIDERS.put(`stake:${provider_id}`, JSON.stringify(stakeRecord));

  if (referral_code) {
    await env.REFERRALS.put(
      `referral:${referral_code}`,
      JSON.stringify({
        referred_provider_id: provider_id,
        referring_wallet: null,
        created_at: timestamp
      })
    );
  }

  return jsonResponse(
    {
      provider_id,
      happy_trail: 45,
      tier: "thinker",
      specialties
    },
    201
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/register") {
      return handleRegister(request, env);
    }

    return jsonResponse({ error: "not_found" }, 404);
  }
};

export interface Env {
  PROVIDERS: KVNamespace;
  SCORES: KVNamespace;
  THOUGHTS: KVNamespace;
  CACHE: KVNamespace;
  BUNDLES: KVNamespace;
  BUYERS: KVNamespace;
  FEEDBACK: KVNamespace;
  FLAGS: KVNamespace;
  REFERRALS: KVNamespace;
  AGREEMENTS: KVNamespace;
  PROFIT_WALLET: string;
}
