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
  plansGrid.replaceChildren(...ordered.map((plan) => {
    const article = document.createElement("article");
    article.className = "card plan-card glass";

    const name = document.createElement("div");
    name.className = "plan-name";
    name.textContent = plan.plan;

    const price = document.createElement("div");
    price.className = "plan-price";
    price.textContent = plan.price_usd_monthly === 0 ? "$0" : `$${plan.price_usd_monthly}`;

    const meta = document.createElement("div");
    meta.className = "plan-meta";
    const rows = [
      `Fact-checking / month: ${plan.verified_quota_monthly ?? 0}`,
      `Prompt limit: ${plan.prompt_char_limit}`
    ];
    if (typeof plan.free_consensus_daily_limit === "number") {
      rows.push(`Free consensus / day: ${plan.free_consensus_daily_limit}`);
    }
    rows.forEach((text) => {
      const row = document.createElement("div");
      row.textContent = text;
      meta.appendChild(row);
    });

    article.append(name, price, meta);
    return article;
  }));
}

async function loadPlans() {
  plansGrid.innerHTML = '<article class="card plan-card glass"><div class="plan-name">Loading plans…</div></article>';
  try {
    const data = await api("/plans");
    renderPlans(data.plans || {});
  } catch (err) {
    const article = document.createElement("article");
    article.className = "card plan-card glass";
    const title = document.createElement("div");
    title.className = "plan-name";
    title.textContent = "Plans unavailable right now";
    const meta = document.createElement("div");
    meta.className = "plan-meta";
    meta.textContent = `We couldn’t load live plan data from the backend. ${err?.message || err}`;
    article.append(title, meta);
    plansGrid.replaceChildren(article);
  }
}

loadPlans();
})();
