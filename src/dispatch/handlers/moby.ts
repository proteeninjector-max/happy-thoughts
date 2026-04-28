import type { Env } from "../../index";
import type { DispatchRequest, DispatchResponse, InternalProviderHandler } from "../types";
import { fetchJsonMaybe } from "../utils";

type WhaleBias = "bullish" | "bearish" | "mixed" | "neutral";
type FlowStrength = "low" | "medium" | "high";

type MobyPayloadState = "ok" | "payment_required" | "malformed";

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

function getPayloadState(payload: any): MobyPayloadState {
  if (!payload || typeof payload !== "object") return "malformed";
  if (payload?.x402Version || payload?.error === "Payment required") return "payment_required";
  if (payload?.fetch_error) return "malformed";
  if (typeof payload.raw === "string") return "malformed";
  return "ok";
}

function buildMobyAnswer(bias: WhaleBias, strength: FlowStrength, state: MobyPayloadState): string {
  if (state === "payment_required") {
    return [
      "Whale flow lane: crypto/whale-tracking.",
      "Whale feed is payment-gated upstream and bypass auth did not succeed, so this response is degraded.",
      "Confidence: low.",
      "Caveat: Happy Thoughts could not fetch the premium whale feed for this request."
    ].join("\n");
  }

  if (state === "malformed") {
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

    try {
      const mobyBase = env.MOBY_ENDPOINT_BASE || "https://moby.proteeninjector.com/moby";

      const payload = await fetchJsonMaybe(mobyBase, env);
      const state = getPayloadState(payload);
      const whale_bias = state === "ok" ? parseWhaleBias(payload) : "neutral";
      const flow_strength = state === "ok" ? parseFlowStrength(payload) : "low";
      const confidence =
        state !== "ok" ? 0.2 : whale_bias === "mixed" || whale_bias === "neutral" ? 0.45 : 0.62;
      const caveats =
        state === "payment_required"
          ? ["Whale feed is payment-gated upstream and bypass auth did not succeed."]
          : state === "malformed"
            ? ["Whale data unavailable or malformed — thesis based on signal data only."]
            : whale_bias === "mixed" || whale_bias === "neutral"
              ? ["Whale positioning is not giving a clean directional edge."]
              : [];

      return {
        answer: buildMobyAnswer(whale_bias, flow_strength, state),
        confidence,
        handler: "internal://moby",
        response_time_ms: Date.now() - startedAt,
        meta: {
          source: "moby",
          specialty: req.specialty,
          moby_base_used: mobyBase,
          whale_bias,
          flow_strength,
          caveats,
          malformed_payload: state === "malformed",
          upstream_payment_required: state === "payment_required",
          payload_top_level_keys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 12) : [],
          upstream_status: payload?.fetch_error ? payload?.status ?? null : null,
          upstream_status_text: payload?.fetch_error ? payload?.statusText ?? null : null,
          upstream_raw: payload?.fetch_error ? payload?.raw ?? null : null,
          upstream_thrown: payload?.fetch_error ? payload?.thrown ?? false : false,
          upstream_error: payload?.fetch_error ? payload?.error ?? null : null
        }
      };
    } catch (error: any) {
      return {
        answer: [
          `Whale flow lane: ${req.specialty}.`,
          "Whale data is temporarily unavailable, so this response is degraded.",
          "No reliable whale positioning summary can be confirmed until the upstream feed recovers."
        ].join("\n"),
        confidence: 0.1,
        handler: "internal://moby",
        response_time_ms: Date.now() - startedAt,
        meta: {
          source: "moby",
          specialty: req.specialty,
          degraded: true,
          whale_bias: "neutral",
          flow_strength: "low",
          caveats: ["moby handler error"],
          malformed_payload: true,
          error: error?.message || String(error)
        }
      };
    }
  }
};
