const API_BASE = "https://happythoughts.proteeninjector.workers.dev";
const walletStorageKey = "happythoughts_buyer_wallet_session";

const plansGrid = document.getElementById("plans-grid");
const buyerPlanForm = document.getElementById("buyer-plan-form");
const buyerWalletInput = document.getElementById("buyer-wallet");
const buyerPlanClear = document.getElementById("buyer-plan-clear");
const buyerPlanStatus = document.getElementById("buyer-plan-status");
const buyerPlanBadge = document.getElementById("buyer-plan-badge");
const buyerPlanJson = document.getElementById("buyer-plan-json");

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
  setStatus("Live plan and quotas loaded from backend.", "success");
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
  resetBuyerPlan();
  setStatus("Paste a wallet to load live plan and quota data.");
});

resetBuyerPlan();
loadPlans();

const rememberedWallet = localStorage.getItem(walletStorageKey);
if (rememberedWallet && buyerWalletInput) {
  buyerWalletInput.value = rememberedWallet;
  loadBuyerPlan(rememberedWallet).catch((err) => {
    setStatus(err.message || "Failed to restore buyer plan.", "error");
    resetBuyerPlan();
  });
}
