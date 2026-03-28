import type { Env } from "../../index";
import { dispatchInternalByKey } from "../executor";
import type {
  DispatchRequest,
  DispatchResponse,
  ProviderRecord,
  InternalProviderHandler
} from "../types";

function buildComposedProvider(base: ProviderRecord, id: ProviderRecord["id"], callback_url: string): ProviderRecord {
  return {
    ...base,
    id,
    callback_url
  };
}

type SignalBias = "long" | "short" | "neutral";
type ThesisBias = "bullish" | "bearish" | "mixed" | "neutral";

function getSignalBias(result: DispatchResponse): SignalBias {
  const bias = result.meta?.bias;
  if (bias === "long" || bias === "short" || bias === "neutral") return bias;
  return "neutral";
}

function getWhaleBias(result: DispatchResponse): ThesisBias {
  const bias = result.meta?.whale_bias;
  if (bias === "bullish" || bias === "bearish" || bias === "mixed" || bias === "neutral") return bias;
  return "neutral";
}

function signalBiasToThesisBias(bias: SignalBias): ThesisBias {
  if (bias === "long") return "bullish";
  if (bias === "short") return "bearish";
  return "neutral";
}

function blendBias(signalBias: SignalBias, whaleBias: ThesisBias): ThesisBias {
  const signalView = signalBiasToThesisBias(signalBias);

  if (signalView === "neutral" && whaleBias === "neutral") return "neutral";
  if (signalView === whaleBias && signalView !== "neutral") return signalView;
  if (signalView === "neutral") return whaleBias;
  if (whaleBias === "neutral") return signalView;
  if (whaleBias === "mixed") return "mixed";
  return "mixed";
}

function buildThesisAnswer(
  req: DispatchRequest,
  signalResult: DispatchResponse,
  mobyResult: DispatchResponse,
  thesisBias: ThesisBias,
  hasConflict: boolean,
  blendedConfidence: number
): string {
  const signalBias = getSignalBias(signalResult);
  const whaleBias = getWhaleBias(mobyResult);
  const mobyMalformed = mobyResult.meta?.malformed_payload === true;

  const lines = [
    `Trading thesis lane: ${req.specialty}.`,
    `Blended thesis bias: ${thesisBias}.`,
    `Signal view: ${signalBias}.`,
    `Whale view: ${whaleBias}.`
  ];

  if (mobyMalformed) {
    lines.push("Whale data unavailable or malformed — thesis based on signal data only.");
  }

  if (hasConflict) {
    lines.push("Signal and whale flow conflict right now. Do not fake certainty — this is a lower-quality read.");
  } else if (thesisBias === "bullish" || thesisBias === "bearish") {
    lines.push(`Signal and whale context are aligned enough to lean ${thesisBias}.`);
  } else {
    lines.push("Context is mixed or neutral. No clean edge without more confirmation.");
  }

  lines.push(
    `Confidence: ${blendedConfidence >= 0.7 ? "high" : blendedConfidence >= 0.5 ? "medium" : "low"} (${blendedConfidence.toFixed(2)}).`
  );
  lines.push("Bottom line: use the signal lane first, then size down or wait if whale flow is conflicted or degraded.");

  return lines.join("\n");
}

export const piThesisHandler: InternalProviderHandler = {
  key: "pi_thesis",
  async execute(req: DispatchRequest, env: Env): Promise<DispatchResponse> {
    const startedAt = Date.now();
    const signalProvider = buildComposedProvider(req.provider, "pi_signals", "internal://pi_signals");
    const mobyProvider = buildComposedProvider(req.provider, "moby_dick", "internal://moby");

    const signalResult = await dispatchInternalByKey(
      "pi_signals",
      {
        ...req,
        provider: signalProvider,
        specialty: "trading/signals"
      },
      env
    );

    const mobyResult = await dispatchInternalByKey(
      "moby",
      {
        ...req,
        provider: mobyProvider,
        specialty: "crypto/whale-tracking"
      },
      env
    );

    const signalBias = getSignalBias(signalResult);
    const whaleBias = getWhaleBias(mobyResult);
    const signalThesisBias = signalBiasToThesisBias(signalBias);
    const hasConflict =
      signalThesisBias !== "neutral" &&
      whaleBias !== "neutral" &&
      whaleBias !== "mixed" &&
      signalThesisBias !== whaleBias;
    const thesisBias = buildBias(signalBias, whaleBias);
    const blendedConfidence = Math.max(
      0,
      Math.min(1, signalResult.confidence * 0.6 + mobyResult.confidence * 0.4)
    );

    return {
      answer: buildThesisAnswer(req, signalResult, mobyResult, thesisBias, hasConflict, blendedConfidence),
      confidence: blendedConfidence,
      handler: "internal://pi_thesis",
      response_time_ms: Date.now() - startedAt,
      meta: {
        source: "pi_thesis",
        thesis_bias: thesisBias,
        signal_bias: signalBias,
        whale_bias: whaleBias,
        conflict: hasConflict,
        caveats: [
          ...(hasConflict ? ["signal and whale bias conflict"] : []),
          ...(mobyResult.meta?.malformed_payload === true
            ? ["Whale data unavailable or malformed — thesis based on signal data only."]
            : [])
        ],
        components: {
          pi_signals: {
            confidence: signalResult.confidence,
            handler: signalResult.handler
          },
          moby: {
            confidence: mobyResult.confidence,
            handler: mobyResult.handler
          }
        }
      }
    };
  }
};

function buildBias(signalBias: SignalBias, whaleBias: ThesisBias): ThesisBias {
  return blendBias(signalBias, whaleBias);
}
