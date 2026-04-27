import type { Env } from "./index";

type ConsensusProviderId = "cerebras" | "mistral" | "google_gemma";
type SynthesisProviderId = "google_gemini" | "mistral";

type PanelProviderConfig = {
  provider: ConsensusProviderId;
  model: string;
  run: () => Promise<string>;
};

type SynthesisProviderConfig = {
  provider: SynthesisProviderId;
  model: string;
  run: (
    prompt: string,
    specialty: string,
    normalized: NormalizedConsensusInput,
    failureCount: number,
    successfulCount: number
  ) => Promise<{
    provider: SynthesisProviderId;
    model: string;
    output: string;
    response_time_ms: number;
    structured: StructuredSynthesis;
  }>;
};

export type ProviderAnswer = {
  provider: ConsensusProviderId;
  model: string;
  answer: string | null;
  response_time_ms: number;
  ok: boolean;
  error?: string;
};

export type StructuredPanelAnswer = {
  thesis: string;
  key_points: string[];
  caveats: string[];
  bottom_line: string;
  raw_answer: string;
};

export type NormalizedConsensusInput = {
  shared_points: string[];
  supporting_points: string[];
  caveats: string[];
  bottom_lines: string[];
};

export type StructuredSynthesis = {
  agreement: string[];
  disagreements: string[];
  blended_answer: string;
  confidence: "low" | "medium" | "high";
  raw_output: string;
};

export type ConsensusResult = {
  prompt: string;
  specialty: string;
  answers: ProviderAnswer[];
  parsed_answers: Array<ProviderAnswer & { parsed?: StructuredPanelAnswer }>;
  normalized: NormalizedConsensusInput;
  synthesis: {
    provider: SynthesisProviderId;
    model: string;
    output: string;
    response_time_ms: number;
    structured: StructuredSynthesis;
  } | null;
  degraded: boolean;
  failure_count: number;
  failed_providers: Array<{
    provider: string;
    model: string;
    error: string;
  }>;
};

export type ConsensusRuntimeConfig = {
  panel: Array<{ provider: ConsensusProviderId; model: string }>;
  synthesis: Array<{ provider: SynthesisProviderId; model: string }>;
};

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildAnswerPrompt(prompt: string, specialty: string): string {
  return [
    "You are generating one member of a three-model answer panel for Happy Thoughts.",
    "Return a structured first-pass answer using the exact headings below.",
    "Keep it concise, factual, and easy to compare across models.",
    "Do not mention other models. Do not mention that this is a panel.",
    "No markdown tables.",
    "Use this exact structure:",
    "Thesis:",
    "one short paragraph or 1-2 sentences",
    "Key Points:",
    "- 3 to 5 bullets",
    "Caveats:",
    "- 1 to 3 bullets (use '- None material.' if needed)",
    "Bottom Line:",
    "1 short paragraph",
    `Specialty: ${specialty}`,
    `User prompt: ${prompt}`
  ].join("\n\n");
}

