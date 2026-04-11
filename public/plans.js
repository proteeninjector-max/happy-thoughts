const API_BASE = "https://happythoughts.proteeninjector.workers.dev";
const walletStorageKey = "happythoughts_buyer_wallet_session";

const plansGrid = document.getElementById("plans-grid");
const buyerPlanForm = document.getElementById("buyer-plan-form");
const buyerWalletInput = document.getElementById("buyer-wallet");
const buyerPlanClear = document.getElementById("buyer-plan-clear");
const buyerPlanStatus = document.getElementById("buyer-plan-status");
const buyerPlanBadge = document.getElementById("buyer-plan-badge");
const buyerPlanJson = document.getElementById("buyer-plan-json");
const purchaseFlowBadge = document.getElementById("purchase-flow-badge");
const activatePlanForm = document.getElementById("activate-plan-form");
const activateWalletInput = document.getElementById("activate-wallet");
const activatePlanInput = document.getElementById("activate-plan");
const activateMonthsInput = document.getElementById("activate-months");
const activateSignatureInput = document.getElementById("activate-signature");
const activateClearButton = document.getElementById("activate-clear");
const purchaseStatus = document.getElementById("purchase-status");
const paymentRequiredJson = document.getElementById("payment-required-json");
const activationResponseJson = document.getElementById("activation-response-json");
const paypalCheckoutButton = document.getElementById("paypal-checkout-btn");

const stats = {
  plan: document.getElementById("buyer-current-plan"),
  price: document.getElementById("buyer-current-price"),
  verifiedQuota: document.getElementById("buyer-verified-quota"),
  promptLimit: document.getElementById("buyer-prompt-limit"),
  freeUsage: document.getElementById("buyer-free-usage"),
  verifiedUsage: document.getElementById("buyer-verified-usage")
};

function formatUsd(value) {
  return typeof value === "number" ? `$${value}/mo` : "—";
}

function formatQuota(snapshot) {
  if (!snapshot) return "—";
  return `${snapshot.used}/${snapshot.limit} used`;
}

function setStatus(message, tone = "neutral") {
  buyerPlanStatus.textContent = message;
  buyerPlanStatus.style.borderColor = tone === "error"
    ? "rgba(248, 113, 113, 0.35)"
    : tone === "success"
      ? "rgba(52, 211, 153, 0.25)"
      : "rgba(167, 139, 250, 0.16)";
}

