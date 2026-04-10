import type { Env } from "../../index";
import type { DispatchRequest, DispatchResponse, InternalProviderHandler } from "../types";

const CLAUDE_HAIKU_MODEL = "claude-haiku-4-5-20251001";
const MISTRAL_MODEL = "mistral-small-latest";
const CEREBRAS_MODEL = "llama3.1-8b";
const GEMMA_MODEL = "gemma-4-31b-it";

type ModelAttempt = {
  source: string;
  model: string;
  run: () => Promise<string>;
};

function buildSystemPrompt(specialty: string): string {
  return [
    "You are Happy Thoughts' generalist fallback provider.",
    `The requested specialty is: ${specialty}.`,
    "Give a concise, helpful answer tailored to that specialty.",
    "If the prompt touches risky domains like trading, legal, medical, or finance topics, be careful, clear, and avoid fake certainty.",
    "No markdown tables. Keep the answer practical and readable for a normal human."
  ].join("\n");
}

async function callOpenAICompatible(url: string, apiKey: string, model: string, system: string, prompt: string): Promise<string> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ]
    })
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`${resp.status} ${text.slice(0, 300)}`);
  const json: any = JSON.parse(text);
  const answer = typeof json?.choices?.[0]?.message?.content === "string"
    ? json.choices[0].message.content.trim()
    : "";
  if (!answer) throw new Error("empty model response");
  return answer;
}

async function callGoogleGenerate(apiKey: string, model: string, system: string, prompt: string): Promise<string> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 700
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
    .map((part: any) => (typeof part?.text === "string" ? part.text.trim() : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!answer) throw new Error("empty model response");
  return answer;
}

async function callAnthropic(apiKey: string, model: string, system: string, prompt: string): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      system,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }]
        }
      ]
    })
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`${resp.status} ${text.slice(0, 300)}`);
  const json: any = JSON.parse(text);
  const answer =
    json?.content
      ?.map((item: any) => (typeof item?.text === "string" ? item.text : ""))
      .join("\n")
      .trim() || "";
  if (!answer) throw new Error("empty model response");
  return answer;
}

function buildAttempts(req: DispatchRequest, env: Env): ModelAttempt[] {
  const system = buildSystemPrompt(req.specialty);
  const mistralModel = env.MISTRAL_MODEL || MISTRAL_MODEL;
  const cerebrasModel = env.CEREBRAS_MODEL || CEREBRAS_MODEL;
  const gemmaModel = env.GEMMA_MODEL || GEMMA_MODEL;

  const attempts: ModelAttempt[] = [];

  if (env.MISTRAL_API_KEY) {
    attempts.push({
      source: "mistral",
      model: mistralModel,
      run: () => callOpenAICompatible("https://api.mistral.ai/v1/chat/completions", env.MISTRAL_API_KEY as string, mistralModel, system, req.prompt)
    });
  }

  if (env.CEREBRAS_API_KEY) {
    attempts.push({
      source: "cerebras",
      model: cerebrasModel,
      run: () => callOpenAICompatible("https://api.cerebras.ai/v1/chat/completions", env.CEREBRAS_API_KEY as string, cerebrasModel, system, req.prompt)
    });
  }

  if (env.GEMMA_AI_API_KEY) {
    attempts.push({
      source: "google_gemma",
      model: gemmaModel,
      run: () => callGoogleGenerate(env.GEMMA_AI_API_KEY as string, gemmaModel, system, req.prompt)
    });
  }

  if (env.ANTHROPIC_API_KEY) {
    attempts.push({
      source: "anthropic",
      model: CLAUDE_HAIKU_MODEL,
      run: () => callAnthropic(env.ANTHROPIC_API_KEY as string, CLAUDE_HAIKU_MODEL, system, req.prompt)
    });
  }

  return attempts;
}

export const claudeHaikuHandler: InternalProviderHandler = {
  key: "claude_haiku",
  async execute(req: DispatchRequest, env: Env): Promise<DispatchResponse> {
    const startedAt = Date.now();
    const attempts = buildAttempts(req, env);
    const failures: Array<{ source: string; model: string; error: string }> = [];

    if (attempts.length === 0) {
      return {
        answer: [
          `Generalist lane: ${req.specialty}.`,
          "No fallback model is currently configured for the general lane.",
          "Add Mistral, Cerebras, Gemma, or Anthropic credentials before using this provider."
        ].join("\n"),
        confidence: 0.1,
        model_hint: "unconfigured",
        handler: "internal://claude_haiku",
        response_time_ms: Date.now() - startedAt,
        meta: {
          source: "general_fallback",
          specialty: req.specialty,
          provider_id: req.provider.id,
          degraded: true,
          error: "No configured general fallback providers"
        }
      };
    }

    for (const attempt of attempts) {
      try {
        const answer = await attempt.run();
        return {
          answer,
          confidence: attempt.source === "anthropic" ? 0.7 : 0.68,
          model_hint: attempt.model,
          handler: "internal://claude_haiku",
          response_time_ms: Date.now() - startedAt,
          meta: {
            source: attempt.source,
            specialty: req.specialty,
            provider_id: req.provider.id,
            fallback_chain: attempts.map((item) => ({ source: item.source, model: item.model })),
            fallback_failures: failures
          }
        };
      } catch (error: any) {
        failures.push({
          source: attempt.source,
          model: attempt.model,
          error: error?.message || String(error)
        });
      }
    }

    const topError = failures[0]?.error || "unknown upstream error";
    return {
      answer: [
        `Generalist lane: ${req.specialty}.`,
        "The free/cheap fallback model chain is temporarily unavailable, so this response is degraded.",
        "Try again once one of the configured providers recovers or has credits available."
      ].join("\n"),
      confidence: 0.2,
      model_hint: failures[0]?.model || CLAUDE_HAIKU_MODEL,
      handler: "internal://claude_haiku",
      response_time_ms: Date.now() - startedAt,
      meta: {
        source: failures[0]?.source || "general_fallback",
        specialty: req.specialty,
        provider_id: req.provider.id,
        degraded: true,
        error: topError,
        fallback_failures: failures
      }
    };
  }
};
