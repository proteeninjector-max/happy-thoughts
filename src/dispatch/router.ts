import type { Env } from "../index";
import { dispatchExternalProvider } from "./external";
import { dispatchInternalProvider } from "./internal";
import type { DispatchRequest, DispatchResponse } from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dispatchHostedProvider(req: DispatchRequest, env: Env): Promise<DispatchResponse> {
  const now = Date.now();
  const jobId = `job_${crypto.randomUUID()}`;
  const jobKey = `provider-job:${req.provider.id}:${jobId}`;
  const job = {
    job_id: jobId,
    thought_id: req.thought_id || null,
    provider_id: req.provider.id,
    prompt: req.prompt,
    specialty: req.specialty,
    buyer_wallet: req.buyer_wallet,
    status: "queued",
    created_at: new Date(now).toISOString(),
    deadline_at: new Date(now + 30_000).toISOString(),
    meta: {
      buyer_wallet: req.buyer_wallet,
      min_confidence: 0,
      include_lineage: false
    }
  };

  await env.THOUGHTS.put(jobKey, JSON.stringify(job));

  const deadline = now + 30_000;
  while (Date.now() < deadline) {
    const raw = await env.THOUGHTS.get(jobKey);
    if (!raw) break;
    const current = JSON.parse(raw);
    if (current.status === "completed" && current.response?.thought) {
      return {
        answer: current.response.thought,
        confidence: typeof current.response.confidence === "number" ? current.response.confidence : 0.5,
        handler: "hosted",
        response_time_ms: Date.now() - now,
        meta: {
          job_id: jobId,
          delivery_mode: "hosted",
          ...(current.response?.meta || {})
        }
      };
    }
    if (current.status === "failed") {
      throw new Error(`Hosted provider ${req.provider.id} failed job ${jobId}: ${current.fail_reason || "unknown"}`);
    }
    await sleep(250);
  }

  throw new Error(`Hosted provider ${req.provider.id} timed out waiting for job ${jobId}`);
}

export async function dispatchProvider(
  req: DispatchRequest,
  env: Env
): Promise<DispatchResponse> {
  const deliveryMode = req.provider.delivery_mode || "webhook";
  if (deliveryMode === "hosted") {
    return dispatchHostedProvider(req, env);
  }

  const callbackUrl = req.provider.callback_url;
  if (!callbackUrl) {
    throw new Error(`Provider ${req.provider.id} has no callback_url`);
  }

  if (callbackUrl.startsWith("internal://")) {
    return dispatchInternalProvider(req, env);
  }

  return dispatchExternalProvider(req, env);
}