async function api(path) {
  const resp = await fetch(`${API_BASE}${path}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.message || data?.error || `Request failed: ${resp.status}`);
  }
  return data;
}

async function apiJson(path, options = {}) {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await resp.json().catch(() => ({}));
  return { resp, data };
}

function renderPlans(plans) {
  const ordered = [plans.free, plans.starter, plans.builder, plans.pro].filter(Boolean);
  plansGrid.innerHTML = ordered.map((plan) => `
    <article class="card plan-card glass">
      <div class="plan-name">${plan.plan}</div>
      <div class="plan-price">${plan.price_usd_monthly === 0 ? "$0" : `$${plan.price_usd_monthly}`}</div>
      <div class="plan-meta">
        <div>Verified monthly: ${plan.verified_quota_monthly ?? 0}</div>
        <div>Prompt limit: ${plan.prompt_char_limit}</div>
        <div>Verification: ${plan.verification_enabled ? "on" : "off"}</div>
        ${typeof plan.free_consensus_daily_limit === "number" ? `<div>Free consensus daily: ${plan.free_consensus_daily_limit}</div>` : ""}
      </div>
    </article>
  `).join("");
}

function resetBuyerPlan() {
  stats.plan.textContent = "—";
  stats.price.textContent = "—";
  stats.verifiedQuota.textContent = "—";
  stats.promptLimit.textContent = "—";
  stats.freeUsage.textContent = "—";
  stats.verifiedUsage.textContent = "—";
  buyerPlanBadge.textContent = "Awaiting wallet";
  buyerPlanJson.textContent = "No buyer plan loaded yet.";
}

function resetPurchaseFlow() {
  purchaseFlowBadge.textContent = "Idle";
  paymentRequiredJson.textContent = "No x402 payment requirement loaded yet.";
  activationResponseJson.textContent = "No activation response yet.";
  purchaseStatus.textContent = "Submit without a signature first. If payment is required, the backend will return an x402 payload you can sign and retry with.";
}

function renderBuyerPlan(data) {
  const catalog = data?.plan_catalog || {};
  stats.plan.textContent = data?.plan || "free";
  stats.price.textContent = formatUsd(catalog.price_usd_monthly);
  stats.verifiedQuota.textContent = catalog.verified_quota_monthly ?? 0;
  stats.promptLimit.textContent = catalog.prompt_char_limit ?? "—";
  stats.freeUsage.textContent = formatQuota(data?.quotas?.free_consensus_daily);
  stats.verifiedUsage.textContent = formatQuota(data?.quotas?.verified_monthly);
  buyerPlanBadge.textContent = `${data?.plan || "free"}`;
  buyerPlanJson.textContent = JSON.stringify(data, null, 2);
}

async function loadPlans() {
  plansGrid.innerHTML = '<article class="card plan-card glass"><div class="plan-name">Loading plans…</div></article>';
  try {
    const data = await api("/plans");
    renderPlans(data.plans || {});
  } catch (err) {
    plansGrid.innerHTML = `<article class="card plan-card glass"><div class="plan-name">Failed to load plans</div><div class="plan-meta">${err.message || err}</div></article>`;
  }
}

async function loadBuyerPlan(wallet) {
  setStatus("Loading buyer plan…");
  const trimmed = wallet.trim();
  const data = await api(`/me/plan?buyer_wallet=${encodeURIComponent(trimmed)}`);
  renderBuyerPlan(data);
  localStorage.setItem(walletStorageKey, trimmed);
  if (buyerWalletInput) buyerWalletInput.value = trimmed;
  if (activateWalletInput) activateWalletInput.value = trimmed;
  setStatus("Live plan and quotas loaded from backend.", "success");
}

async function submitPlanActivation({ buyerWallet, plan, months, paymentSignature }) {
  const headers = paymentSignature
    ? { "PAYMENT-SIGNATURE": paymentSignature }
    : {};

  return apiJson("/activate-plan", {
    method: "POST",
    headers,
    body: JSON.stringify({
      buyer_wallet: buyerWallet,
      plan,
      months
    })
  });
}

async function createPayPalOrder({ buyerWallet, plan, months }) {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set("buyer_wallet", buyerWallet);
  currentUrl.searchParams.set("plan", plan);
  currentUrl.searchParams.set("months", String(months));
  currentUrl.searchParams.set("checkout", "paypal");

  const cancelUrl = new URL(currentUrl.toString());
  cancelUrl.searchParams.set("paypal_status", "cancelled");

  const returnUrl = new URL(currentUrl.toString());
  returnUrl.searchParams.set("paypal_status", "returned");

  return apiJson("/paypal/create-order", {
    method: "POST",
    body: JSON.stringify({
      buyer_wallet: buyerWallet,
      plan,
      months,
      return_url: returnUrl.toString(),
      cancel_url: cancelUrl.toString()
    })
  });
}

buyerPlanForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const wallet = buyerWalletInput?.value || "";
  if (!wallet) {
    setStatus("Paste a wallet first.", "error");
    return;
  }

  try {
    await loadBuyerPlan(wallet);
  } catch (err) {
    setStatus(err.message || "Failed to load buyer plan.", "error");
    resetBuyerPlan();
  }
});

buyerPlanClear?.addEventListener("click", () => {
  localStorage.removeItem(walletStorageKey);
  if (buyerWalletInput) buyerWalletInput.value = "";
  if (activateWalletInput) activateWalletInput.value = "";
  resetBuyerPlan();
  setStatus("Paste a wallet to load live plan and quota data.");
});

activatePlanForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const buyerWallet = (activateWalletInput?.value || buyerWalletInput?.value || "").trim();
  const plan = (activatePlanInput?.value || "starter").trim();
  const months = Number(activateMonthsInput?.value || "1");
  const paymentSignature = (activateSignatureInput?.value || "").trim();

  if (!buyerWallet) {
    purchaseStatus.textContent = "Paste a buyer wallet first.";
    purchaseFlowBadge.textContent = "Need wallet";
    return;
  }

  purchaseFlowBadge.textContent = paymentSignature ? "Retrying" : "Starting";
  purchaseStatus.textContent = paymentSignature
    ? "Retrying activation with PAYMENT-SIGNATURE header…"
    : "Requesting plan activation…";

  try {
    const { resp, data } = await submitPlanActivation({ buyerWallet, plan, months, paymentSignature });
    activationResponseJson.textContent = JSON.stringify(data, null, 2);

    if (resp.status === 402) {
      purchaseFlowBadge.textContent = "Payment required";
      paymentRequiredJson.textContent = JSON.stringify(data?.paymentRequired || data, null, 2);
      purchaseStatus.textContent = "Backend returned x402 payment requirements. Sign that payload with your wallet flow, paste the resulting PAYMENT-SIGNATURE above, then retry.";
      return;
    }

    if (!resp.ok) {
      purchaseFlowBadge.textContent = `Error ${resp.status}`;
      paymentRequiredJson.textContent = "No x402 payment requirement loaded yet.";
      purchaseStatus.textContent = data?.message || data?.error || `Activation failed with status ${resp.status}.`;
      return;
    }

    purchaseFlowBadge.textContent = "Activated";
    paymentRequiredJson.textContent = "No x402 payment requirement loaded yet.";
    purchaseStatus.textContent = "Plan activated. Refreshing live buyer plan snapshot…";
    await loadBuyerPlan(buyerWallet);
    purchaseStatus.textContent = "Plan activated and buyer plan snapshot refreshed from backend.";
  } catch (err) {
    purchaseFlowBadge.textContent = "Error";
    purchaseStatus.textContent = err.message || "Activation failed.";
  }
});

paypalCheckoutButton?.addEventListener("click", async () => {
  const buyerWallet = (activateWalletInput?.value || buyerWalletInput?.value || "").trim();
  const plan = (activatePlanInput?.value || "starter").trim();
  const months = Number(activateMonthsInput?.value || "1");

  if (!buyerWallet) {
    purchaseFlowBadge.textContent = "Need wallet";
    purchaseStatus.textContent = "Paste a buyer wallet first.";
    return;
  }

  purchaseFlowBadge.textContent = "Creating PayPal order";
  purchaseStatus.textContent = "Creating PayPal checkout order…";

  try {
    const { resp, data } = await createPayPalOrder({ buyerWallet, plan, months });
    activationResponseJson.textContent = JSON.stringify(data, null, 2);

    if (!resp.ok) {
      purchaseFlowBadge.textContent = `Error ${resp.status}`;
      purchaseStatus.textContent = data?.message || data?.error || `PayPal order creation failed with status ${resp.status}.`;
      return;
    }

    if (!data?.approval_url) {
      purchaseFlowBadge.textContent = "No approval URL";
      purchaseStatus.textContent = "PayPal order was created but no approval_url came back.";
      return;
    }

    purchaseFlowBadge.textContent = "Redirecting to PayPal";
    purchaseStatus.textContent = "Redirecting to PayPal approval…";
    window.location.href = data.approval_url;
  } catch (err) {
    purchaseFlowBadge.textContent = "Error";
    purchaseStatus.textContent = err.message || "PayPal checkout failed.";
  }
});

activateClearButton?.addEventListener("click", () => {
  if (activateSignatureInput) activateSignatureInput.value = "";
  paymentRequiredJson.textContent = "No x402 payment requirement loaded yet.";
  activationResponseJson.textContent = "No activation response yet.";
  resetPurchaseFlow();
});

resetBuyerPlan();
resetPurchaseFlow();
loadPlans();

const pageParams = new URLSearchParams(window.location.search);
const walletFromParams = pageParams.get("buyer_wallet") || "";
const planFromParams = pageParams.get("plan") || "";
const monthsFromParams = pageParams.get("months") || "";
const paypalStatus = pageParams.get("paypal_status") || "";
const rememberedWallet = localStorage.getItem(walletStorageKey);
const startupWallet = walletFromParams || rememberedWallet;

if (planFromParams && activatePlanInput) activatePlanInput.value = planFromParams;
if (monthsFromParams && activateMonthsInput) activateMonthsInput.value = monthsFromParams;

if (startupWallet && buyerWalletInput) {
  buyerWalletInput.value = startupWallet;
  if (activateWalletInput) activateWalletInput.value = startupWallet;
  loadBuyerPlan(startupWallet).then(() => {
    if (paypalStatus === "returned") {
      purchaseFlowBadge.textContent = "PayPal returned";
      purchaseStatus.textContent = "Returned from PayPal. If the webhook already landed, the buyer plan snapshot above should now reflect the paid plan.";
    } else if (paypalStatus === "cancelled") {
      purchaseFlowBadge.textContent = "PayPal cancelled";
      purchaseStatus.textContent = "PayPal checkout was cancelled.";
    }
  }).catch((err) => {
    setStatus(err.message || "Failed to restore buyer plan.", "error");
    resetBuyerPlan();
  });
} else if (paypalStatus === "returned") {
  purchaseFlowBadge.textContent = "PayPal returned";
  purchaseStatus.textContent = "Returned from PayPal. Paste the buyer wallet to refresh the live plan snapshot.";
} else if (paypalStatus === "cancelled") {
  purchaseFlowBadge.textContent = "PayPal cancelled";
  purchaseStatus.textContent = "PayPal checkout was cancelled.";
}
