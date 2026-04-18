(() => {
  const API_BASE = "https://happythoughts.proteeninjector.workers.dev";
  const STORAGE_KEY = "happythoughts_human_buyer_id";
  const els = {
    walletStatus: document.getElementById('wallet-status'),
    planBadge: document.getElementById('plan-badge'),
    planName: document.getElementById('plan-name'),
    planVerified: document.getElementById('plan-verified'),
    planLimit: document.getElementById('plan-limit'),
    planFree: document.getElementById('plan-free'),
    askForm: document.getElementById('ask-form'),
    prompt: document.getElementById('prompt'),
    specialty: document.getElementById('specialty'),
    mode: document.getElementById('mode'),
    askSubmit: document.getElementById('ask-submit'),
    askStatus: document.getElementById('ask-status'),
    fillExample: document.getElementById('fill-example'),
    answerEmpty: document.getElementById('answer-empty'),
    answerShell: document.getElementById('answer-shell'),
    answerModeBadge: document.getElementById('answer-mode-badge'),
    answerMode: document.getElementById('answer-mode'),
    answerConfidence: document.getElementById('answer-confidence'),
    confidenceReason: document.getElementById('confidence-reason'),
    answerText: document.getElementById('answer-text'),
    upgradeGrid: document.getElementById('upgrade-grid'),
    upgradeStatus: document.getElementById('upgrade-status')
  };

  async function api(path, init = {}) {
    const resp = await fetch(`${API_BASE}${path}`, init);
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  }

  function getBuyerId() {
    let id = (localStorage.getItem(STORAGE_KEY) || '').trim();
    if (!id) {
      id = `human_${crypto.randomUUID()}`;
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  }

  function setPlanView(plan) {
    els.planBadge.textContent = plan.plan || 'free';
    els.planName.textContent = plan.plan || 'free';
    els.planVerified.textContent = String(plan.verified_quota_monthly ?? 0);
    els.planLimit.textContent = String(plan.prompt_char_limit ?? 4000);
    els.planFree.textContent = typeof plan.free_consensus_daily_limit === 'number' ? String(plan.free_consensus_daily_limit) : '—';
  }

  async function refreshPlan() {
    const buyerId = getBuyerId();
    const { ok, data } = await api(`/me/plan?buyer_wallet=${encodeURIComponent(buyerId)}`);
    if (!ok) {
      setPlanView({ plan: 'free', verified_quota_monthly: 0, prompt_char_limit: 4000, free_consensus_daily_limit: 3 });
      els.planBadge.textContent = 'FREE';
      els.walletStatus.textContent = 'Ask immediately. Human users should not have to think about wallets just to use consensus.';
      return;
    }
    const plan = data?.plan || data || {};
    setPlanView(plan);
    els.planBadge.textContent = (plan.plan || 'free').toUpperCase();
    els.walletStatus.textContent = plan.plan === 'free'
      ? 'You are using the free consensus lane.'
      : `Paid fact-checking is available on your ${plan.plan} plan.`;
  }

  function renderAnswer(data) {
    const mode = data.answer_mode || data.mode || 'consensus';
    const confidence = data.confidence || data.final_answer?.confidence || '—';
    const reason = data.confidence_reason || data.final_answer?.confidence_reason || 'No confidence note returned.';
    const text = data.thought || data.final_answer?.text || data.final_answer || data.message || 'No answer returned.';

    els.answerEmpty.classList.add('hide');
    els.answerShell.classList.remove('hide');
    els.answerModeBadge.textContent = mode === 'verified' ? 'Fact-checking' : 'Consensus';
    els.answerMode.textContent = mode === 'verified' ? 'Fact-checking' : 'Consensus';
    els.answerConfidence.textContent = String(confidence);
    els.confidenceReason.textContent = reason;
    els.answerText.textContent = text;
  }

  function renderPlans(plans) {
    const ordered = [plans.starter, plans.builder, plans.pro].filter(Boolean);
    els.upgradeGrid.innerHTML = ordered.map((plan) => `
      <article class="card plan-card glass">
        <div class="plan-name">${plan.plan}</div>
        <div class="plan-price">$${plan.price_usd_monthly}</div>
        <div class="plan-meta">
          <div>${plan.verified_quota_monthly ?? 0} fact-checking requests / month</div>
          <div>${plan.prompt_char_limit} character prompt limit</div>
        </div>
        <div class="cta-row" style="margin-top:16px;">
          <button class="btn btn-secondary plan-select" type="button" data-plan="${plan.plan}">Choose ${plan.plan}</button>
        </div>
      </article>
    `).join('');

    els.upgradeGrid.querySelectorAll('.plan-select').forEach((button) => {
      button.addEventListener('click', () => {
        const buyerId = getBuyerId();
        els.upgradeStatus.textContent = `Selected ${button.dataset.plan}. PayPal checkout is the next wiring step, and this selection is ready to attach to your human buyer session (${buyerId.slice(0, 12)}…).`;
      });
    });
  }

  async function loadPlans() {
    const { ok, data } = await api('/plans');
    if (!ok) {
      els.upgradeGrid.innerHTML = '<article class="card plan-card glass"><div class="plan-name">Plans unavailable</div></article>';
      return;
    }
    renderPlans(data.plans || {});
  }

  els.fillExample.addEventListener('click', () => {
    els.prompt.value = 'Compare the best note-taking setup for a founder who lives in Telegram, needs fast capture, and hates bloated tools.';
    els.specialty.value = '';
    els.mode.value = 'consensus';
    els.prompt.focus();
  });

  els.askForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const buyerId = getBuyerId();
    const prompt = els.prompt.value.trim();
    const specialty = els.specialty.value.trim();
    const mode = els.mode.value;
    if (!prompt) {
      els.askStatus.textContent = 'Ask an actual question first.';
      return;
    }

    els.askSubmit.disabled = true;
    els.askStatus.textContent = 'Thinking…';

    const body = { prompt, buyer_wallet: buyerId, mode };
    if (specialty) body.specialty = specialty;

    let result = await api('/think', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!result.ok && result.data?.message === 'specialty classification failed' && !specialty) {
      result = await api('/think', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, specialty: 'other/general' })
      });
    }

    const { ok, status, data } = result;
    els.askSubmit.disabled = false;

    if (ok) {
      els.askStatus.textContent = 'Done.';
      renderAnswer(data);
      return;
    }

    if (status === 402 && data?.error === 'upgrade_required') {
      els.askStatus.textContent = data?.message || 'This request needs a paid plan.';
      els.answerEmpty.classList.remove('hide');
      els.answerShell.classList.add('hide');
      els.answerEmpty.textContent = 'Consensus is free. Fact-checking unlocks once you are on a paid plan.';
      return;
    }

    els.askStatus.textContent = data?.message || `Request failed (${status}).`;
    els.answerEmpty.classList.remove('hide');
    els.answerShell.classList.add('hide');
    els.answerEmpty.textContent = data?.message || 'Could not get an answer right now.';
  });

  refreshPlan();
  loadPlans();
})();
