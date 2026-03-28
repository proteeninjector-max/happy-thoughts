import type { Env } from "../../index";
import type { DispatchRequest, DispatchResponse, InternalProviderHandler } from "../types";

const SIGNAL_TICKERS = ["BTCUSD.P", "ETHUSD.P", "SOLUSDC.P"] as const;
const SIGNAL_MAX_AGE_MS = 20 * 60 * 1000;

type SignalSummary = {
  ticker: string;
  bias: "long" | "short" | "neutral";
  confidence: number;
  age_ms: number | null;
  stale: boolean;
  raw: any;
};

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

function extractTimestampMs(payload: any): number | null {
  const candidates = [
    payload?.timestamp,
    payload?.ts,
    payload?.time,
    payload?.signal?.timestamp,
    payload?.signal?.ts,
    payload?.data?.timestamp,
    payload?.data?.ts
  ];

  for (const value of candidates) {
    if (typeof value === "number") {
      return value > 1_000_000_000_000 ? value : value * 1000;
    }
    if (typeof value === "string") {
      const asNumber = Number(value);
      if (Number.isFinite(asNumber) && asNumber > 0) {
        return asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1000;
      }
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return null;
}

function extractBias(payload: any): "long" | "short" | "neutral" {
  const candidates = [
    payload?.bias,
    payload?.side,
    payload?.signal,
    payload?.direction,
    payload?.position,
    payload?.data?.bias,
    payload?.data?.side,
    payload?.signal?.bias,
    payload?.signal?.side
  ];

  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const normalized = value.trim().toLowerCase();
    if (["buy", "long", "bullish"].includes(normalized)) return "long";
    if (["sell", "short", "bearish"].includes(normalized)) return "short";
  }

  return "neutral";
}

function summarizeSignal(ticker: string, payload: any): SignalSummary {
  if (!payload) {
    return {
      ticker,
      bias: "neutral",
      confidence: 0.15,
      age_ms: null,
      stale: true,
      raw: null
    };
  }

  const timestampMs = extractTimestampMs(payload);
  const ageMs = timestampMs ? Math.max(0, Date.now() - timestampMs) : null;
  const stale = ageMs === null || ageMs > SIGNAL_MAX_AGE_MS;
  const bias = extractBias(payload);

  let confidence = bias === "neutral" ? 0.35 : 0.7;
  if (stale) confidence -= 0.25;
  if (ageMs !== null && ageMs < 5 * 60 * 1000) confidence += 0.1;
  confidence = Math.max(0.1, Math.min(0.95, confidence));

  return {
    ticker,
    bias,
    confidence,
    age_ms: ageMs,
    stale,
    raw: payload
  };
}

function selectBestSignal(summaries: SignalSummary[]): SignalSummary | null {
  if (summaries.length === 0) return null;
  const nonNeutral = summaries.filter((item) => item.bias !== "neutral");
  const pool = nonNeutral.length > 0 ? nonNeutral : summaries;
  return pool.slice().sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

function buildAnswer(req: DispatchRequest, summaries: SignalSummary[], best: SignalSummary | null): string {
  const lines: string[] = [];
  lines.push(`Signal lane: ${req.specialty}`);

  if (!best) {
    lines.push("No signal data was available from the V3 signal feed.");
    lines.push("Confidence: low.");
    lines.push("Bottom line: no trade-quality signal confirmed right now.");
    return lines.join("\n");
  }

  const status = best.stale ? "stale" : "fresh";
  lines.push(
    `Best available signal: ${best.ticker} ${best.bias.toUpperCase()} bias (${status}${best.age_ms !== null ? `, age ${Math.round(best.age_ms / 60000)}m` : ""}).`
  );

  const summaryLine = summaries
    .map((item) => `${item.ticker}: ${item.bias}${item.stale ? " (stale)" : ""}`)
    .join(" | ");
  lines.push(`Ticker scan: ${summaryLine}`);

  if (best.bias === "neutral") {
    lines.push("Confidence: low-to-medium. Signal feed is not showing a clean directional edge.");
    lines.push("Bottom line: stay patient unless structure improves.");
  } else {
    lines.push(
      `Confidence: ${best.confidence >= 0.75 ? "high" : best.confidence >= 0.55 ? "medium" : "low"}. Directional bias is ${best.bias}.`
    );
    lines.push("Bottom line: trade with the signal lane, but respect recency and invalidate fast if structure breaks.");
  }

  if (best.stale) {
    lines.push("Caveat: signal data is stale, so treat this as degraded confidence.");
  }

  return lines.join("\n");
}

export const piSignalsHandler: InternalProviderHandler = {
  key: "pi_signals",
  async execute(req: DispatchRequest, env: Env): Promise<DispatchResponse> {
    const startedAt = Date.now();
    const signalBase =
      env.SIGNAL_ENDPOINT_BASE || "https://proteeninjector-signal-solana.proteeninjector.workers.dev/signal";

    const results = await Promise.all(
      SIGNAL_TICKERS.map(async (ticker) => ({
        ticker,
        payload: await fetchJsonMaybe(`${signalBase}?ticker=${encodeURIComponent(ticker)}`, env)
      }))
    );

    const summaries = results.map(({ ticker, payload }) => summarizeSignal(ticker, payload));
    const best = selectBestSignal(summaries);
    const answer = buildAnswer(req, summaries, best);
    const confidence = best?.confidence ?? 0.15;

    return {
      answer,
      confidence,
      handler: "internal://pi_signals",
      response_time_ms: Date.now() - startedAt,
      meta: {
        source: "v3_signal",
        specialty: req.specialty,
        tickers_checked: SIGNAL_TICKERS,
        best_ticker: best?.ticker ?? null,
        signal_found: Boolean(best),
        signal_age_ms: best?.age_ms ?? null,
        bias: best?.bias ?? "neutral",
        caveats: best?.stale ? ["signal data stale"] : []
      }
    };
  }
};
