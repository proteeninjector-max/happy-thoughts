import { verifyX402Payment } from "./middleware/payment";
import { getDomainDisclaimer } from "./constants/disclaimers";
import { LEGAL_AUP, LEGAL_PRIVACY, LEGAL_PROVIDER_AGREEMENT, LEGAL_TOS } from "./constants/legal";
import { LLM_TXT, LLMS_FULL_TXT, OPENAPI_JSON } from "./constants/discovery";
import { loadScore, updateScore, saveScore } from "./scoring";
import { runDecay } from "./decay";
import { dispatchProvider } from "./dispatch";
import { runConsensus } from "./consensus";

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

const FOUNDING_PROVIDER_MAP: Record<string, string> = {
  "trading/signals": "pi_signals",
  "trading/risk": "pi_signals",
  "trading/defi": "pi_signals",
  "crypto/whale-tracking": "moby_dick",
  "crypto/onchain-analysis": "moby_dick",
  "trading/thesis": "pi_thesis"
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function textResponse(body: string, status = 200, headers?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain", ...(headers ?? {}) }
  });
}

function ok(body: unknown, status = 200): Response {
  return jsonResponse(body, status);
}

function badRequest(message: string, details?: unknown): Response {
  return jsonResponse({ error: "bad_request", message, details }, 400);
}

function notFound(): Response {
  return jsonResponse({ error: "Not found" }, 404);
}

function validateSpecialties(specialties: string[]): string[] {
  return specialties.filter((s) => !SPECIALTY_LEAVES.has(s));
}

function normalizeList(values: unknown, options?: { lower?: boolean; sort?: boolean }): string[] {
  if (!Array.isArray(values)) return [];
  const out = values
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .map((v) => (options?.lower ? v.toLowerCase() : v));
  const deduped = Array.from(new Set(out));
  return options?.sort === false ? deduped : deduped.sort((a, b) => a.localeCompare(b));
}

function normalizeSpecialties(values: unknown): string[] {
  return normalizeList(values, { lower: true, sort: true });
}

function normalizeTags(values: unknown): string[] {
  return normalizeList(values, { lower: true, sort: true }).slice(0, 20);
}

function normalizeSampleOutputs(values: unknown): string[] {
  return normalizeList(values, { lower: false, sort: false }).slice(0, 5).map((v) => v.slice(0, 500));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 48);
}

function isValidWallet(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function normalizeHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^@+/, "");
  if (!trimmed) return null;
  return trimmed.slice(0, 64);
}

function normalizeOptionalString(value: unknown, maxLen = 280): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function normalizeProviderKind(value: unknown): string {
  const raw = normalizeOptionalString(value, 64)?.toLowerCase();
  return raw || "bot";
}

function normalizeRuntime(value: unknown): string | null {
  return normalizeOptionalString(value, 64)?.toLowerCase() ?? null;
}

function normalizeDeliveryMode(value: unknown): "hosted" | "webhook" {
  const raw = normalizeOptionalString(value, 32)?.toLowerCase();
  return raw === "webhook" ? "webhook" : "hosted";
}

function validatePublicUrl(value: string | null, field: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      throw new Error(`${field} must use https`);
    }
    return url.toString();
  } catch (err: any) {
    throw new Error(err?.message || `${field} is invalid`);
  }
}

function validateCallbackUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      throw new Error("callback_url must use https");
    }
    return url.toString();
  } catch (err: any) {
    throw new Error(err?.message || "callback_url is invalid");
  }
}

async function providerIdExists(providerId: string, env: Env): Promise<boolean> {
  const existing = await env.PROVIDERS.get(`provider:${providerId}`);
  return Boolean(existing);
}

async function buildProviderId(slug: string | null, name: string, env: Env): Promise<string> {
  const base = slug || slugify(name) || `provider-${crypto.randomUUID().slice(0, 8)}`;
  let candidate = base;
  let i = 1;
  while (await providerIdExists(candidate, env)) {
    i += 1;
    candidate = `${base}-${i}`.slice(0, 64);
  }
  return candidate;
}

async function findProviderByPayoutWallet(wallet: string, env: Env): Promise<any | null> {
  const list = await env.PROVIDERS.list({ prefix: "provider:" });
  for (const key of list.keys) {
    const raw = await env.PROVIDERS.get(key.name);
    if (!raw) continue;
    const provider = JSON.parse(raw);
    if ((provider?.payout_wallet || "").toLowerCase() === wallet.toLowerCase()) {
      return provider;
    }
  }
  return null;
}

function parseBool(value: string | null): boolean {
  if (!value) return false;
  return ["true", "1", "yes"].includes(value.toLowerCase());
}

function getDomainMultiplier(specialties: string[]): number {
  let max = 1.0;
  for (const spec of specialties) {
    if (spec.startsWith("legal/")) max = Math.max(max, 3.0);
    else if (spec.startsWith("medicine/")) max = Math.max(max, 2.5);
    else if (spec.startsWith("science/")) max = Math.max(max, 2.0);
    else if (
      spec.startsWith("trading/") ||
      spec.startsWith("crypto/") ||
      spec.startsWith("finance/")
    )
      max = Math.max(max, 1.75);
    else if (spec.startsWith("engineering/") || spec.startsWith("education/"))
      max = Math.max(max, 1.5);
  }
  return max;
}

function computePrice(happyTrail: number, specialties: string[]): number {
  const multiplier = getDomainMultiplier(specialties);
  const base = 0.01 + 0.19 * (happyTrail / 100);
  return Math.min(0.2, Number((base * multiplier).toFixed(4)));
}

function round2(v: number) {
  return Number(v.toFixed(2));
}

function generateProviderToken(): string {
  return `htp_${crypto.randomUUID().replace(/-/g, "")}`;
}

async function hashProviderToken(token: string): Promise<string> {
  return sha256Hex(token);
}

async function getProviderByToken(request: Request, env: Env): Promise<any | null> {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;

  const tokenHash = await hashProviderToken(token);
  const providerId = await env.PROVIDERS.get(`provider-token:${tokenHash}`);
  if (!providerId) return null;
  const raw = await env.PROVIDERS.get(`provider:${providerId}`);
  if (!raw) return null;
  return JSON.parse(raw);
}

function unauthorized(message = "invalid provider token"): Response {
  return jsonResponse({ error: "unauthorized", message }, 401);
}

async function persistProvider(env: Env, provider: any): Promise<void> {
  provider.updated_at = new Date().toISOString();
  await env.PROVIDERS.put(`provider:${provider.id}`, JSON.stringify(provider));
}

async function isSybilWallet(
  buyerWallet: string,
  providerId: string,
  rating: string,
  env: Env
): Promise<boolean> {
  // Get this buyer's rating history
  const buyerHistoryRaw = await env.FEEDBACK.get(`sybil:${buyerWallet}`);
  const buyerHistory: Record<string, string> = buyerHistoryRaw ? JSON.parse(buyerHistoryRaw) : {};

  // Record this rating in their history
  buyerHistory[providerId] = rating;
  await env.FEEDBACK.put(`sybil:${buyerWallet}`, JSON.stringify(buyerHistory));

  // Get all sybil history keys to compare patterns
  const allKeys = await env.FEEDBACK.list({ prefix: "sybil:" });
  let matchCount = 0;

  for (const key of allKeys.keys) {
    if (key.name === `sybil:${buyerWallet}`) continue;
    const otherRaw = await env.FEEDBACK.get(key.name);
    if (!otherRaw) continue;
    const otherHistory: Record<string, string> = JSON.parse(otherRaw);

    // Compare overlap: how many providers did both wallets rate identically?
    const sharedProviders = Object.keys(buyerHistory).filter(
      (pid) => otherHistory[pid] === buyerHistory[pid]
    );

    // Sybil signal: 3+ identical ratings with same providers
    if (sharedProviders.length >= 3) matchCount++;
  }

  return matchCount >= 2; // 2+ other wallets with identical pattern = sybil cluster
}

function isOwnerRequest(request: Request, env: Env): boolean {
  const ownerHeader = env.OWNER_KEY_HEADER || "X-OWNER-KEY";
  const ownerKey = env.OWNER_KEY;
  if (!ownerKey) return false;
  return request.headers.get(ownerHeader) === ownerKey;
}

function getOwnerHeaders(env: Env): HeadersInit {
  const ownerHeader = env.OWNER_KEY_HEADER || "X-OWNER-KEY";
  const ownerKey = env.OWNER_KEY;
  return ownerKey ? { [ownerHeader]: ownerKey } : {};
}

async function fetchJsonMaybe(url: string, env: Env): Promise<any | null> {
  try {
    const resp = await fetch(url, { headers: getOwnerHeaders(env) });
    if (!resp.ok) return null;
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  } catch {
    return null;
  }
}

function buildTradingContextPrompt(prompt: string, specialty: string, signalData: any, mobyData: any): string {
  const signalBlock = signalData
    ? JSON.stringify(signalData, null, 2).slice(0, 2000)
    : "No fresh signal data available.";
  const mobyBlock = mobyData
    ? JSON.stringify(mobyData, null, 2).slice(0, 2500)
    : "No whale data available.";

  return [
    "You are Happy Thoughts' first-response trading intelligence provider for benchmark testing.",
    "Give a sharp, concise first response to the user's question using the supplied signal and whale context.",
    "Do not pretend data exists if it doesn't. If signal or whale context is stale/missing, say that clearly.",
    "Focus on: directional bias, whale positioning, signal confirmation/conflict, key caveats, and a practical bottom line.",
    "Do not over-explain. No markdown tables.",
    "Return 5 sections in this exact order:",
    "1. Verdict",
    "2. Why",
    "3. Signal Check",
    "4. Whale Check",
    "5. Bottom Line",
    `Specialty: ${specialty}`,
    `User prompt: ${prompt}`,
    "Signal context:",
    signalBlock,
    "Whale context:",
    mobyBlock
  ].join("\n\n");
}

