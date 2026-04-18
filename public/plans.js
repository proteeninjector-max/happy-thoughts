(function () {
const API_BASE = "https://happythoughts.proteeninjector.workers.dev";
const plansGrid = document.getElementById("plans-grid");

if (!plansGrid) return;

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
        <div>Fact-checking / month: ${plan.verified_quota_monthly ?? 0}</div>
        <div>Prompt limit: ${plan.prompt_char_limit}</div>
        ${typeof plan.free_consensus_daily_limit === "number" ? `<div>Free consensus / day: ${plan.free_consensus_daily_limit}</div>` : ""}
      </div>
    </article>
  `).join("");
}

async function loadPlans() {
  plansGrid.innerHTML = '<article class="card plan-card glass"><div class="plan-name">Loading plans…</div></article>';
  try {
    const data = await api("/plans");
    renderPlans(data.plans || {});
  } catch (err) {
    plansGrid.innerHTML = `<article class="card plan-card glass"><div class="plan-name">Plans unavailable right now</div><div class="plan-meta">We couldn’t load live plan data from the backend. ${err.message || err}</div></article>`;
  }
}

loadPlans();
})();
