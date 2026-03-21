const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";

export type PaymentVerificationResult =
  | {
      ok: true;
      payer: string;
      paymentPayload: any;
      paymentDetails: any;
      bypassed: boolean;
    }
  | { ok: false; response: Response };

export interface PaymentEnv {
  PROFIT_WALLET: string;
  CACHE: KVNamespace;
  OWNER_KEY?: string;
  OWNER_KEY_HEADER?: string;
  X402_FACILITATOR_URL?: string;
  X402_NETWORK?: string; // CAIP-2 id
  X402_ASSET?: string; // token address
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers || {}) }
  });
}

function b64Encode(obj: unknown): string {
  return btoa(JSON.stringify(obj));
}

function b64DecodeJson(value: string): any {
  const decoded = atob(value);
  return JSON.parse(decoded);
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function buildPaymentRequired(
  request: Request,
  env: PaymentEnv,
  requiredAmount: number,
  description: string
): { headerValue: string; body: any } {
  const network = env.X402_NETWORK || "eip155:8453"; // Base mainnet
  const asset = env.X402_ASSET || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base USDC

  const paymentDetails = {
    scheme: "exact",
    network,
    amount: `$${requiredAmount.toFixed(2)}`,
    asset,
    payTo: env.PROFIT_WALLET,
    maxTimeoutSeconds: 60,
    extra: {
      assetTransferMethod: "eip3009",
      name: "USDC",
      version: "2"
    }
  };

  const paymentRequired = {
    x402Version: 2,
    resource: {
      url: request.url,
      description,
      mimeType: "application/json"
    },
    accepts: [paymentDetails]
  };

  return {
    headerValue: b64Encode(paymentRequired),
    body: paymentRequired
  };
}

function extractPayer(paymentPayload: any): string {
  return (
    paymentPayload?.payload?.authorization?.from ||
    paymentPayload?.payload?.from ||
    paymentPayload?.payer ||
    paymentPayload?.wallet ||
    ""
  );
}

function isVerifiedResponse(resp: any): boolean {
  return resp?.verified === true || resp?.valid === true || resp?.success === true;
}

export async function verifyX402Payment(
  request: Request,
  env: PaymentEnv,
  requiredAmount: number,
  description = "Happy Thoughts"
): Promise<PaymentVerificationResult> {
  // Internal owner bypass
  const ownerHeader = env.OWNER_KEY_HEADER || "X-OWNER-KEY";
  const ownerKey = env.OWNER_KEY;
  if (ownerKey) {
    const provided = request.headers.get(ownerHeader);
    if (provided && provided === ownerKey) {
      return {
        ok: true,
        payer: "OWNER_BYPASS",
        paymentPayload: null,
        paymentDetails: null,
        bypassed: true
      };
    }
  }

  const signatureB64 = request.headers.get(PAYMENT_SIGNATURE_HEADER);
  if (!signatureB64) {
    const pr = buildPaymentRequired(request, env, requiredAmount, description);
    return {
      ok: false,
      response: jsonResponse(
        { error: "payment_required", requiredAmount, paymentRequired: pr.body },
        402,
        { [PAYMENT_REQUIRED_HEADER]: pr.headerValue }
      )
    };
  }

  let paymentPayload: any;
  try {
    paymentPayload = b64DecodeJson(signatureB64);
  } catch {
    const pr = buildPaymentRequired(request, env, requiredAmount, description);
    return {
      ok: false,
      response: jsonResponse(
        { error: "payment_required", message: "invalid payment payload", paymentRequired: pr.body },
        402,
        { [PAYMENT_REQUIRED_HEADER]: pr.headerValue }
      )
    };
  }

  const paymentDetails = paymentPayload?.accepted;
  if (!paymentDetails) {
    const pr = buildPaymentRequired(request, env, requiredAmount, description);
    return {
      ok: false,
      response: jsonResponse(
        { error: "payment_required", message: "missing payment details", paymentRequired: pr.body },
        402,
        { [PAYMENT_REQUIRED_HEADER]: pr.headerValue }
      )
    };
  }

  // Replay protection
  const replayKey = `x402-replay:${await sha256Hex(signatureB64)}`;
  const seen = await env.CACHE.get(replayKey);
  if (seen) {
    const pr = buildPaymentRequired(request, env, requiredAmount, description);
    return {
      ok: false,
      response: jsonResponse(
        { error: "payment_required", message: "replay detected", paymentRequired: pr.body },
        402,
        { [PAYMENT_REQUIRED_HEADER]: pr.headerValue }
      )
    };
  }

  // Basic checks before facilitator
  if (paymentDetails.payTo && paymentDetails.payTo !== env.PROFIT_WALLET) {
    return {
      ok: false,
      response: jsonResponse({ error: "payment_invalid", message: "payTo mismatch" }, 402)
    };
  }

  const facilitator = env.X402_FACILITATOR_URL || "https://x402.org";

  const verifyResp = await fetch(`${facilitator.replace(/\/$/, "")}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paymentPayload, paymentDetails })
  });

  const verifyJson = await verifyResp.json().catch(() => ({}));

  if (!verifyResp.ok || !isVerifiedResponse(verifyJson)) {
    const pr = buildPaymentRequired(request, env, requiredAmount, description);
    return {
      ok: false,
      response: jsonResponse(
        { error: "payment_required", message: "verification failed", details: verifyJson, paymentRequired: pr.body },
        402,
        { [PAYMENT_REQUIRED_HEADER]: pr.headerValue }
      )
    };
  }

  // Mark signature as used
  await env.CACHE.put(replayKey, "1", { expirationTtl: 60 * 60 * 24 });

  const payer = extractPayer(paymentPayload) || "unknown";

  return {
    ok: true,
    payer,
    paymentPayload,
    paymentDetails,
    bypassed: false
  };
}

export const X402_HEADERS = {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER
};