async function generateTradingThought(prompt: string, specialty: string, env: Env): Promise<{ thought: string; context: any }> {
  const signalBase = env.SIGNAL_ENDPOINT_BASE || "https://proteeninjector-signal-solana.proteeninjector.workers.dev/signal";
  const mobyBase = env.MOBY_ENDPOINT_BASE || "https://proteeninjector-moby.proteeninjector.workers.dev/moby";

  const signalTickers = ["BTCUSD.P", "ETHUSD.P", "SOLUSDC.P"];
  const signalResults = await Promise.all(
    signalTickers.map(async (ticker) => ({
      ticker,
      data: await fetchJsonMaybe(`${signalBase}?ticker=${encodeURIComponent(ticker)}`, env)
    }))
  );

  const signalData = signalResults.reduce((acc: Record<string, any>, item) => {
    acc[item.ticker] = item.data;
    return acc;
  }, {});
  const mobyData = await fetchJsonMaybe(mobyBase, env);

  if (!env.ANTHROPIC_API_KEY) {
    const fallback = [
      "Verdict",
      "Unable to generate benchmark thought because ANTHROPIC_API_KEY is not configured.",
      "Why",
      "The internal benchmark path fetched context, but text synthesis is unavailable.",
      "Signal Check",
      JSON.stringify(signalData).slice(0, 800),
      "Whale Check",
      JSON.stringify(mobyData).slice(0, 800),
      "Bottom Line",
      "Context fetch works, synthesis still needs Anthropic enabled."
    ].join("\n\n");
    return { thought: fallback, context: { signals: signalData, moby: mobyData } };
  }

  const benchmarkModel = env.ANTHROPIC_BENCHMARK_MODEL || env.ANTHROPIC_MODEL || "claude-3-haiku-20240307";
  const benchmarkPrompt = buildTradingContextPrompt(prompt, specialty, signalData, mobyData);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: benchmarkModel,
      max_tokens: 500,
      system: "You are a specialized crypto trading copilot producing tight first-response trade intelligence.",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: benchmarkPrompt }]
        }
      ]
    })
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`Anthropic trading synthesis failed: ${resp.status} ${errorText.slice(0, 300)}`);
  }

  const json: any = await resp.json();
  const thought = json?.content?.map((item: any) => item?.text || "").join("\n").trim();
  return {
    thought: thought || "No thought generated.",
    context: { signals: signalData, moby: mobyData }
  };
}

