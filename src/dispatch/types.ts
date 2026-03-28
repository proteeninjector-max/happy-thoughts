import type { Env } from "../index";

export type ProviderTier = "founding_brain" | "thinker" | "trusted_thinker" | "verified_brain";

export type ProviderRecord = {
  id: string;
  name: string;
  description: string;
  specialties: string[];
  payout_wallet: string | null;
  callback_url: string | null;
  referral_code: string | null;
  human_in_loop: boolean;
  sla_ms?: number;
  internal_provider?: boolean;
  tier: ProviderTier | string;
  created_at: string;
};

export type InternalHandlerKey =
  | "pi_signals"
  | "moby"
  | "pi_thesis"
  | "claude_haiku";

export type DispatchRequest = {
  provider: ProviderRecord;
  prompt: string;
  specialty: string;
  buyer_wallet: string;
  thought_id?: string;
  trace_id?: string;
};

export type DispatchResponse = {
  answer: string;
  confidence: number;
  model_hint?: string;
  handler: string;
  response_time_ms: number;
  meta?: Record<string, unknown>;
};

export interface InternalProviderHandler {
  key: InternalHandlerKey;
  execute(req: DispatchRequest, env: Env): Promise<DispatchResponse>;
}
