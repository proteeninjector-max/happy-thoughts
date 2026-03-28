import type { Env } from "../../index";
import type { DispatchRequest, DispatchResponse, InternalProviderHandler } from "../types";
import { fetchJsonMaybe } from "../utils";

type WhaleBias = "bullish" | "bearish" | "mixed" | "neutral";
type FlowStrength = "low" | "medium" | "high";

function parseWhaleBias(payload: any): WhaleBias {
  const candidates = [
    payload?.whale_bias,
    payload?.bias,
    payload?.direction,
    payload?.positioning,
    payload?.summary?.bias,
    payload?.summary?.direction,
    payload?.data?.bias
  ];

  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const normalized = value.trim().toLowerCase();
    if (["bullish", "long", "buy"].includes(normalized)) return "bullish";
    if (["bearish", "short", "sell"].includes(normalized)) return "bearish";
    if (["mixed", "two-way", "conflicted"].includes(normalized)) return "mixed";
    if (["neutral", "flat"].includes(normalized)) return "neutral";
  }

  return "neutral";
}

function parseFlowStrength(payload: any): FlowStrength {
  const candidates = [
    payload?.flow_strength,
    payload?.strength,
    payload?.summary?.strength,
    payload?.data?.strength
  ];

  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const normalized = value.trim().toLowerCase();
    if (["high", "strong"].includes(normalized)) return "high";
    if (["medium", "moderate"].includes(normalized)) return "medium";
    if (["low", "weak"].includes(normalized)) return "low";
  }

  return "low";
}

function payloadLooksUsable(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;
  if (typeof payload.raw === "string") return false;
  return true;
}

function buildMobyAnswer(bias: WhaleBias, strength: FlowStrength, malformed: boolean): string {
  if (malformed) {
    return [
      "Whale flow lane: crypto/whale-tracking.",
      "Whale data unavailable or malformed — thesis based on signal data only if needed.",
      "Confidence: low.",
      "Caveat: Moby payload could not be parsed into a reliable positioning summary."
    ].join("\n");
  }

  const lines = [
    "Whale flow lane: crypto/whale-tracking.",
    `Whale bias: ${bias}.`,
    `Flow strength: ${strength}.`
  ];

  if (bias === "mixed" || bias === "neutral") {
    lines.push("Caveat: whale positioning is not giving a clean directional edge.");
  } else {
    lines.push(`Takeaway: whale flow is leaning ${bias === "bullish" ? "risk-on / long" : "risk-off / short"}.`);
  }

  return lines.join("\n");
}

export const mobyHandler: InternalProviderHandler = {
  key: "moby",
  async execute(req: DispatchRequest, env: Env): Promise<DispatchResponse> {
    const startedAt = Date.now();
    const mobyBase = env.MOBY_ENDPOINT_BASE || "https://proteeninjector-moby.proteeninjector.workers.dev/moby";

    const payload = await fetchJsonMaybe(mobyBase, env);
    const malformed = !payloadLooksUsable(payload);
    const whale_bias = malformed ? "neutral" : parseWhaleBias(payload);
    const flow_strength = malformed ? "low" : parseFlowStrength(payload);
    const confidence = malformed ? 0.2 : whale_bias === "mixed" || whale_bias === "neutral" ? 0.45 : 0.62;
    const caveats = malformed
      ? ["Whale data unavailable or malformed — thesis based on signal data only."]
      : whale_bias === "mixed" || whale_bias === "neutral"
        ? ["Whale positioning is not giving a clean directional edge."]
        : [];

    return {
      answer: buildMobyAnswer(whale_bias, flow_strength, malformed),
      confidence,
      handler: "internal://moby",
      response_time_ms: Date.now() - startedAt,
      meta: {
        source: "moby",
        specialty: req.specialty,
        whale_bias,
        flow_strength,
        caveats,
        malformed_payload: malformed
      }
    };
  }
};