async function handleInternalThink(request: Request, env: Env): Promise<Response> {
  if (!isOwnerRequest(request, env)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  let body: any;
  try {
    body = await request.clone().json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const specialty = typeof body?.specialty === "string" ? body.specialty.trim() : "";
  const benchmarkMode = Boolean(body?.benchmark_mode);
  const tradingLike = specialty.startsWith("trading/") || specialty.startsWith("crypto/") || /\bbtc\b|\beth\b|\bsol\b|whale|signal|long|short/i.test(prompt);

  if (benchmarkMode || tradingLike) {
    if (!prompt) return badRequest("prompt is required");
    if (typeof body?.buyer_wallet !== "string" || !body.buyer_wallet.trim()) {
      return badRequest("buyer_wallet is required");
    }

    const resolvedSpecialty = specialty || "trading/thesis";
    const providerId = "moby-pi-benchmark";
    const providerScore = 81;
    const pricePaid = 0;
    const thoughtId = `ht_${crypto.randomUUID()}`;
    const disclaimer = getDomainDisclaimer(resolvedSpecialty);
    const started = Date.now();

    let generated: { thought: string; context: any };
    let benchmarkError: string | null = null;
    try {
      generated = await generateTradingThought(prompt, resolvedSpecialty, env);
    } catch (err: any) {
      benchmarkError = err?.message || String(err);
      generated = {
        thought: [
          "Verdict",
          "Unable to complete the full benchmark synthesis right now.",
          "Why",
          "The internal benchmark path hit an upstream error while combining signal and whale context.",
          "Signal Check",
          "Signal context fetch may be missing, stale, or upstream returned an unexpected response.",
          "Whale Check",
          "Whale context may still be available, but synthesis failed before a full answer could be built.",
          "Bottom Line",
          "Benchmark plumbing is reachable, but this run fell back because an upstream dependency choked."
        ].join("\n\n"),
        context: {
          signals: null,
          moby: null,
          benchmark_error: benchmarkError
        }
      };
    }
    const response_time_ms = Date.now() - started;

    const thoughtRecord = {
      thought_id: thoughtId,
      prompt_hash: await sha256Hex(normalizePrompt(prompt)),
      provider_id: providerId,
      specialty: resolvedSpecialty,
      response: generated.thought,
      disclaimer,
      cached: false,
      challenger: false,
      parent_thought_id: null,
      timestamp: new Date().toISOString(),
      buyer_wallet: body.buyer_wallet.trim(),
      price_paid: pricePaid,
      confidence: 0.81,
      response_time_ms,
      provider_score: providerScore,
      benchmark_mode: true,
      benchmark_error: benchmarkError,
      context_snapshot: generated.context
    };

    await env.THOUGHTS.put(`thought:${thoughtId}`, JSON.stringify(thoughtRecord));

    return ok({
      thought_id: thoughtId,
      thought: generated.thought,
      provider_id: providerId,
      provider_score: providerScore,
      specialty: resolvedSpecialty,
      price_paid: pricePaid,
      cached: false,
      confidence: 0.81,
      parent_thought_id: null,
      disclaimer,
      benchmark_mode: true,
      benchmark_error: benchmarkError,
      context_snapshot: generated.context
    });
  }

  return handleThink(request, env);
}

async function handleInternalConsensus(request: Request, env: Env): Promise<Response> {
  if (!isOwnerRequest(request, env)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  let body: any;
  try {
    body = await request.clone().json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const specialty = typeof body?.specialty === "string" ? body.specialty.trim() : "other/general";

  if (!prompt) return badRequest("prompt is required");
  if (!SPECIALTY_LEAVES.has(specialty)) {
    return badRequest("unknown specialty", { specialty });
  }

  try {
    const result = await runConsensus(prompt, specialty, env);
    const consensusId = `consensus_${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const structured = result.synthesis?.structured || {
      agreement: [],
      disagreements: result.failed_providers.map((item) => `${item.provider} failed: ${item.error}`),
      blended_answer: result.answers.filter((item) => item.answer).map((item) => item.answer).join("\n\n"),
      confidence: "low" as const,
      raw_output: result.answers.filter((item) => item.answer).map((item) => item.answer).join("\n\n")
    };
    const lineageRecord = {
      consensus_id: consensusId,
      mode: "consensus_v1",
      prompt,
      specialty,
      created_at: createdAt,
      providers: result.answers,
      synthesis: result.synthesis,
      degraded: result.degraded,
      failure_count: result.failure_count,
      failed_providers: result.failed_providers,
      final_answer: structured.blended_answer
    };
    await env.THOUGHTS.put(`consensus:${consensusId}`, JSON.stringify(lineageRecord));

    return ok({
      consensus_id: consensusId,
      mode: "consensus_v1",
      prompt,
      specialty,
      providers: result.answers,
      synthesis: result.synthesis,
      degraded: result.degraded,
      failure_count: result.failure_count,
      failed_providers: result.failed_providers,
      final_answer: structured.blended_answer,
      structured
    });
  } catch (err: any) {
    return jsonResponse(
      {
        error: "consensus_failed",
        message: err?.message || String(err)
      },
      502
    );
  }
}

async function handleShillTemplate(request: Request, env: Env): Promise<Response> {
  if (!isOwnerRequest(request, env)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const specialty = url.searchParams.get("specialty") || "social/shill";
  const date = dateParam ? new Date(dateParam) : new Date();
  const dateStr = dateParam || date.toISOString().slice(0, 10);
  const day = date.getUTCDay();

  const templates = [
    "{DATE} — built something for the agent economy. if you're running bots, \nagents, or automated pipelines you're gonna want this. \nhappythoughts.proteeninjector.workers.dev/llm.txt \n#agentlife #happythoughts \n$PROTEEN holders get in first.",
    "{DATE} — second opinions are underrated. especially when they cost \nfractions of a cent and come from specialized thinkers. \nhappythoughts.proteeninjector.workers.dev/llm.txt \n#agentlife #happythoughts \n$PROTEEN holders get exclusive benefits at launch.",
    "{DATE} — what if your agent could ask for help without running its own \nexpensive model? working on that. \nhappythoughts.proteeninjector.workers.dev/llm.txt \n#agentlife #happythoughts \n$PROTEEN holders already know.",
    "{DATE} — providers and buyers. agents and humans. same reputation rails. \nsame marketplace. never been done. \nhappythoughts.proteeninjector.workers.dev/llm.txt \n#agentlife #happythoughts \nhold $PROTEEN.",
    "{DATE} — the agent economy needs infrastructure. been heads down. \nthis is real. \nhappythoughts.proteeninjector.workers.dev/llm.txt \n#agentlife #happythoughts \n$PROTEEN utility incoming.",
    "{DATE} — trading. medicine. law. engineering. dating. any domain. \none marketplace. agents pay per thought. \nhappythoughts.proteeninjector.workers.dev/llm.txt \n#agentlife #happythoughts \n$PROTEEN holders get exclusive access.",
    "{DATE} — the lawyer gave the green light. the infra is built. \nthe agents are waiting. \nhappythoughts.proteeninjector.workers.dev/llm.txt \n#agentlife #happythoughts \n$PROTEEN is the key."
  ];

  const template = templates[day % templates.length].replace("{DATE}", dateStr);

  return ok({
    date: dateStr,
    template,
    specialty,
    platforms: ["arena", "moltbook"]
  });
}

function computeHappyTrail(score: { quality: number; reliability: number; trust: number }): number {
  return Number((score.quality * 0.5 + score.reliability * 0.3 + score.trust * 0.2).toFixed(2));
}

function computeTier(score: any, provider: any): string {
  if (provider?.tier === "founding_brain") return "founding_brain";
  if ((score.flags || []).length === 0 && score.total_thoughts >= 200 && score.happy_trail > 80)
    return "verified_brain";
  if (score.rated_thoughts >= 50 && score.happy_trail > 65) return "trusted_thinker";
  return "thinker";
}

function matchSpecialty(query: string, providerSpecialties: string[]): boolean {
  const q = query.toLowerCase();
  return providerSpecialties.some((s) => s.toLowerCase().startsWith(q));
}

function normalizePrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getCacheTtlMs(specialty: string): number {
  if (specialty.startsWith("trading/") || specialty.startsWith("crypto/")) {
    return 72 * 60 * 60 * 1000;
  }
  return 30 * 24 * 60 * 60 * 1000;
}

async function classifySpecialty(prompt: string, env: Env): Promise<string> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const model = env.ANTHROPIC_MODEL || "claude-3-haiku-20240307";
  const leaves = Array.from(SPECIALTY_LEAVES).join(", ");

  const system =
    "You are a strict classifier. Return exactly one specialty leaf from the allowed list.";
  const user = `Classify the prompt into one specialty leaf from this list. Return ONLY the leaf string.\n\nList: ${leaves}\n\nPrompt:\n${prompt}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 64,
      system,
      messages: [{ role: "user", content: user }]
    })
  });

  if (!resp.ok) {
    throw new Error(`Anthropic classification failed: ${resp.status}`);
  }

  const json: any = await resp.json();
  const text =
    json?.content?.[0]?.text?.trim?.() ||
    json?.content?.[0]?.text ||
    "";

  const candidate = text.split(/\s+/)[0]?.trim();
  if (candidate && SPECIALTY_LEAVES.has(candidate)) return candidate;
  return "other/general";
}

async function handleThink(request: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const buyerWallet = typeof body?.buyer_wallet === "string" ? body.buyer_wallet.trim() : "";
  const minConfidence = Number(body?.min_confidence ?? "0") || 0;
  const mode = typeof body?.mode === "string" ? body.mode.trim().toLowerCase() : "quick";
  let specialty = typeof body?.specialty === "string" ? body.specialty.trim() : "";

  if (!prompt) return badRequest("prompt is required");
  if (!buyerWallet) return badRequest("buyer_wallet is required");

  if (!specialty) {
    try {
      specialty = await classifySpecialty(prompt, env);
    } catch (err: any) {
      return badRequest("specialty classification failed", { error: err?.message });
    }
  }

  if (!SPECIALTY_LEAVES.has(specialty)) {
    return badRequest("unknown specialty", { specialty });
  }

  if (!["quick", "consensus"].includes(mode)) {
    return badRequest("mode must be quick|consensus", { mode });
  }

  const promptHash = await sha256Hex(normalizePrompt(prompt));
  const cacheKey = `cache:${mode}:${promptHash}`;
  const cachedRaw = await env.CACHE.get(cacheKey);

  if (cachedRaw) {
    const cached = JSON.parse(cachedRaw);
    const cachedAt = cached?.created_at ? new Date(cached.created_at).getTime() : 0;
    const ttlMs = getCacheTtlMs(cached.specialty || specialty);
    if (cachedAt && Date.now() - cachedAt <= ttlMs) {
      const cachedPrice = Number((cached.price_paid * 0.6).toFixed(4));
      if (!isOwnerRequest(request, env)) {
        const payment = await verifyX402Payment(
          request,
          env,
          cachedPrice,
          "Happy Thoughts cached thought"
        );
        if (!payment.ok) return payment.response;
      }

      const thoughtId = `ht_${crypto.randomUUID()}`;
      const disclaimer = getDomainDisclaimer(cached.specialty || specialty);
      const response_time_ms = 0;

      const thoughtRecord = {
        thought_id: thoughtId,
        prompt_hash: promptHash,
        provider_id: cached.provider_id,
        specialty: cached.specialty || specialty,
        response: cached.response,
        disclaimer,
        cached: true,
        parent_thought_id: cached.thought_id || null,
        timestamp: new Date().toISOString(),
        buyer_wallet: buyerWallet,
        price_paid: cachedPrice,
        confidence: cached.confidence ?? 0,
        response_time_ms,
        provider_meta: cached.provider_meta ?? null,
        revenue_split: {
          broker_wallet: env.PROFIT_WALLET,
          broker_amount: Number((cachedPrice * 0.3).toFixed(4)),
          provider_wallet: cached.provider_wallet || null,
          provider_amount: Number((cachedPrice * 0.7).toFixed(4))
        }
      };

      await env.THOUGHTS.put(`thought:${thoughtId}`, JSON.stringify(thoughtRecord));

      // --- Phase 3 score updates from /think ---
      const provider_id = cached.provider_id;
      const cached_flag = true;
      const buyer_wallet = buyerWallet;
      const providerScore = await loadScore(provider_id, env);
      if (providerScore) {
        let updatedScore = providerScore;

        // 1. Reuse rate: increment total_cached if this was a cache hit
        if (cached_flag) {
          updatedScore.total_cached = (updatedScore.total_cached || 0) + 1;
          updatedScore.reuse_rate =
            updatedScore.total_thoughts > 0 ? round2(updatedScore.total_cached / updatedScore.total_thoughts) : 0;
          updatedScore = updateScore(updatedScore, { type: "cache_reuse" }, env);
        }

        // 2. Returning buyer bonus: check BUYERS KV for prior purchases from this provider
        const buyerKey = `buyer:${buyer_wallet}:${provider_id}`;
        const priorPurchase = await env.BUYERS.get(buyerKey);
        let buyerRecord: any = null;
        if (priorPurchase) {
          // Returning buyer — check if bonus already applied for this buyer
          buyerRecord = JSON.parse(priorPurchase);
          if (!buyerRecord.bonus_applied) {
            updatedScore = updateScore(updatedScore, { type: "returning_buyer" }, env);
            buyerRecord.bonus_applied = true;
            await env.BUYERS.put(buyerKey, JSON.stringify(buyerRecord));
          }
        }

        // Write/update buyer record regardless
        const buyerData = priorPurchase
          ? JSON.parse(priorPurchase)
          : { first_purchase: Date.now(), bonus_applied: false };
        buyerData.bonus_applied = buyerRecord?.bonus_applied ?? buyerData.bonus_applied;
        buyerData.last_purchase = Date.now();
        buyerData.total_purchases = (buyerData.total_purchases || 0) + 1;
        await env.BUYERS.put(buyerKey, JSON.stringify(buyerData));

        // 3. SLA tracking: compare response_time_ms to provider's stated SLA
        const providerRaw = await env.PROVIDERS.get(`provider:${provider_id}`);
        if (providerRaw && typeof response_time_ms === "number") {
          const providerRecord = JSON.parse(providerRaw);
          const sla = providerRecord.sla_ms ?? 5000;
          if (response_time_ms <= sla) {
            updatedScore = updateScore(updatedScore, { type: "sla_met" }, env);
          } else if (response_time_ms >= sla * 2) {
            updatedScore = updateScore(updatedScore, { type: "sla_exceeded_2x" }, env);
          }
        }

        await saveScore(updatedScore, env);
      }

      return ok({
        thought_id: thoughtId,
        thought: cached.response,
        provider_id: cached.provider_id,
        provider_score: cached.provider_score ?? null,
        specialty: cached.specialty || specialty,
        price_paid: cachedPrice,
        cached: true,
        confidence: thoughtRecord.confidence,
        response_time_ms,
        parent_thought_id: thoughtRecord.parent_thought_id,
        disclaimer,
        meta: cached.provider_meta ?? null
      });
    }
  }

  if (mode === "consensus") {
    const price = 0.03;
    if (!isOwnerRequest(request, env)) {
      const payment = await verifyX402Payment(request, env, price, "Happy Thoughts consensus answer");
      if (!payment.ok) return payment.response;
    }

    const started = Date.now();
    const consensus = await runConsensus(prompt, specialty, env);
    const consensusId = `consensus_${crypto.randomUUID()}`;
    const disclaimer = getDomainDisclaimer(specialty);
    const finalStructured = consensus.synthesis?.structured || {
      agreement: [],
      disagreements: consensus.failed_providers.map((item) => `${item.provider} failed: ${item.error}`),
      blended_answer: consensus.answers.filter((item) => item.answer).map((item) => item.answer).join("\n\n"),
      confidence: "low" as const,
      raw_output: consensus.answers.filter((item) => item.answer).map((item) => item.answer).join("\n\n")
    };

    const lineageRecord = {
      consensus_id: consensusId,
      thought_id: consensusId,
      mode: "consensus",
      prompt_hash: promptHash,
      prompt,
      specialty,
      created_at: new Date().toISOString(),
      buyer_wallet: buyerWallet,
      price_paid: price,
      providers: consensus.answers,
      synthesis: consensus.synthesis,
      degraded: consensus.degraded,
      failure_count: consensus.failure_count,
      failed_providers: consensus.failed_providers,
      final_answer: finalStructured.blended_answer,
      confidence: finalStructured.confidence,
      disclaimer
    };

    await env.THOUGHTS.put(`consensus:${consensusId}`, JSON.stringify(lineageRecord));
    await env.CACHE.put(
      cacheKey,
      JSON.stringify({
        thought_id: consensusId,
        response: finalStructured.blended_answer,
        provider_id: "consensus_panel",
        provider_wallet: null,
        provider_score: null,
        specialty,
        price_paid: price,
        confidence: finalStructured.confidence,
        provider_meta: {
          mode: "consensus",
          structured: finalStructured,
          degraded: consensus.degraded,
          failure_count: consensus.failure_count,
          failed_providers: consensus.failed_providers,
          providers: consensus.answers,
          synthesis: consensus.synthesis
        },
        created_at: lineageRecord.created_at
      })
    );

    if (minConfidence > 0) {
      const confidenceRank = { low: 0.33, medium: 0.66, high: 0.95 }[finalStructured.confidence] || 0;
      if (confidenceRank < minConfidence) {
        return jsonResponse(
          {
            error: "confidence_below_minimum",
            message: "Consensus answer completed but confidence fell below requested minimum.",
            confidence: finalStructured.confidence,
            structured: finalStructured,
            failed_providers: consensus.failed_providers,
            degraded: consensus.degraded
          },
          409
        );
      }
    }

    return ok({
      thought_id: consensusId,
      mode: "consensus",
      thought: finalStructured.blended_answer,
      specialty,
      price_paid: price,
      cached: false,
      confidence: finalStructured.confidence,
      response_time_ms: Date.now() - started,
      parent_thought_id: null,
      disclaimer,
      meta: {
        structured: finalStructured,
        degraded: consensus.degraded,
        failure_count: consensus.failure_count,
        failed_providers: consensus.failed_providers,
        providers: consensus.answers,
        synthesis_model: consensus.synthesis?.model || null,
        synthesis_provider: consensus.synthesis?.provider || null
      }
    });
  }

  const candidates: any[] = [];
  const list = await env.PROVIDERS.list({ prefix: "provider:" });

  for (const key of list.keys) {
    const raw = await env.PROVIDERS.get(key.name);
    if (!raw) continue;
    const provider = JSON.parse(raw);

    if (!matchSpecialty(specialty, provider.specialties || [])) continue;
    if (provider.delivery_status && provider.delivery_status !== "ready") continue;

    const scoreRaw = await env.SCORES.get(`score:${provider.id}`);
    if (!scoreRaw) continue;
    const score = JSON.parse(scoreRaw);

    if (Array.isArray(score.flags) && score.flags.length > 0) continue;

    candidates.push({ provider, score });
  }

  if (candidates.length === 0) {
    return jsonResponse({ error: "no_providers", message: "No providers available" }, 404);
  }

  // Challenger routing: 10% of traffic goes to a non-top provider
  const isChallenger = Math.random() < 0.1;
  let selected: any = null;

  if (isChallenger) {
    const allProviders = candidates.filter(({ score }) => {
      if (score.hidden) return false;
      if (score.suspended_until && score.suspended_until > Date.now()) return false;
      if (score.tier === "founding_brain") return false;
      return true;
    });

    allProviders.sort((a, b) => b.score.happy_trail - a.score.happy_trail);

    if (allProviders.length > 1) {
      const pool = allProviders.slice(1);
      selected = pool[Math.floor(Math.random() * pool.length)];
      console.log(`[CHALLENGER] routing to ${selected.provider.id} (not top)`);
    } else {
      selected = allProviders[0] ?? null;
    }
  } else {
    candidates.sort((a, b) => b.score.happy_trail - a.score.happy_trail);
    selected = candidates[0];
  }

  if (!selected) {
    return new Response(JSON.stringify({ error: "no providers available" }), { status: 404 });
  }

  const provider = selected.provider;
  const score = selected.score;

  const price = computePrice(score.happy_trail, provider.specialties || []);
  if (!isOwnerRequest(request, env)) {
    const payment = await verifyX402Payment(request, env, price, "Happy Thoughts thought");
    if (!payment.ok) return payment.response;
  }

  const thoughtId = `ht_${crypto.randomUUID()}`;
  const disclaimer = getDomainDisclaimer(specialty);
  const dispatchResult = await dispatchProvider(
    {
      provider,
      prompt,
      specialty,
      buyer_wallet: buyerWallet,
      thought_id: thoughtId
    },
    env
  );
  const thought = dispatchResult.answer;
  const confidence = dispatchResult.confidence;
  const response_time_ms = dispatchResult.response_time_ms;

  const thoughtRecord = {
    thought_id: thoughtId,
    prompt_hash: promptHash,
    provider_id: provider.id,
    specialty,
    response: thought,
    disclaimer,
    cached: false,
    challenger: isChallenger,
    parent_thought_id: null,
    timestamp: new Date().toISOString(),
    buyer_wallet: buyerWallet,
    price_paid: price,
    confidence,
    response_time_ms,
    provider_score: score.happy_trail,
    provider_meta: dispatchResult.meta ?? null,
    revenue_split: {
      broker_wallet: env.PROFIT_WALLET,
      broker_amount: Number((price * 0.3).toFixed(4)),
      provider_wallet: provider.payout_wallet || null,
      provider_amount: Number((price * 0.7).toFixed(4))
    }
  };

  await env.THOUGHTS.put(`thought:${thoughtId}`, JSON.stringify(thoughtRecord));

  // --- Phase 3 score updates from /think ---
  const provider_id = provider.id;
  const cached_flag = false;
  const buyer_wallet = buyerWallet;
  const providerScore = await loadScore(provider_id, env);
  if (providerScore) {
    let updatedScore = providerScore;

    // 1. Reuse rate: increment total_cached if this was a cache hit
    if (cached_flag) {
      updatedScore.total_cached = (updatedScore.total_cached || 0) + 1;
      updatedScore.reuse_rate =
        updatedScore.total_thoughts > 0 ? round2(updatedScore.total_cached / updatedScore.total_thoughts) : 0;
      updatedScore = updateScore(updatedScore, { type: "cache_reuse" }, env);
    }

    // 2. Returning buyer bonus: check BUYERS KV for prior purchases from this provider
    const buyerKey = `buyer:${buyer_wallet}:${provider_id}`;
    const priorPurchase = await env.BUYERS.get(buyerKey);
    let buyerRecord: any = null;
    if (priorPurchase) {
      // Returning buyer — check if bonus already applied for this buyer
      buyerRecord = JSON.parse(priorPurchase);
      if (!buyerRecord.bonus_applied) {
        updatedScore = updateScore(updatedScore, { type: "returning_buyer" }, env);
        buyerRecord.bonus_applied = true;
        await env.BUYERS.put(buyerKey, JSON.stringify(buyerRecord));
      }
    }

    // Write/update buyer record regardless
    const buyerData = priorPurchase
      ? JSON.parse(priorPurchase)
      : { first_purchase: Date.now(), bonus_applied: false };
    buyerData.bonus_applied = buyerRecord?.bonus_applied ?? buyerData.bonus_applied;
    buyerData.last_purchase = Date.now();
    buyerData.total_purchases = (buyerData.total_purchases || 0) + 1;
    await env.BUYERS.put(buyerKey, JSON.stringify(buyerData));

    // 3. SLA tracking: compare response_time_ms to provider's stated SLA
    const providerRaw = await env.PROVIDERS.get(`provider:${provider_id}`);
    if (providerRaw && typeof response_time_ms === "number") {
      const providerRecord = JSON.parse(providerRaw);
      const sla = providerRecord.sla_ms ?? 5000;
      if (response_time_ms <= sla) {
        updatedScore = updateScore(updatedScore, { type: "sla_met" }, env);
      } else if (response_time_ms >= sla * 2) {
        updatedScore = updateScore(updatedScore, { type: "sla_exceeded_2x" }, env);
      }
    }

    await saveScore(updatedScore, env);
  }

  const cacheRecord = {
    thought_id: thoughtId,
    response: thought,
    provider_id: provider.id,
    provider_wallet: provider.payout_wallet || null,
    provider_score: score.happy_trail,
    specialty,
    price_paid: price,
    confidence,
    provider_meta: dispatchResult.meta ?? null,
    created_at: thoughtRecord.timestamp
  };
  await env.CACHE.put(cacheKey, JSON.stringify(cacheRecord));

  return ok({
    thought_id: thoughtId,
    thought,
    provider_id: provider.id,
    provider_score: score.happy_trail,
    specialty,
    price_paid: price,
    cached: false,
    confidence,
    response_time_ms,
    parent_thought_id: null,
    disclaimer,
    meta: dispatchResult.meta ?? null
  });
}

async function handleFeedback(request: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const thoughtId = typeof body?.thought_id === "string" ? body.thought_id.trim() : "";
  const providerId = typeof body?.provider_id === "string" ? body.provider_id.trim() : "";
  const rating = typeof body?.rating === "string" ? body.rating.trim() : "";
  const buyerWallet = typeof body?.buyer_wallet === "string" ? body.buyer_wallet.trim() : "";
  const tag = typeof body?.tag === "string" ? body.tag.trim() : null;

  if (!thoughtId) return badRequest("thought_id is required");
  if (!providerId) return badRequest("provider_id is required");
  if (!buyerWallet) return badRequest("buyer_wallet is required");
  if (!rating || !["happy", "sad"].includes(rating)) {
    return badRequest("rating must be happy|sad");
  }

  const thoughtRaw = await env.THOUGHTS.get(`thought:${thoughtId}`);
  if (!thoughtRaw) return badRequest("unknown thought_id");

  const thought = JSON.parse(thoughtRaw);
  if (thought.provider_id !== providerId) {
    return badRequest("provider_id does not match thought record");
  }
  if (thought.buyer_wallet !== buyerWallet) {
    return badRequest("buyer_wallet did not purchase this thought");
  }

  const buyerKey = `buyer:${buyerWallet}`;
  const buyerRaw = await env.BUYERS.get(buyerKey);
  if (!buyerRaw) return badRequest("buyer profile not found");
  const buyer = JSON.parse(buyerRaw);
  if ((buyer.total_paid || 0) < 3) {
    return badRequest("buyer must have 3+ paid thoughts before rating");
  }

  const now = Date.now();
  const lastRatings = buyer.last_ratings || {};
  const lastForProvider = lastRatings[providerId];
  if (lastForProvider && now - new Date(lastForProvider).getTime() < 24 * 60 * 60 * 1000) {
    return badRequest("rate limit: max 1 rating per provider per 24h");
  }

  let score = await loadScore(providerId, env);
  if (!score) return new Response(JSON.stringify({ error: "provider score not found" }), { status: 404 });

  // Self-dealing detection: provider rating their own thought
  const providerRaw = await env.PROVIDERS.get(`provider:${providerId}`);
  const providerRecord = providerRaw ? JSON.parse(providerRaw) : null;
  if (providerRecord?.wallet && providerRecord.wallet.toLowerCase() === buyerWallet.toLowerCase()) {
    // Nullify rating, apply -10 Quality penalty, log it
    score.quality = Math.max(0, score.quality - 10);
    score.happy_trail = round2(score.quality * 0.5 + score.reliability * 0.3 + score.trust * 0.2);
    await saveScore(score, env);
    console.log(
      `[SELF-DEALING] detected: ${buyerWallet} rated own thought ${thoughtId} — nullified, -10 Quality`
    );
    await env.FLAGS.put(
      `selfdealing:${providerId}:${thoughtId}`,
      JSON.stringify({
        provider_id: providerId,
        thought_id: thoughtId,
        buyer_wallet: buyerWallet,
        detected_at: new Date().toISOString()
      })
    );
    return new Response(
      JSON.stringify({
        error: "self-dealing detected — rating nullified",
        penalty: "-10 Quality applied"
      }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  const happyWindowKey = `feedback:provider:${providerId}:happy_window`;
  let happyWindow: number[] = [];
  const windowRaw = await env.FEEDBACK.get(happyWindowKey);
  if (windowRaw) happyWindow = JSON.parse(windowRaw) || [];
  happyWindow = happyWindow.filter((ts) => now - ts < 60 * 60 * 1000);

  let held = false;
  if (rating === "happy") {
    happyWindow.push(now);
    if (happyWindow.length >= 5) {
      held = true;
      score.flags = Array.isArray(score.flags) ? score.flags : [];
      if (!score.flags.includes("burst_hold")) score.flags.push("burst_hold");
    }
  }

  // Sybil detection
  const sybil = await isSybilWallet(buyerWallet, providerId, rating, env);
  const sybilWeight = sybil ? 0.25 : 1.0;

  if (!held) {
    if (rating === "happy") {
      const isChallenger = thought?.challenger === true;
      const event = isChallenger ? { type: "challenger_happy" as const } : { type: "happy_rating" as const };
      let updatedScore = updateScore(score, event, env);
      if (sybil) {
        // Sybil: revert to original quality, apply only 25% of the delta
        const fullDelta = updatedScore.quality - score.quality;
        updatedScore.quality = round2(score.quality + fullDelta * 0.25);
        updatedScore.happy_trail = round2(
          updatedScore.quality * 0.5 + updatedScore.reliability * 0.3 + updatedScore.trust * 0.2
        );
        console.log(`[SYBIL] reduced weight 0.25x for ${buyerWallet} → ${providerId}`);
      }
      score = updatedScore;
    } else if (rating === "sad") {
      let updatedScore = updateScore(score, { type: "sad_rating" }, env);
      if (sybil) {
        const fullDelta = updatedScore.quality - score.quality;
        updatedScore.quality = round2(score.quality + fullDelta * 0.25);
        updatedScore.happy_trail = round2(
          updatedScore.quality * 0.5 + updatedScore.reliability * 0.3 + updatedScore.trust * 0.2
        );
        console.log(`[SYBIL] reduced weight 0.25x for ${buyerWallet} → ${providerId}`);
      }
      score = updatedScore;
    }

    if (tag === "hallucinated") {
      score = updateScore(score, { type: "hallucinated", verified_buyer: true }, env);
    }

    await saveScore(score, env);
  } else {
    await saveScore(score, env);
  }

  const feedbackRecord = {
    thought_id: thoughtId,
    provider_id: providerId,
    rating,
    tag,
    buyer_wallet: buyerWallet,
    created_at: new Date().toISOString(),
    held,
    challenger: Boolean(thought.challenger)
  };

  await env.FEEDBACK.put(`feedback:${thoughtId}`, JSON.stringify(feedbackRecord));
  await env.FEEDBACK.put(happyWindowKey, JSON.stringify(happyWindow));

  buyer.last_ratings = { ...lastRatings, [providerId]: feedbackRecord.created_at };
  await env.BUYERS.put(buyerKey, JSON.stringify(buyer));

  return ok({
    status: held ? "held" : "applied",
    thought_id: thoughtId,
    provider_id: providerId,
    happy_trail: score.happy_trail,
    tier: score.tier,
    sybil_flagged: sybil
  });
}

async function handleDispute(request: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const thoughtId = typeof body?.thought_id === "string" ? body.thought_id.trim() : "";
  const providerId = typeof body?.provider_id === "string" ? body.provider_id.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const buyerWallet = typeof body?.buyer_wallet === "string" ? body.buyer_wallet.trim() : "";

  if (!thoughtId) return badRequest("thought_id is required");
  if (!providerId) return badRequest("provider_id is required");
  if (!reason) return badRequest("reason is required");
  if (!buyerWallet) return badRequest("buyer_wallet is required");

  const thoughtKey = `thought:${thoughtId}`;
  const thoughtRaw = await env.THOUGHTS.get(thoughtKey);
  if (!thoughtRaw) return badRequest("unknown thought_id");

  const thought = JSON.parse(thoughtRaw);
  if (thought.provider_id !== providerId) {
    return badRequest("provider_id does not match thought record");
  }
  if (thought.buyer_wallet !== buyerWallet) {
    return badRequest("buyer_wallet did not purchase this thought");
  }

  const disputeId = `dispute_${crypto.randomUUID()}`;
  const now = new Date();
  const createdAt = now.toISOString();

  const disputeRecord = {
    dispute_id: disputeId,
    thought_id: thoughtId,
    provider_id: providerId,
    reason,
    buyer_wallet: buyerWallet,
    created_at: createdAt
  };

  await env.FLAGS.put(`flag:${providerId}:${thoughtId}`, JSON.stringify(disputeRecord));

  const list = await env.FLAGS.list({ prefix: `flag:${providerId}:` });
  const windowStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const uniqueBuyers = new Set<string>();

  for (const key of list.keys) {
    const raw = await env.FLAGS.get(key.name);
    if (!raw) continue;
    const record = JSON.parse(raw);
    const ts = record?.created_at ? new Date(record.created_at).getTime() : 0;
    if (ts >= windowStart && record?.buyer_wallet) {
      uniqueBuyers.add(record.buyer_wallet);
    }
  }

  let suspended = false;
  let suspendedUntil: string | null = null;

  let score = await loadScore(providerId, env);
  if (score) {
    if (uniqueBuyers.size >= 3) {
      suspended = true;
      const until = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      suspendedUntil = until.toISOString();
      score.suspended_until = new Date(suspendedUntil).getTime();
      score.flags = Array.isArray(score.flags) ? score.flags : [];
      if (!score.flags.includes("suspended")) score.flags.push("suspended");
    }

    score = updateScore(score, { type: "dispute_upheld" }, env);
    await saveScore(score, env);
  }

  const responseText = (thought.response || "").toString().trim();
  const fullRefund = responseText.length === 0 || responseText.toLowerCase() === "error";
  const partialRefund = !fullRefund;

  thought.refund = {
    full_refund: fullRefund,
    partial_refund: partialRefund,
    reason,
    disputed_at: createdAt
  };

  if (score) {
    score = updateScore(score, { type: "refund" }, env);
    await saveScore(score, env);
  }

  await env.THOUGHTS.put(thoughtKey, JSON.stringify(thought));

  return ok({
    dispute_id: disputeId,
    status: "filed",
    suspended,
    suspended_until: suspendedUntil
  });
}

async function handleRefund(request: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const thoughtId = typeof body?.thought_id === "string" ? body.thought_id.trim() : "";
  const buyerWallet = typeof body?.buyer_wallet === "string" ? body.buyer_wallet.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  if (!thoughtId) return badRequest("thought_id is required");
  if (!buyerWallet) return badRequest("buyer_wallet is required");
  if (!reason) return badRequest("reason is required");

  const thoughtRaw = await env.THOUGHTS.get(`thought:${thoughtId}`);
  if (!thoughtRaw) return badRequest("unknown thought_id");

  const thought = JSON.parse(thoughtRaw);
  if (thought.buyer_wallet !== buyerWallet) {
    return badRequest("buyer_wallet did not purchase this thought");
  }
  if (thought.refunded) {
    return badRequest("thought has already been refunded");
  }

  const providerId = thought.provider_id;
  let score = await loadScore(providerId, env);
  if (score) {
    score = updateScore(score, { type: "refund" }, env);
    await saveScore(score, env);
  }

  thought.refunded = true;
  thought.refund = {
    reason,
    refunded_at: new Date().toISOString(),
    requested_by: buyerWallet
  };
  await env.THOUGHTS.put(`thought:${thoughtId}`, JSON.stringify(thought));

  console.log(`[REFUND] issued for thought ${thoughtId} provider ${providerId}`);

  return ok({
    status: "refunded",
    thought_id: thoughtId,
    provider_id: providerId,
    happy_trail: score?.happy_trail ?? null
  });
}

async function handleCreateBundle(request: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const providerId = typeof body?.provider_id === "string" ? body.provider_id.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const thoughtIds: string[] = Array.isArray(body?.thought_ids) ? body.thought_ids : [];
  const priceUsdc = typeof body?.price_usdc === "number" ? body.price_usdc : null;
  const description = typeof body?.description === "string" ? body.description.trim() : "";

  if (!providerId) return badRequest("provider_id is required");
  if (!name) return badRequest("name is required");
  if (thoughtIds.length === 0) return badRequest("thought_ids must be a non-empty array");
  if (thoughtIds.length > 10) return badRequest("bundles are limited to 10 thoughts");
  if (priceUsdc === null || priceUsdc < 0.01) return badRequest("price_usdc must be >= 0.01");

  // Verify provider exists
  const providerRaw = await env.PROVIDERS.get(`provider:${providerId}`);
  if (!providerRaw) return badRequest("unknown provider_id");

  // Verify all thought_ids exist and belong to this provider
  const thoughts = [] as any[];
  for (const tid of thoughtIds) {
    const raw = await env.THOUGHTS.get(`thought:${tid}`);
    if (!raw) return badRequest(`unknown thought_id: ${tid}`);
    const thought = JSON.parse(raw);
    if (thought.provider_id !== providerId) {
      return badRequest(`thought ${tid} does not belong to provider ${providerId}`);
    }
    thoughts.push(thought);
  }

  const bundleId = `bundle_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const providerEarning = round2(priceUsdc * 0.7);
  const brokerEarning = round2(priceUsdc * 0.3);

  const bundle = {
    bundle_id: bundleId,
    provider_id: providerId,
    name,
    description,
    thought_ids: thoughtIds,
    thought_count: thoughtIds.length,
    price_usdc: priceUsdc,
    provider_earning: providerEarning,
    broker_earning: brokerEarning,
    profit_wallet: env.PROFIT_WALLET,
    created_at: now,
    active: true
  };

  await env.BUNDLES.put(`bundle:${bundleId}`, JSON.stringify(bundle));

  return ok({
    bundle_id: bundleId,
    name,
    thought_count: thoughtIds.length,
    price_usdc: priceUsdc,
    provider_earning: providerEarning,
    broker_earning: brokerEarning,
    created_at: now
  });
}

async function handleGetBundle(id: string, env: Env): Promise<Response> {
  const raw = await env.BUNDLES.get(`bundle:${id}`);
  if (!raw)
    return new Response(JSON.stringify({ error: "bundle not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });

  const bundle = JSON.parse(raw);

  // Enrich with current provider score
  const score = await loadScore(bundle.provider_id, env);

  return ok({
    ...bundle,
    provider_happy_trail: score?.happy_trail ?? null,
    provider_tier: score?.tier ?? null
  });
}

async function handleGetReferral(wallet: string, env: Env): Promise<Response> {
  const referralKey = `referral:${wallet}`;
  const raw = await env.REFERRALS.get(referralKey);
  if (!raw)
    return new Response(JSON.stringify({ error: "no referral record found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });

  const record = JSON.parse(raw);
  return ok(record);
}

async function handleScore(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const providerId = url.pathname.split("/")[2];
  if (!providerId) return badRequest("provider_id is required");

  const providerRaw = await env.PROVIDERS.get(`provider:${providerId}`);
  const scoreRaw = await env.SCORES.get(`score:${providerId}`);

  if (!providerRaw || !scoreRaw) {
    return notFound();
  }

  const provider = JSON.parse(providerRaw);
  const score = JSON.parse(scoreRaw);

  return ok({
    provider_id: providerId,
    happy_trail: score.happy_trail,
    components: {
      quality: score.quality,
      reliability: score.reliability,
      trust: score.trust
    },
    total_thoughts: score.total_thoughts,
    reuse_rate: score.reuse_rate ?? null,
    happy_rate: score.happy_rate,
    sad_rate: score.sad_rate,
    active_days: score.active_days,
    last_active: score.last_active,
    tier: score.tier || provider.tier,
    verified: provider.tier === "verified_brain" || provider.tier === "founding_brain",
    specialties: provider.specialties || [],
    flags: score.flags || [],
    on_chain_proof: score.on_chain_proof ?? null
  });
}

async function handleDiscover(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const specialty = url.searchParams.get("specialty");
  const minScore = Number(url.searchParams.get("min_score") ?? "0") || 0;
  const tier = url.searchParams.get("tier");
  const verifiedOnly = parseBool(url.searchParams.get("verified_only"));
  const maxPrice = url.searchParams.get("max_price");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "10") || 10, 100);

  const list = await env.PROVIDERS.list({ prefix: "provider:" });
  const providers: any[] = [];

  for (const key of list.keys) {
    const raw = await env.PROVIDERS.get(key.name);
    if (!raw) continue;
    const provider = JSON.parse(raw);

    const scoreRaw = await env.SCORES.get(`score:${provider.id}`);
    if (!scoreRaw) continue;
    const score = JSON.parse(scoreRaw);

    if (Array.isArray(score.flags) && score.flags.length > 0) continue;
    if (specialty && !matchSpecialty(specialty, provider.specialties || [])) continue;
    if (tier && provider.tier !== tier) continue;
    if (score.happy_trail < minScore) continue;

    const price = computePrice(score.happy_trail, provider.specialties || []);
    if (maxPrice && price > Number(maxPrice)) continue;

    const verified = provider.tier === "verified_brain" || provider.tier === "founding_brain";
    if (verifiedOnly && !verified) continue;

    providers.push({
      provider_id: provider.id,
      name: provider.name,
      specialties: provider.specialties || [],
      tier: provider.tier,
      happy_trail: score.happy_trail,
      price,
      verified,
      last_active: score.last_active,
      total_thoughts: score.total_thoughts
    });
  }

  providers.sort((a, b) => b.happy_trail - a.happy_trail);

  return jsonResponse(providers.slice(0, limit));
}

async function handleRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const specialty = url.searchParams.get("specialty");
  const minScore = Number(url.searchParams.get("min_score") ?? "0") || 0;
  const tier = url.searchParams.get("tier");
  const verifiedOnly = parseBool(url.searchParams.get("verified_only"));
  const maxPrice = url.searchParams.get("max_price");

  const list = await env.PROVIDERS.list({ prefix: "provider:" });
  const providers: any[] = [];

  for (const key of list.keys) {
    const raw = await env.PROVIDERS.get(key.name);
    if (!raw) continue;
    const provider = JSON.parse(raw);

    const scoreRaw = await env.SCORES.get(`score:${provider.id}`);
    if (!scoreRaw) continue;
    const score = JSON.parse(scoreRaw);

    if (Array.isArray(score.flags) && score.flags.length > 0) continue;
    if (specialty && !matchSpecialty(specialty, provider.specialties || [])) continue;
    if (tier && provider.tier !== tier) continue;
    if (score.happy_trail < minScore) continue;

    const price = computePrice(score.happy_trail, provider.specialties || []);
    if (maxPrice && price > Number(maxPrice)) continue;

    const verified = provider.tier === "verified_brain" || provider.tier === "founding_brain";
    if (verifiedOnly && !verified) continue;

    providers.push({
      provider_id: provider.id,
      name: provider.name,
      specialties: provider.specialties || [],
      tier: provider.tier,
      happy_trail: score.happy_trail,
      price,
      verified,
      estimated_confidence: Number((score.happy_trail / 100).toFixed(2))
    });
  }

  providers.sort((a, b) => b.happy_trail - a.happy_trail);

  return ok({
    note: "preview only — call execute",
    providers: providers.slice(0, 3)
  });
}

async function handleDocs(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const base = url.origin;

  return ok({
    name: "Happy Thoughts",
    description: "Pay-per-thought marketplace for AI agents",
    version: "1.0.0",
    endpoints: [
      { method: "POST", path: "/think", description: "Pay → route → return thought" },
      { method: "POST", path: "/register", description: "Provider registration with stake" },
      { method: "GET", path: "/discover", description: "List providers" },
      { method: "GET", path: "/route", description: "Preview top 3 providers" },
      { method: "POST", path: "/feedback", description: "Rate a thought" },
      { method: "POST", path: "/dispute", description: "Dispute a thought" },
      { method: "GET", path: "/score/{provider_id}", description: "Provider score breakdown" },
      { method: "GET", path: "/leaderboard", description: "Top providers" },
      { method: "GET", path: "/health", description: "Health check" },
      { method: "GET", path: "/legal/tos", description: "Terms of Service" },
      { method: "GET", path: "/legal/privacy", description: "Privacy Policy" },
      { method: "GET", path: "/legal/provider-agreement", description: "Provider Agreement" },
      { method: "GET", path: "/legal/aup", description: "Acceptable Use Policy" },
      { method: "GET", path: "/docs", description: "Docs summary" },
      { method: "GET", path: "/preview", description: "Sample thought preview" }
    ],
    payment: "x402 USDC via Base",
    legal: {
      tos: `${base}/legal/tos`,
      privacy: `${base}/legal/privacy`,
      provider_agreement: `${base}/legal/provider-agreement`,
      aup: `${base}/legal/aup`
    }
  });
}

async function handlePreview(): Promise<Response> {
  return ok({
    sample_thought_id: "ht_example",
    sample_specialty: "trading/signals",
    sample_price: 0.15,
    sample_response: "Example thought output",
    sample_disclaimer:
      "This thought is not investment advice. Not a solicitation to buy or sell any asset. Past performance does not guarantee future results.",
    note: "This is a preview. Call x402 payment to receive real thoughts."
  });
}

async function handleLeaderboard(request: Request, env: Env): Promise<Response> {
  const list = await env.PROVIDERS.list({ prefix: "provider:" });
  const rows: any[] = [];

  for (const key of list.keys) {
    const raw = await env.PROVIDERS.get(key.name);
    if (!raw) continue;
    const provider = JSON.parse(raw);

    const scoreRaw = await env.SCORES.get(`score:${provider.id}`);
    if (!scoreRaw) continue;
    const score = JSON.parse(scoreRaw);

    if (Array.isArray(score.flags) && score.flags.length > 0) continue;

    rows.push({ provider, score });
  }

  const toEntry = (row: any) => ({
    provider_id: row.provider.id,
    name: row.provider.name,
    tier: row.score.tier || row.provider.tier,
    happy_trail: row.score.happy_trail,
    specialties: row.provider.specialties || [],
    total_thoughts: row.score.total_thoughts || 0
  });

  const topThinkers = rows
    .slice()
    .sort((a, b) => b.score.happy_trail - a.score.happy_trail)
    .slice(0, 10)
    .map(toEntry);

  const mostProductive = rows
    .slice()
    .sort((a, b) => (b.score.total_thoughts || 0) - (a.score.total_thoughts || 0))
    .slice(0, 10)
    .map(toEntry);

  const cultClassics = rows
    .filter((r) => (r.score.reuse_rate ?? null) !== null)
    .slice()
    .sort((a, b) => (b.score.reuse_rate || 0) - (a.score.reuse_rate || 0))
    .slice(0, 10)
    .map(toEntry);

  // weekly_mover: sort by weekly_delta DESC, top 10
  const weeklyMover = rows
    .filter(({ score }) => score.weekly_delta > 0)
    .sort((a, b) => b.score.weekly_delta - a.score.weekly_delta)
    .slice(0, 10)
    .map(({ provider, score }) => ({
      provider_id: provider.id,
      name: provider.name,
      weekly_delta: score.weekly_delta,
      happy_trail: score.happy_trail,
      tier: score.tier
    }));

  // rising_stars: registered within 30 days, sort by happy_trail DESC, top 10
  const thirtyDaysAgo = Date.now() - 30 * 24 * 3600 * 1000;
  const risingStars = rows
    .filter(({ score }) => score.created_at >= thirtyDaysAgo && !score.hidden)
    .sort((a, b) => b.score.happy_trail - a.score.happy_trail)
    .slice(0, 10)
    .map(({ provider, score }) => ({
      provider_id: provider.id,
      name: provider.name,
      happy_trail: score.happy_trail,
      tier: score.tier,
      days_old: Math.floor((Date.now() - score.created_at) / 86_400_000)
    }));

  return ok({
    updated_at: new Date().toISOString(),
    boards: {
      top_thinkers: topThinkers,
      most_productive: mostProductive,
      cult_classics: cultClassics,
      weekly_mover: weeklyMover,
      rising_stars: risingStars
    }
  });
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const payment = await verifyX402Payment(request, env, 0.25, "Happy Thoughts registration");
  if (!payment.ok) return payment.response;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const name = normalizeOptionalString(body?.name, 80);
  const description = normalizeOptionalString(body?.description, 500);
  const payout_wallet = normalizeOptionalString(body?.payout_wallet, 64);
  const specialties = normalizeSpecialties(body?.specialties);
  const tags = normalizeTags(body?.tags);
  const sample_outputs = normalizeSampleOutputs(body?.sample_outputs);
  const requestedSlug = normalizeOptionalString(body?.slug, 64);
  const referral_code = normalizeOptionalString(body?.referral_code, 64);
  const callback_url_raw = normalizeOptionalString(body?.callback_url, 500);
  const avatar_url_raw = normalizeOptionalString(body?.avatar_url, 500);
  const website_url_raw = normalizeOptionalString(body?.website_url, 500);
  const x_handle = normalizeHandle(body?.x_handle || body?.social_handle);
  const provider_kind = normalizeProviderKind(body?.bot_type || body?.provider_kind);
  const model = normalizeOptionalString(body?.model, 100);
  const agent_framework = normalizeOptionalString(body?.agent_framework, 100);
  const runtime = normalizeRuntime(body?.runtime);
  const delivery_mode = normalizeDeliveryMode(body?.delivery_mode);
  const human_in_loop = Boolean(body?.human_in_loop);
  const accepts_tos = Boolean(body?.accept_tos);
  const accepts_privacy = Boolean(body?.accept_privacy);
  const accepts_provider_agreement = Boolean(body?.accept_provider_agreement);
  const accepts_aup = Boolean(body?.accept_aup);

  if (!name || !description || specialties.length === 0 || !payout_wallet) {
    return badRequest("missing required fields", {
      required: ["name", "description", "specialties[]", "payout_wallet"]
    });
  }

  if (!isValidWallet(payout_wallet)) {
    return badRequest("invalid payout_wallet", { payout_wallet });
  }

  const invalid = validateSpecialties(specialties);
  if (invalid.length > 0) {
    return badRequest("unknown specialties", { invalid, allowed: Array.from(SPECIALTY_LEAVES) });
  }

  if (!accepts_tos || !accepts_privacy || !accepts_provider_agreement || !accepts_aup) {
    return badRequest("missing required agreement acceptance", {
      required: ["accept_tos", "accept_privacy", "accept_provider_agreement", "accept_aup"]
    });
  }

  let callback_url: string | null = null;
  let avatar_url: string | null = null;
  let website_url: string | null = null;
  try {
    callback_url = validateCallbackUrl(callback_url_raw);
    avatar_url = validatePublicUrl(avatar_url_raw, "avatar_url");
    website_url = validatePublicUrl(website_url_raw, "website_url");
  } catch (err: any) {
    return badRequest(err?.message || "invalid URL field");
  }

  if (delivery_mode === "webhook" && !callback_url) {
    return badRequest("callback_url is required when delivery_mode=webhook");
  }

  const existingWalletProvider = await findProviderByPayoutWallet(payout_wallet, env);
  if (existingWalletProvider && existingWalletProvider.status !== "forfeited") {
    return badRequest("payout_wallet already has an active provider registration", {
      payout_wallet,
      provider_id: existingWalletProvider.id,
      status: existingWalletProvider.status || "active"
    });
  }

  const slug = requestedSlug ? slugify(requestedSlug) : slugify(name);
  if (requestedSlug && !slug) {
    return badRequest("invalid slug");
  }

  const provider_id = await buildProviderId(slug || null, name, env);
  const timestamp = new Date().toISOString();
  const agreementVersions = {
    tos: "1.0",
    privacy: "1.0",
    provider_agreement: "1.0",
    aup: "1.0"
  };
  const providerToken = delivery_mode === "hosted" ? generateProviderToken() : null;
  const providerTokenHash = providerToken ? await hashProviderToken(providerToken) : null;

  const providerRecord = {
    id: provider_id,
    slug: slug || provider_id,
    name,
    description,
    specialties,
    tags,
    sample_outputs,
    payout_wallet,
    callback_url,
    referral_code,
    human_in_loop,
    provider_kind,
    bot_type: provider_kind,
    avatar_url,
    website_url,
    x_handle,
    model,
    agent_framework,
    runtime,
    delivery_mode,
    provider_token_hash: providerTokenHash,
    provider_token_created_at: providerToken ? timestamp : null,
    delivery_status: delivery_mode === "hosted" ? "ready" : "pending_setup",
    last_provider_poll_at: null,
    last_provider_response_at: null,
    status: "active",
    registration_mode: "single_provider_per_payout_wallet",
    registered_wallet: payment.payer,
    tier: "thinker",
    created_at: timestamp,
    updated_at: timestamp
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
    flags: [] as string[],
    created_at: Date.now(),
    registration_status: "active"
  };

  const agreementRecord = {
    wallet: payment.payer,
    provider_id,
    payout_wallet,
    agreed_at: timestamp,
    accept_tos: true,
    accept_privacy: true,
    accept_provider_agreement: true,
    accept_aup: true,
    agreement_versions: agreementVersions,
    request_meta: {
      user_agent: request.headers.get("user-agent") || null,
      cf_connecting_ip: request.headers.get("cf-connecting-ip") || null,
      x_forwarded_for: request.headers.get("x-forwarded-for") || null
    }
  };

  const stakeRecord = {
    provider_id,
    payer_wallet: payment.payer,
    payout_wallet,
    amount: 0.25,
    status: "paid",
    paid_at: timestamp,
    stake_type: "registration",
    forfeited: false
  };

  await env.PROVIDERS.put(`provider:${provider_id}`, JSON.stringify(providerRecord));
  if (providerTokenHash) {
    await env.PROVIDERS.put(`provider-token:${providerTokenHash}`, provider_id);
  }
  await env.SCORES.put(`score:${provider_id}`, JSON.stringify(scoreRecord));
  await env.AGREEMENTS.put(`agreement:${provider_id}`, JSON.stringify(agreementRecord));
  await env.AGREEMENTS.put(`agreement-wallet:${payment.payer}`, JSON.stringify(agreementRecord));
  await env.AGREEMENTS.put(`stake:${provider_id}`, JSON.stringify(stakeRecord));

  if (referral_code) {
    const referralKey = `referral:${referral_code}`;
    const existingRaw = await env.REFERRALS.get(referralKey);
    const referralRecord = existingRaw
      ? JSON.parse(existingRaw)
      : {
          referral_code,
          referrals: [],
          total_referred: 0,
          created_at: timestamp
        };
    referralRecord.referrals.push({
      provider_id,
      payout_wallet,
      registered_wallet: payment.payer,
      referred_at: timestamp
    });
    referralRecord.total_referred = referralRecord.referrals.length;
    await env.REFERRALS.put(referralKey, JSON.stringify(referralRecord));

    const score = await loadScore(provider_id, env);
    if (score && score.quality < 50) {
      score.quality = 50;
      score.happy_trail = round2(score.quality * 0.5 + score.reliability * 0.3 + score.trust * 0.2);
      await saveScore(score, env);
      console.log(`[REFERRAL] ${provider_id} referred by ${referral_code} — score bumped to 50`);
    }
  }

  return jsonResponse(
    {
      provider_id,
      slug: providerRecord.slug,
      status: providerRecord.status,
      delivery_mode,
      delivery_status: providerRecord.delivery_status,
      happy_trail: 45,
      tier: "thinker",
      specialties,
      provider_kind,
      provider_token: providerToken,
      provider_api_base: delivery_mode === "hosted" ? `${new URL(request.url).origin}/provider` : null,
      next_step:
        delivery_mode === "hosted"
          ? "Poll /provider/jobs/next to receive routed thoughts."
          : "Your provider is configured for pushed delivery.",
      payload: {
        x_handle,
        avatar_url,
        website_url,
        tags,
        sample_outputs
      }
    },
    201
  );
}

async function handleProviderMe(request: Request, env: Env): Promise<Response> {
  const provider = await getProviderByToken(request, env);
  if (!provider) return unauthorized();

  const score = await loadScore(provider.id, env);
  const jobs = await env.THOUGHTS.list({ prefix: `provider-job:${provider.id}:` });
  let queued_jobs = 0;
  let leased_jobs = 0;
  for (const key of jobs.keys) {
    const raw = await env.THOUGHTS.get(key.name);
    if (!raw) continue;
    const job = JSON.parse(raw);
    if (job.status === "queued") queued_jobs += 1;
    if (job.status === "leased") leased_jobs += 1;
  }

  return ok({
    provider_id: provider.id,
    slug: provider.slug || provider.id,
    name: provider.name,
    status: provider.status || "active",
    delivery_mode: provider.delivery_mode || "hosted",
    delivery_status: provider.delivery_status || "ready",
    specialties: provider.specialties || [],
    happy_trail: score?.happy_trail ?? null,
    tier: score?.tier || provider.tier,
    last_provider_poll_at: provider.last_provider_poll_at ?? null,
    last_provider_response_at: provider.last_provider_response_at ?? null,
    provider_token_created_at: provider.provider_token_created_at ?? null,
    jobs: {
      queued: queued_jobs,
      leased: leased_jobs
    },
    next_actions:
      (provider.delivery_status || "ready") === "paused"
        ? ["POST /provider/control/resume to resume routing", "GET /provider/jobs/next to check for work once resumed"]
        : ["GET /provider/jobs/next to poll for work", "POST /provider/token/rotate to rotate token if needed"]
  });
}

async function handleProviderJobsNext(request: Request, env: Env): Promise<Response> {
  const provider = await getProviderByToken(request, env);
  if (!provider) return unauthorized();

  if ((provider.delivery_status || "ready") === "paused") {
    return ok({ job: null, retry_after_ms: 10000, status: "paused" });
  }

  provider.last_provider_poll_at = new Date().toISOString();
  await persistProvider(env, provider);

  const list = await env.THOUGHTS.list({ prefix: `provider-job:${provider.id}:` });
  let selectedJob: any = null;
  for (const key of list.keys) {
    const raw = await env.THOUGHTS.get(key.name);
    if (!raw) continue;
    const job = JSON.parse(raw);
    if (job.status === "queued") {
      selectedJob = job;
      break;
    }
  }

  if (!selectedJob) {
    return ok({ job: null, retry_after_ms: 3000 });
  }

  const now = Date.now();
  selectedJob.status = "leased";
  selectedJob.leased_to = provider.id;
  selectedJob.leased_at = new Date(now).toISOString();
  selectedJob.lease_expires_at = new Date(now + 20_000).toISOString();
  await env.THOUGHTS.put(`provider-job:${provider.id}:${selectedJob.job_id}`, JSON.stringify(selectedJob));

  return ok({ job: selectedJob });
}

async function handleProviderJobRespond(request: Request, env: Env, jobId: string): Promise<Response> {
  const provider = await getProviderByToken(request, env);
  if (!provider) return unauthorized();

  const key = `provider-job:${provider.id}:${jobId}`;
  const raw = await env.THOUGHTS.get(key);
  if (!raw) return notFound();

  const job = JSON.parse(raw);
  if (job.leased_to !== provider.id && job.provider_id !== provider.id) {
    return unauthorized("job does not belong to this provider");
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const thought = typeof body?.thought === "string" ? body.thought.trim() : "";
  const confidence = body?.confidence == null ? null : Number(body.confidence);
  if (!thought) return badRequest("thought is required");
  if (confidence != null && (Number.isNaN(confidence) || confidence < 0 || confidence > 1)) {
    return badRequest("confidence must be between 0.0 and 1.0");
  }

  job.status = "completed";
  job.responded_at = new Date().toISOString();
  job.response = {
    thought,
    confidence,
    meta: body?.meta ?? null
  };
  await env.THOUGHTS.put(key, JSON.stringify(job));

  provider.last_provider_response_at = new Date().toISOString();
  await persistProvider(env, provider);

  return ok({ status: "accepted", job_id: jobId, thought_id: job.thought_id ?? null });
}

async function handleProviderJobFail(request: Request, env: Env, jobId: string): Promise<Response> {
  const provider = await getProviderByToken(request, env);
  if (!provider) return unauthorized();

  const key = `provider-job:${provider.id}:${jobId}`;
  const raw = await env.THOUGHTS.get(key);
  if (!raw) return notFound();

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const job = JSON.parse(raw);
  job.status = "failed";
  job.failed_at = new Date().toISOString();
  job.fail_reason = normalizeOptionalString(body?.reason, 80) || "provider_failed";
  job.fail_message = normalizeOptionalString(body?.message, 280);
  await env.THOUGHTS.put(key, JSON.stringify(job));

  return ok({ status: "released", job_id: jobId });
}

async function handleProviderTokenRotate(request: Request, env: Env): Promise<Response> {
  const provider = await getProviderByToken(request, env);
  if (!provider) return unauthorized();

  const previousHash = provider.provider_token_hash || null;
  const providerToken = generateProviderToken();
  provider.provider_token_hash = await hashProviderToken(providerToken);
  provider.provider_token_created_at = new Date().toISOString();
  await persistProvider(env, provider);
  await env.PROVIDERS.put(`provider-token:${provider.provider_token_hash}`, provider.id);
  if (previousHash && previousHash !== provider.provider_token_hash) {
    await env.PROVIDERS.delete(`provider-token:${previousHash}`);
  }

  return ok({ status: "rotated", provider_token: providerToken, next_step: "Use the new bearer token for all /provider calls." });
}

async function handleProviderControl(request: Request, env: Env, action: string): Promise<Response> {
  const provider = await getProviderByToken(request, env);
  if (!provider) return unauthorized();

  switch (action) {
    case "pause":
      provider.delivery_status = "paused";
      await persistProvider(env, provider);
      return ok({ status: "paused", provider_id: provider.id, delivery_status: provider.delivery_status });
    case "resume":
      provider.delivery_status = "ready";
      await persistProvider(env, provider);
      return ok({ status: "ready", provider_id: provider.id, delivery_status: provider.delivery_status });
    case "revoke-token": {
      const previousHash = provider.provider_token_hash || null;
      provider.provider_token_hash = null;
      provider.provider_token_created_at = null;
      await persistProvider(env, provider);
      if (previousHash) {
        await env.PROVIDERS.delete(`provider-token:${previousHash}`);
      }
      return ok({ status: "revoked", provider_id: provider.id, message: "Provider token revoked. Re-register or add a reissue flow before polling again." });
    }
    default:
      return badRequest("unknown provider control action");
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const routeKey = `${request.method} ${url.pathname}`;

    if (request.method === "GET" && url.pathname === "/health/providers") {
      const ids = ["pi_signals", "moby_dick", "pi_thesis", "claude_haiku"];
      const results: Record<string, any> = {};
      for (const id of ids) {
        const p = await env.PROVIDERS.get(`provider:${id}`);
        const s = await env.SCORES.get(`score:${id}`);
        results[id] = { provider: !!p, score: !!s };
      }
      return jsonResponse({ results, founding_map: Object.keys(FOUNDING_PROVIDER_MAP) });
    }

    if (request.method === "GET" && url.pathname === "/provider/me") {
      return handleProviderMe(request, env);
    }

    if (request.method === "GET" && url.pathname === "/provider/jobs/next") {
      return handleProviderJobsNext(request, env);
    }

    if (request.method === "POST" && /^\/provider\/jobs\/[^/]+\/respond$/.test(url.pathname)) {
      const jobId = url.pathname.split("/")[3];
      return handleProviderJobRespond(request, env, jobId);
    }

    if (request.method === "POST" && /^\/provider\/jobs\/[^/]+\/fail$/.test(url.pathname)) {
      const jobId = url.pathname.split("/")[3];
      return handleProviderJobFail(request, env, jobId);
    }

    if (request.method === "POST" && url.pathname === "/provider/token/rotate") {
      return handleProviderTokenRotate(request, env);
    }

    if (request.method === "POST" && /^\/provider\/control\/(pause|resume|revoke-token)$/.test(url.pathname)) {
      const action = url.pathname.split("/")[3];
      return handleProviderControl(request, env, action);
    }

    if (request.method === "GET" && url.pathname.startsWith("/score/")) {
      return handleScore(request, env);
    }

    if (request.method === "GET" && url.pathname.startsWith("/bundle/")) {
      const id = url.pathname.slice("/bundle/".length);
      return handleGetBundle(id, env);
    }

    if (request.method === "GET" && url.pathname.startsWith("/referral/")) {
      const wallet = url.pathname.slice("/referral/".length);
      return handleGetReferral(wallet, env);
    }

    if (request.method === "GET" && url.pathname === "/internal/shill-template") {
      return handleShillTemplate(request, env);
    }

    if (request.method === "GET" && url.pathname === "/llm.txt") {
      return textResponse(LLM_TXT, 200, { "Cache-Control": "public, max-age=3600" });
    }

    if (request.method === "GET" && url.pathname === "/llms-full.txt") {
      return textResponse(LLMS_FULL_TXT, 200, { "Cache-Control": "public, max-age=3600" });
    }

    if (request.method === "GET" && url.pathname === "/openapi.json") {
      return new Response(OPENAPI_JSON, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600"
        }
      });
    }

    if (request.method === "GET" && url.pathname.startsWith("/legal/")) {
      switch (url.pathname) {
        case "/legal/tos":
          return textResponse(LEGAL_TOS);
        case "/legal/privacy":
          return textResponse(LEGAL_PRIVACY);
        case "/legal/provider-agreement":
          return textResponse(LEGAL_PROVIDER_AGREEMENT);
        case "/legal/aup":
          return textResponse(LEGAL_AUP);
        default:
          return notFound();
      }
    }

    switch (routeKey) {
      case "POST /register":
        return handleRegister(request, env);
      case "POST /think":
        return handleThink(request, env);
      case "POST /feedback":
        return handleFeedback(request, env);
      case "POST /dispute":
        return handleDispute(request, env);
      case "POST /refund":
        return handleRefund(request, env);
      case "POST /bundle":
        return handleCreateBundle(request, env);
      case "POST /internal/think":
        return handleInternalThink(request, env);
      case "POST /internal/consensus":
        return handleInternalConsensus(request, env);
      case "GET /health":
        return ok({
          status: "ok",
          version: "1.0.0",
          timestamp: new Date().toISOString()
        });
      case "GET /discover":
        return handleDiscover(request, env);
      case "GET /route":
        return handleRoute(request, env);
      case "GET /leaderboard":
        return handleLeaderboard(request, env);
      case "GET /docs":
        return handleDocs(request);
      case "GET /preview":
        return handlePreview();
      default:
        return notFound();
    }
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDecay(env));
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
  OWNER_KEY?: string;
  OWNER_KEY_HEADER?: string;
  X402_FACILITATOR_URL?: string;
  X402_NETWORK?: string;
  X402_ASSET?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_BENCHMARK_MODEL?: string;
  SIGNAL_ENDPOINT_BASE?: string;
  MOBY_ENDPOINT_BASE?: string;
  CEREBRAS_API_KEY?: string;
  CEREBRAS_MODEL?: string;
  MISTRAL_API_KEY?: string;
  MISTRAL_MODEL?: string;
  GEMMA_AI_API_KEY?: string;
  GEMMA_MODEL?: string;
  GEMINI_SYNTHESIS_MODEL?: string;
}