function parseBullets(section: string): string[] {
  return section
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_#:[\](){}"“”'’.,!?/\\-]+/g, " ")
    .replace(/\b(the|a|an|and|or|that|this|with|for|from|into|onto|your|their|they|them|have|has|had|will|would|should|could|about|because|while|than|then|just|very|more|most)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(normalizeText(text).split(" ").filter((token) => token.length >= 4));
}

function jaccardSimilarity(a: string, b: string): number {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersection = 0;
  for (const token of sa) if (sb.has(token)) intersection++;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : intersection / union;
}

function firstSentence(text: string, maxLen = 220): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen).trim()}…`;
}

function parsePanelAnswer(output: string): StructuredPanelAnswer {
  const normalized = output.replace(/\r\n/g, "\n").trim();
  const thesisMatch = normalized.match(/Thesis:\s*([\s\S]*?)(?:\n\s*Key Points:|$)/i);
  const keyPointsMatch = normalized.match(/Key Points:\s*([\s\S]*?)(?:\n\s*Caveats:|$)/i);
  const caveatsMatch = normalized.match(/Caveats:\s*([\s\S]*?)(?:\n\s*Bottom Line:|$)/i);
  const bottomLineMatch = normalized.match(/Bottom Line:\s*([\s\S]*?)$/i);

  const thesis = trimText(thesisMatch?.[1]);
  const key_points = keyPointsMatch ? parseBullets(keyPointsMatch[1]).slice(0, 5) : [];
  const caveats = caveatsMatch ? parseBullets(caveatsMatch[1]).slice(0, 3) : [];
  const bottom_line = trimText(bottomLineMatch?.[1]);

  if (!thesis || key_points.length === 0 || !bottom_line) {
    throw new Error("panel answer missing required sections");
  }

  return {
    thesis,
    key_points,
    caveats: caveats.length ? caveats : ["None material."],
    bottom_line,
    raw_answer: normalized
  };
}

function buildSynthesisPrompt(prompt: string, specialty: string, normalized: NormalizedConsensusInput): string {
  const section = (title: string, bullets: string[]) => [title, ...(bullets.length ? bullets.map((b) => `- ${b}`) : ["- None material."])].join("\n");

  return [
    "You are the final synthesis and fact-check layer for Happy Thoughts.",
    "Real humans will read this answer. It must sound clean, useful, and deliberate.",
    "You are receiving normalized points distilled from multiple model answers.",
    "Do not rehash everything. Produce a sharp final answer from the distilled inputs.",
    "Use this exact output structure:",
    "Agreement:",
    "- at least 1 bullet",
    "Disagreements / Caveats:",
    "- at least 1 bullet (use 'None material.' if needed)",
    "Blended Answer:",
    "Write 1-3 full paragraphs in natural language.",
    "Confidence: low|medium|high",
    `Specialty: ${specialty}`,
    `User prompt: ${prompt}`,
    section("Shared Points:", normalized.shared_points),
    section("Supporting Points:", normalized.supporting_points),
    section("Caveats:", normalized.caveats),
    section("Bottom Lines:", normalized.bottom_lines)
  ].join("\n\n");
}

export function parseSynthesisOutput(output: string): StructuredSynthesis {
  const normalized = output.replace(/\r\n/g, "\n").trim();
  const agreementMatch = normalized.match(/Agreement:\s*([\s\S]*?)(?:\n\s*Disagreements\s*\/\s*Caveats:|\n\s*Blended Answer:|$)/i);
  const disagreementsMatch = normalized.match(/Disagreements\s*\/\s*Caveats:\s*([\s\S]*?)(?:\n\s*Blended Answer:|\n\s*Confidence:|$)/i);
  const blendedMatch = normalized.match(/Blended Answer:\s*([\s\S]*?)(?:\n\s*Confidence:|$)/i);
  const confidenceMatch = normalized.match(/Confidence:\s*(low|medium|high)/i);

  const agreement = agreementMatch ? parseBullets(agreementMatch[1]) : [];
  const disagreements = disagreementsMatch ? parseBullets(disagreementsMatch[1]) : [];
  const blended_answer = trimText(blendedMatch?.[1]) || normalized;
  const confidence = (confidenceMatch?.[1]?.toLowerCase() as "low" | "medium" | "high") || "medium";

  return {
    agreement,
    disagreements,
    blended_answer,
    confidence,
    raw_output: normalized
  };
}

function isStructuredSynthesisUsable(structured: StructuredSynthesis): boolean {
  if (structured.agreement.length === 0) return false;
  if (!structured.blended_answer) return false;
  if (/^Agreement:/i.test(structured.blended_answer)) return false;
  if (structured.blended_answer.length < 160) return false;
  return true;
}

async function callOpenAICompatible(
  url: string,
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens = 700
): Promise<string> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`${resp.status} ${text.slice(0, 300)}`);
  const json: any = JSON.parse(text);
  const answer = trimText(json?.choices?.[0]?.message?.content);
  if (!answer) throw new Error("empty model response");
  return answer;
}

async function callGoogleGenerate(apiKey: string, model: string, prompt: string, maxOutputTokens = 900): Promise<string> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens
        }
      })
    }
  );

  const text = await resp.text();
  if (!resp.ok) throw new Error(`${resp.status} ${text.slice(0, 300)}`);
  const json: any = JSON.parse(text);
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) throw new Error("missing candidate parts");
  const answer = parts
    .filter((part: any) => !part?.thought)
    .map((part: any) => trimText(part?.text))
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!answer) throw new Error("empty model response");
  return answer;
}

async function gatherProviderAnswer(
  provider: ConsensusProviderId,
  model: string,
  runner: () => Promise<string>
): Promise<ProviderAnswer> {
  const started = Date.now();
  try {
    const answer = await runner();
    return { provider, model, answer, response_time_ms: Date.now() - started, ok: true };
  } catch (err: any) {
    return {
      provider,
      model,
      answer: null,
      response_time_ms: Date.now() - started,
      ok: false,
      error: err?.message || String(err)
    };
  }
}

function computeDegradedConfidence(successfulCount: number, failureCount: number): "low" | "medium" | "high" {
  if (failureCount === 0 && successfulCount >= 3) return "high";
  if (failureCount === 1 && successfulCount >= 2) return "medium";
  return "low";
}

function normalizeStructuredConfidence(
  structured: StructuredSynthesis,
  successfulCount: number,
  failureCount: number,
  synthFailed: boolean
): StructuredSynthesis {
  const maxConfidence = synthFailed
    ? computeDegradedConfidence(successfulCount, Math.max(1, failureCount))
    : computeDegradedConfidence(successfulCount, failureCount);
  const rank = { low: 0, medium: 1, high: 2 } as const;
  const chosen = rank[structured.confidence] > rank[maxConfidence] ? maxConfidence : structured.confidence;
  return { ...structured, confidence: chosen };
}

function normalizeConsensusInput(parsedAnswers: StructuredPanelAnswer[]): NormalizedConsensusInput {
  const pointGroups: Array<{ canonical: string; variants: string[]; count: number }> = [];
  const caveatGroups: Array<{ canonical: string; variants: string[]; count: number }> = [];

  const addGrouped = (groups: Array<{ canonical: string; variants: string[]; count: number }>, text: string) => {
    for (const group of groups) {
      if (jaccardSimilarity(group.canonical, text) >= 0.35) {
        group.variants.push(text);
        group.count += 1;
        return;
      }
    }
    groups.push({ canonical: text, variants: [text], count: 1 });
  };

  for (const answer of parsedAnswers) {
    answer.key_points.forEach((point) => addGrouped(pointGroups, point));
    answer.caveats.forEach((point) => addGrouped(caveatGroups, point));
  }

  const shared_points = pointGroups.filter((g) => g.count >= 2).map((g) => firstSentence(g.variants[0]));
  const supporting_points = pointGroups.filter((g) => g.count === 1).map((g) => firstSentence(g.variants[0])).slice(0, 4);
  const caveats = caveatGroups.map((g) => firstSentence(g.variants[0])).slice(0, 4);
  const bottom_lines = parsedAnswers.map((answer) => firstSentence(answer.bottom_line, 180)).slice(0, 3);

  return {
    shared_points: shared_points.length ? shared_points : parsedAnswers.map((answer) => firstSentence(answer.thesis, 180)).slice(0, 3),
    supporting_points,
    caveats: caveats.length ? caveats : ["None material."],
    bottom_lines
  };
}

function buildHumanFallback(prompt: string, specialty: string, normalized: NormalizedConsensusInput, synthFailures: Array<{ provider: string; model: string; error: string }>): StructuredSynthesis {
  const agreement = normalized.shared_points.length ? normalized.shared_points : normalized.bottom_lines;
  const disagreements = synthFailures.length
    ? synthFailures.map((item) => `${item.provider} synthesis step failed: ${item.error}`)
    : normalized.caveats;

  const answerParts = [
    "Here’s the best available answer right now.",
    normalized.shared_points.length
      ? `The strongest consistent points across the panel were: ${normalized.shared_points.join("; ")}.`
      : `The panel surfaced these useful directions: ${normalized.bottom_lines.join("; ")}.`,
    normalized.caveats.length && normalized.caveats[0] !== "None material."
      ? `Main caveats: ${normalized.caveats.join("; ")}.`
      : "This answer should still be treated as lower-confidence because the final synthesis layer did not complete cleanly."
  ];

  const blended_answer = answerParts.join(" ");

  return {
    agreement,
    disagreements,
    blended_answer,
    confidence: computeDegradedConfidence(agreement.length ? 2 : 1, Math.max(1, synthFailures.length)),
    raw_output: blended_answer
  };
}

async function tryGoogleSynthesis(
  prompt: string,
  specialty: string,
  normalized: NormalizedConsensusInput,
  env: Env,
  synthesisModel: string,
  failureCount: number,
  successfulCount: number
) {
  if (!env.GEMMA_AI_API_KEY) throw new Error("GEMMA_AI_API_KEY not configured for synthesis");
  const synthesisPrompt = buildSynthesisPrompt(prompt, specialty, normalized);
  const started = Date.now();
  const output = await callGoogleGenerate(env.GEMMA_AI_API_KEY, synthesisModel, synthesisPrompt, 1000);
  let structured = parseSynthesisOutput(output);
  if (!isStructuredSynthesisUsable(structured)) throw new Error("synthesis output incomplete or malformed");
  structured = normalizeStructuredConfidence(structured, successfulCount, failureCount, false);
  return { provider: "google_gemini" as const, model: synthesisModel, output, response_time_ms: Date.now() - started, structured };
}

async function tryMistralSynthesis(
  prompt: string,
  specialty: string,
  normalized: NormalizedConsensusInput,
  env: Env,
  synthesisModel: string,
  failureCount: number,
  successfulCount: number
) {
  if (!env.MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY not configured for fallback synthesis");
  const synthesisPrompt = buildSynthesisPrompt(prompt, specialty, normalized);
  const started = Date.now();
  const output = await callOpenAICompatible("https://api.mistral.ai/v1/chat/completions", env.MISTRAL_API_KEY, synthesisModel, synthesisPrompt, 1000);
  let structured = parseSynthesisOutput(output);
  if (!isStructuredSynthesisUsable(structured)) throw new Error("fallback synthesis output incomplete or malformed");
  structured = normalizeStructuredConfidence(structured, successfulCount, failureCount, false);
  return { provider: "mistral" as const, model: synthesisModel, output, response_time_ms: Date.now() - started, structured };
}

export function getConsensusRuntimeConfig(env: Env): ConsensusRuntimeConfig {
  const cerebrasModel = env.CEREBRAS_MODEL || "llama3.1-8b";
  const mistralModel = env.MISTRAL_MODEL || "mistral-small-latest";
  const gemmaModel = env.GEMMA_MODEL || "gemma-4-31b-it";
  const googleSynthesisModel = env.GEMINI_SYNTHESIS_MODEL || "gemini-2.5-flash";
  const mistralSynthesisModel = env.MISTRAL_SYNTHESIS_MODEL || mistralModel;

  return {
    panel: [
      { provider: "cerebras", model: cerebrasModel },
      { provider: "mistral", model: mistralModel },
      { provider: "google_gemma", model: gemmaModel }
    ],
    synthesis: [
      { provider: "google_gemini", model: googleSynthesisModel },
      { provider: "mistral", model: mistralSynthesisModel }
    ]
  };
}

function buildPanelProviders(answerPrompt: string, env: Env, config: ConsensusRuntimeConfig): PanelProviderConfig[] {
  const runners: Record<ConsensusProviderId, () => Promise<string>> = {
    cerebras: async () => {
      if (!env.CEREBRAS_API_KEY) throw new Error("CEREBRAS_API_KEY not configured");
      const model = config.panel.find((item) => item.provider === "cerebras")?.model || env.CEREBRAS_MODEL || "llama3.1-8b";
      return callOpenAICompatible("https://api.cerebras.ai/v1/chat/completions", env.CEREBRAS_API_KEY, model, answerPrompt, 700);
    },
    mistral: async () => {
      if (!env.MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY not configured");
      const model = config.panel.find((item) => item.provider === "mistral")?.model || env.MISTRAL_MODEL || "mistral-small-latest";
      return callOpenAICompatible("https://api.mistral.ai/v1/chat/completions", env.MISTRAL_API_KEY, model, answerPrompt, 700);
    },
    google_gemma: async () => {
      if (!env.GEMMA_AI_API_KEY) throw new Error("GEMMA_AI_API_KEY not configured");
      const model = config.panel.find((item) => item.provider === "google_gemma")?.model || env.GEMMA_MODEL || "gemma-4-31b-it";
      return callGoogleGenerate(env.GEMMA_AI_API_KEY, model, answerPrompt, 900);
    }
  };

  return config.panel.map((item) => ({ provider: item.provider, model: item.model, run: runners[item.provider] }));
}

function buildSynthesisProviders(env: Env, config: ConsensusRuntimeConfig): SynthesisProviderConfig[] {
  const runners: Record<SynthesisProviderId, SynthesisProviderConfig["run"]> = {
    google_gemini: (prompt, specialty, normalized, failureCount, successfulCount) => {
      const model = config.synthesis.find((item) => item.provider === "google_gemini")?.model || env.GEMINI_SYNTHESIS_MODEL || "gemini-2.5-flash";
      return tryGoogleSynthesis(prompt, specialty, normalized, env, model, failureCount, successfulCount);
    },
    mistral: (prompt, specialty, normalized, failureCount, successfulCount) => {
      const model = config.synthesis.find((item) => item.provider === "mistral")?.model || env.MISTRAL_SYNTHESIS_MODEL || env.MISTRAL_MODEL || "mistral-small-latest";
      return tryMistralSynthesis(prompt, specialty, normalized, env, model, failureCount, successfulCount);
    }
  };

  return config.synthesis.map((item) => ({ provider: item.provider, model: item.model, run: runners[item.provider] }));
}

export async function runConsensus(prompt: string, specialty: string, env: Env): Promise<ConsensusResult> {
  const config = getConsensusRuntimeConfig(env);
  const answerPrompt = buildAnswerPrompt(prompt, specialty);

  const answers = await Promise.all(
    buildPanelProviders(answerPrompt, env, config).map((item) =>
      gatherProviderAnswer(item.provider, item.model, item.run)
    )
  );

  const successfulAnswers = answers.filter((item) => item.ok && item.answer);
  const failedProviders: ConsensusResult["failed_providers"] = answers
    .filter((item) => !item.ok)
    .map((item) => ({ provider: item.provider, model: item.model, error: item.error || "unknown error" }));

  if (successfulAnswers.length === 0) throw new Error("Consensus panel failed: no successful first responses");

  const parsed_answers: Array<ProviderAnswer & { parsed?: StructuredPanelAnswer }> = [];
  for (const item of successfulAnswers) {
    try {
      parsed_answers.push({ ...item, parsed: parsePanelAnswer(item.answer || "") });
    } catch (err: any) {
      const error = `panel parse failed: ${err?.message || String(err)}`;
      item.ok = false;
      item.error = error;
      failedProviders.push({ provider: item.provider, model: item.model, error });
    }
  }

  if (parsed_answers.length === 0) throw new Error("Consensus panel failed: no parseable first responses");

  const parsedPanelAnswers = parsed_answers.map((item) => item.parsed!).filter(Boolean);
  const normalized = normalizeConsensusInput(parsedPanelAnswers);

  if (parsed_answers.length === 1) {
    return {
      prompt,
      specialty,
      answers,
      parsed_answers,
      normalized,
      synthesis: null,
      degraded: true,
      failure_count: failedProviders.length,
      failed_providers: failedProviders
    };
  }

  const synthesisFailures = [...failedProviders];

  for (const synthesisProvider of buildSynthesisProviders(env, config)) {
    try {
      const synthesis = await synthesisProvider.run(
        prompt,
        specialty,
        normalized,
        synthesisFailures.length,
        parsed_answers.length
      );

      if (synthesisProvider.provider === "mistral") {
        synthesis.structured = normalizeStructuredConfidence(
          synthesis.structured,
          parsed_answers.length,
          synthesisFailures.length,
          true
        );
      }

      return {
        prompt,
        specialty,
        answers,
        parsed_answers,
        normalized,
        synthesis,
        degraded: synthesisFailures.length > 0,
        failure_count: synthesisFailures.length,
        failed_providers: synthesisFailures
      };
    } catch (err: any) {
      synthesisFailures.push({
        provider: synthesisProvider.provider,
        model: synthesisProvider.model,
        error: err?.message || String(err)
      });
    }
  }

  const fallbackModel = config.synthesis[config.synthesis.length - 1]?.model || env.MISTRAL_SYNTHESIS_MODEL || env.MISTRAL_MODEL || "mistral-small-latest";
  const structured = buildHumanFallback(prompt, specialty, normalized, synthesisFailures);
  return {
    prompt,
    specialty,
    answers,
    parsed_answers,
    normalized,
    synthesis: {
      provider: "mistral",
      model: fallbackModel,
      output: structured.raw_output,
      response_time_ms: 0,
      structured
    },
    degraded: true,
    failure_count: synthesisFailures.length,
    failed_providers: synthesisFailures
  };
}
