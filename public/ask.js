(() => {
  const API_BASE = "https://happythoughts.proteeninjector.workers.dev";
  const STORAGE_KEY = "happythoughts_buyer_wallet";
  const els = {
    walletForm: document.getElementById('wallet-form'),
    walletInput: document.getElementById('buyer-wallet'),
    clearWallet: document.getElementById('clear-wallet'),
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

  function getWallet() {
    return (localStorage.getItem(STORAGE_KEY) || '').trim();
  }

  function setWallet(wallet) {
    if (wallet) localStorage.setItem(STORAGE_KEY, wallet);
    else localStorage.removeItem(STORAGE_KEY);
  }

  function setPlanView(plan) {
    els.planBadge.textContent = plan.plan || 'free';
    els.planName.textContent = plan.plan || 'free';
    els.planVerified.textContent = String(plan.verified_quota_monthly ?? 0);
    els.planLimit.textContent = String(plan.prompt_char_limit ?? 4000);
    els.planFree.textContent = typeof plan.free_consensus_daily_limit === 'number' ? String(plan.free_consensus_daily_limit) : '—';
  }

  async function refreshPlan() {
    const wallet = getWallet();
    els.walletInput.value = wallet;
    if (!wallet) {
      setPlanView({ plan: 'free', verified_quota_monthly: 0, prompt_char_limit: 4000, free_consensus_daily_limit: 3 });
      els.planBadge.textContent = 'Guest';
      els.walletStatus.textContent = 'Save a wallet to track free usage now and unlock paid fact-checking later.';
      return;
    }
    const { ok, data } = await api(`/me/plan?buyer_wallet=${encodeURIComponent(wallet)}`);
    if (!ok) {
      els.walletStatus.textContent = data?.message || 'Could not load your plan yet. Your wallet is still saved locally.';
      return;
    }
    const plan = data?.plan || data || {};
    setPlanView(plan);
    els.planBadge.textContent = (plan.plan || 'free').toUpperCase();
    els.walletStatus.textContent = `Wallet saved. You are on the ${plan.plan || 'free'} plan.`;
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
        const wallet = getWallet();
        if (!wallet) {
          els.upgradeStatus.textContent = 'Save your wallet first so checkout can attach the plan to the right buyer.';
          return;
        }
        els.upgradeStatus.textContent = `Selected ${button.dataset.plan}. PayPal checkout is the next wiring step, but this is the plan that will unlock paid fact-checking.`;
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

  els.walletForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const wallet = els.walletInput.value.trim();
    if (!wallet) {
      els.walletStatus.textContent = 'Enter a wallet address first.';
      return;
    }
    setWallet(wallet);
    await refreshPlan();
  });

  els.clearWallet.addEventListener('click', async () => {
    setWallet('');
    await refreshPlan();
  });

  els.fillExample.addEventListener('click', () => {
    els.prompt.value = 'Compare the best note-taking setup for a founder who lives in Telegram, needs fast capture, and hates bloated tools.';
    els.specialty.value = '';
    els.mode.value = 'consensus';
    els.prompt.focus();
  });

  els.askForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const wallet = getWallet();
    const prompt = els.prompt.value.trim();
    const specialty = els.specialty.value.trim();
    const mode = els.mode.value;

    if (!wallet) {
      els.askStatus.textContent = 'Save your wallet first so we can track free usage and paid access cleanly.';
      return;
    }
    if (!prompt) {
      els.askStatus.textContent = 'Ask an actual question first.';
      return;
    }

    els.askSubmit.disabled = true;
    els.askStatus.textContent = 'Thinking…';

    const body = { prompt, buyer_wallet: wallet, mode };
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
