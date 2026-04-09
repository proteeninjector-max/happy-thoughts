import type { Env } from "./index";

type ConsensusProviderId = "cerebras" | "mistral" | "google_gemma";
type SynthesisProviderId = "google_gemini" | "mistral";

export type ProviderAnswer = {
  provider: ConsensusProviderId;
  model: string;
  answer: string | null;
  response_time_ms: number;
  ok: boolean;
  error?: string;
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

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildAnswerPrompt(prompt: string, specialty: string): string {
  return [
    "You are generating one member of a three-model answer panel for Happy Thoughts.",
    "Answer the user directly and use strong reasoning, but do not mention other models or that this is a panel.",
    "Be concise, factual, and useful. If uncertainty matters, say so plainly.",
    "No markdown tables.",
    `Specialty: ${specialty}`,
    `User prompt: ${prompt}`
  ].join("\n\n");
}

function buildSynthesisPrompt(prompt: string, specialty: string, answers: ProviderAnswer[]): string {
  const renderedAnswers = answers
    .map(
      (item, index) =>
        [`Answer ${index + 1}`, `Provider: ${item.provider}`, `Model: ${item.model}`, item.answer || "(empty)"]
          .join("\n")
    )
    .join("\n\n---\n\n");

  return [
    "You are the final synthesis and fact-check layer for Happy Thoughts.",
    "Real humans will read this answer. It must sound clean, helpful, and deliberate.",
    "You will receive a user prompt and multiple first-pass model answers.",
    "Your job:",
    "1. Identify the strongest points of agreement.",
    "2. Identify meaningful disagreements, weak claims, or unsupported leaps.",
    "3. Produce one final blended answer that is clear, useful, and honest about uncertainty.",
    "4. Prefer precision over confidence theater.",
    "5. The blended answer must be a complete standalone response, not a fragment.",
    "Do not mention chain-of-thought.",
    "Do not sound robotic or like debug output.",
    "Complete every section.",
    "Use this exact output structure:",
    "Agreement:",
    "- at least 1 bullet",
    "Disagreements / Caveats:",
    "- at least 1 bullet (use 'None material.' if there are no important disagreements)",
    "Blended Answer:",
    "Write 1-3 full paragraphs that directly answer the user in natural language.",
    "Confidence: low|medium|high",
    `Specialty: ${specialty}`,
    `User prompt: ${prompt}`,
    "Candidate answers:",
    renderedAnswers
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
  if (!resp.ok) {
    throw new Error(`${resp.status} ${text.slice(0, 300)}`);
  }

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
  if (!resp.ok) {
    throw new Error(`${resp.status} ${text.slice(0, 300)}`);
  }

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
    return {
      provider,
      model,
      answer,
      response_time_ms: Date.now() - started,
      ok: true
    };
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

function cleanSentence(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildHumanFallback(prompt: string, specialty: string, answers: ProviderAnswer[], synthFailures: Array<{ provider: string; model: string; error: string }>): StructuredSynthesis {
  const successful = answers.filter((item) => item.ok && item.answer);
  const failureCount = synthFailures.length;

  const agreement = successful.length
    ? successful.map((item) => `${item.provider} produced a usable first-pass answer.`)
    : ["No usable provider answers were available."];

  const disagreements = synthFailures.length
    ? synthFailures.map((item) => `${item.provider} synthesis step failed: ${item.error}`)
    : ["None material."];

  const summaryBullets = successful
    .map((item) => {
      const condensed = cleanSentence(item.answer || "").slice(0, 220);
      return `- ${condensed}${condensed.length >= 220 ? "…" : ""}`;
    })
    .join("\n");

  const blended_answer = [
    `Here’s the best clean answer available right now for this ${specialty} question.`,
    successful.length > 0
      ? `The panel produced usable first-pass responses, but the final synthesis layer did not complete cleanly. The strongest surviving points were:\n${summaryBullets}`
      : "The panel did not return any usable first-pass responses.",
    failureCount > 0
      ? "Because the final blend step failed, this answer should be read as a lower-confidence fallback rather than a polished final consensus."
      : "This answer is a fallback summary rather than a full synthesized consensus."
  ].join("\n\n");

  return {
    agreement,
    disagreements,
    blended_answer,
    confidence: computeDegradedConfidence(successful.length, Math.max(1, failureCount)),
    raw_output: blended_answer
  };
}

async function tryGoogleSynthesis(
  prompt: string,
  specialty: string,
  successfulAnswers: ProviderAnswer[],
  env: Env,
  synthesisModel: string,
  failureCount: number
) {
  if (!env.GEMMA_AI_API_KEY) {
    throw new Error("GEMMA_AI_API_KEY not configured for synthesis");
  }
  const synthesisPrompt = buildSynthesisPrompt(prompt, specialty, successfulAnswers);
  const started = Date.now();
  const output = await callGoogleGenerate(env.GEMMA_AI_API_KEY, synthesisModel, synthesisPrompt, 1200);
  let structured = parseSynthesisOutput(output);
  if (!isStructuredSynthesisUsable(structured)) {
    throw new Error("synthesis output incomplete or malformed");
  }
  structured = normalizeStructuredConfidence(structured, successfulAnswers.length, failureCount, false);
  return {
    provider: "google_gemini" as const,
    model: synthesisModel,
    output,
    response_time_ms: Date.now() - started,
    structured
  };
}

async function tryMistralSynthesis(
  prompt: string,
  specialty: string,
  successfulAnswers: ProviderAnswer[],
  env: Env,
  synthesisModel: string,
  failureCount: number
) {
  if (!env.MISTRAL_API_KEY) {
    throw new Error("MISTRAL_API_KEY not configured for fallback synthesis");
  }
  const synthesisPrompt = buildSynthesisPrompt(prompt, specialty, successfulAnswers);
  const started = Date.now();
  const output = await callOpenAICompatible(
    "https://api.mistral.ai/v1/chat/completions",
    env.MISTRAL_API_KEY,
    synthesisModel,
    synthesisPrompt,
    1000
  );
  let structured = parseSynthesisOutput(output);
  if (!isStructuredSynthesisUsable(structured)) {
    throw new Error("fallback synthesis output incomplete or malformed");
  }
  structured = normalizeStructuredConfidence(structured, successfulAnswers.length, failureCount, false);
  return {
    provider: "mistral" as const,
    model: synthesisModel,
    output,
    response_time_ms: Date.now() - started,
    structured
  };
}

export async function runConsensus(prompt: string, specialty: string, env: Env): Promise<ConsensusResult> {
  const cerebrasModel = env.CEREBRAS_MODEL || "llama3.1-8b";
  const mistralModel = env.MISTRAL_MODEL || "mistral-small-latest";
  const gemmaModel = env.GEMMA_MODEL || "gemma-4-31b-it";
  const googleSynthesisModel = env.GEMINI_SYNTHESIS_MODEL || "gemini-2.5-flash";
  const mistralSynthesisModel = env.MISTRAL_SYNTHESIS_MODEL || mistralModel;
  const answerPrompt = buildAnswerPrompt(prompt, specialty);

  const answers = await Promise.all([
    gatherProviderAnswer("cerebras", cerebrasModel, async () => {
      if (!env.CEREBRAS_API_KEY) throw new Error("CEREBRAS_API_KEY not configured");
      return callOpenAICompatible("https://api.cerebras.ai/v1/chat/completions", env.CEREBRAS_API_KEY, cerebrasModel, answerPrompt);
    }),
    gatherProviderAnswer("mistral", mistralModel, async () => {
      if (!env.MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY not configured");
      return callOpenAICompatible("https://api.mistral.ai/v1/chat/completions", env.MISTRAL_API_KEY, mistralModel, answerPrompt);
    }),
    gatherProviderAnswer("google_gemma", gemmaModel, async () => {
      if (!env.GEMMA_AI_API_KEY) throw new Error("GEMMA_AI_API_KEY not configured");
      return callGoogleGenerate(env.GEMMA_AI_API_KEY, gemmaModel, answerPrompt, 1000);
    })
  ]);

  const successfulAnswers = answers.filter((item) => item.ok && item.answer);
  const failedProviders = answers
    .filter((item) => !item.ok)
    .map((item) => ({ provider: item.provider, model: item.model, error: item.error || "unknown error" }));

  if (successfulAnswers.length === 0) {
    throw new Error("Consensus panel failed: no successful first responses");
  }

  if (successfulAnswers.length === 1) {
    const structured = buildHumanFallback(prompt, specialty, answers, failedProviders);
    return {
      prompt,
      specialty,
      answers,
      synthesis: null,
      degraded: true,
      failure_count: failedProviders.length,
      failed_providers: failedProviders
    };
  }

  const synthesisFailures = [...failedProviders];

  try {
    const google = await tryGoogleSynthesis(prompt, specialty, successfulAnswers, env, googleSynthesisModel, synthesisFailures.length);
    return {
      prompt,
      specialty,
      answers,
      synthesis: google,
      degraded: synthesisFailures.length > 0,
      failure_count: synthesisFailures.length,
      failed_providers: synthesisFailures
    };
  } catch (err: any) {
    synthesisFailures.push({ provider: "google_gemini", model: googleSynthesisModel, error: err?.message || String(err) });
  }

  try {
    const mistralSynth = await tryMistralSynthesis(prompt, specialty, successfulAnswers, env, mistralSynthesisModel, synthesisFailures.length);
    mistralSynth.structured = normalizeStructuredConfidence(
      mistralSynth.structured,
      successfulAnswers.length,
      synthesisFailures.length,
      true
    );
    return {
      prompt,
      specialty,
      answers,
      synthesis: mistralSynth,
      degraded: true,
      failure_count: synthesisFailures.length,
      failed_providers: synthesisFailures
    };
  } catch (err: any) {
    synthesisFailures.push({ provider: "mistral", model: mistralSynthesisModel, error: err?.message || String(err) });
  }

  const structured = buildHumanFallback(prompt, specialty, answers, synthesisFailures);
  return {
    prompt,
    specialty,
    answers,
    synthesis: {
      provider: "mistral",
      model: mistralSynthesisModel,
      output: structured.raw_output,
      response_time_ms: 0,
      structured
    },
    degraded: true,
    failure_count: synthesisFailures.length,
    failed_providers: synthesisFailures
  };
}
