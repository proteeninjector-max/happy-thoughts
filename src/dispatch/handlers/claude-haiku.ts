import type { Env } from "../../index";
import type { DispatchRequest, DispatchResponse, InternalProviderHandler } from "../types";

const CLAUDE_HAIKU_MODEL = "claude-haiku-4-5-20251001";

function buildSystemPrompt(specialty: string): string {
  return [
    "You are Claude Haiku acting as Happy Thoughts' generalist fallback provider.",
    `The requested specialty is: ${specialty}.`,
    "Give a concise, helpful answer tailored to that specialty.",
    "If the prompt touches risky domains like trading, legal, or medical topics, be careful, clear, and avoid fake certainty.",
    "No markdown tables. Keep the answer practical."
  ].join("\n");
}

export const claudeHaikuHandler: InternalProviderHandler = {
  key: "claude_haiku",
  async execute(req: DispatchRequest, env: Env): Promise<DispatchResponse> {
    const startedAt = Date.now();

    try {
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY is not configured");
      }

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: CLAUDE_HAIKU_MODEL,
          max_tokens: 500,
          system: buildSystemPrompt(req.specialty),
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: req.prompt }]
            }
          ]
        })
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        throw new Error(`Claude Haiku request failed: ${resp.status} ${errorText.slice(0, 300)}`);
      }

      const json: any = await resp.json();
      const answer =
        json?.content
          ?.map((item: any) => (typeof item?.text === "string" ? item.text : ""))
          .join("\n")
          .trim() || "No response generated.";

      return {
        answer,
        confidence: 0.7,
        model_hint: CLAUDE_HAIKU_MODEL,
        handler: "internal://claude_haiku",
        response_time_ms: Date.now() - startedAt,
        meta: {
          source: "anthropic",
          specialty: req.specialty,
          provider_id: req.provider.id
        }
      };
    } catch (error: any) {
      return {
        answer: [
          `Generalist lane: ${req.specialty}.`,
          "Claude Haiku is temporarily unavailable, so this response is degraded.",
          "Try again once Anthropic access is configured or the upstream error clears."
        ].join("\n"),
        confidence: 0.2,
        model_hint: CLAUDE_HAIKU_MODEL,
        handler: "internal://claude_haiku",
        response_time_ms: Date.now() - startedAt,
        meta: {
          source: "anthropic",
          specialty: req.specialty,
          provider_id: req.provider.id,
          degraded: true,
          error: error?.message || String(error)
        }
      };
    }
  }
};
