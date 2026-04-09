import type { Env } from "./index";

type ConsensusProviderId = "cerebras" | "mistral" | "google_gemma";
type SynthesisProviderId = "google_gemini";

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
  };
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
    "You will receive a user prompt and three first-pass model answers.",
    "Your job:",
    "1. Identify the strongest points of agreement.",
    "2. Identify important disagreements or unsupported claims.",
    "3. Produce one final blended answer that is clear, useful, and honest about uncertainty.",
    "4. Prefer precision over confidence theater.",
    "Do not mention chain-of-thought.",
    "Use this exact output structure:",
    "Agreement:\n- ...",
    "Disagreements / Caveats:\n- ...",
    "Blended Answer:\n...",
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

async function callOpenAICompatible(
  url: string,
  apiKey: string,
  model: string,
  prompt: string,
  extraHeaders?: Record<string, string>
): Promise<string> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(extraHeaders || {})
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 700,
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

async function callGoogleGenerate(apiKey: string, model: string, prompt: string): Promise<string> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 900
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

export async function runConsensus(prompt: string, specialty: string, env: Env): Promise<ConsensusResult> {
  const cerebrasModel = env.CEREBRAS_MODEL || "llama3.1-8b";
  const mistralModel = env.MISTRAL_MODEL || "mistral-small-latest";
  const gemmaModel = env.GEMMA_MODEL || "gemma-4-31b-it";
  const synthesisModel = env.GEMINI_SYNTHESIS_MODEL || "gemini-2.5-flash";
  const answerPrompt = buildAnswerPrompt(prompt, specialty);

  const answers = await Promise.all([
    gatherProviderAnswer("cerebras", cerebrasModel, async () => {
      if (!env.CEREBRAS_API_KEY) throw new Error("CEREBRAS_API_KEY not configured");
      return callOpenAICompatible(
        "https://api.cerebras.ai/v1/chat/completions",
        env.CEREBRAS_API_KEY,
        cerebrasModel,
        answerPrompt
      );
    }),
    gatherProviderAnswer("mistral", mistralModel, async () => {
      if (!env.MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY not configured");
      return callOpenAICompatible(
        "https://api.mistral.ai/v1/chat/completions",
        env.MISTRAL_API_KEY,
        mistralModel,
        answerPrompt
      );
    }),
    gatherProviderAnswer("google_gemma", gemmaModel, async () => {
      if (!env.GEMMA_AI_API_KEY) throw new Error("GEMMA_AI_API_KEY not configured");
      return callGoogleGenerate(env.GEMMA_AI_API_KEY, gemmaModel, answerPrompt);
    })
  ]);

  const successfulAnswers = answers.filter((item) => item.ok && item.answer);
  if (successfulAnswers.length < 2) {
    throw new Error(
      `Consensus panel needs at least 2 successful first responses; got ${successfulAnswers.length}`
    );
  }

  if (!env.GEMMA_AI_API_KEY) {
    throw new Error("GEMMA_AI_API_KEY not configured for synthesis");
  }

  const synthesisPrompt = buildSynthesisPrompt(prompt, specialty, successfulAnswers);
  const synthesisStarted = Date.now();
  const output = await callGoogleGenerate(env.GEMMA_AI_API_KEY, synthesisModel, synthesisPrompt);
  const structured = parseSynthesisOutput(output);

  return {
    prompt,
    specialty,
    answers,
    synthesis: {
      provider: "google_gemini",
      model: synthesisModel,
      output,
      response_time_ms: Date.now() - synthesisStarted,
      structured
    }
  };
}
