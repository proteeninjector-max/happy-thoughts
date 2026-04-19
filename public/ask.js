(() => {
  const API_BASE = "https://happythoughts.proteeninjector.workers.dev";
  const AUTH_STORAGE_KEY = "happythoughts_auth_user";
  const REDIRECT_KEY = "happythoughts_post_auth_redirect";
  let authReady = null;
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

  function getAuthUser() {
    try {
      return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null');
    } catch {
      return null;
    }
  }

  async function ensureAuth() {
    const existing = getAuthUser();
    if (existing?.id) return existing;

    if (!authReady) {
      authReady = (async () => {
        const config = await fetch('/auth/config').then(r => r.json()).catch(() => ({ enabled: false }));
        if (!config?.enabled || !config?.clerkPublishableKey) return null;

        const encoded = config.clerkPublishableKey.split('_')[2] || '';
        const clerkDomain = atob(encoded).slice(0, -1);

        await new Promise((resolve, reject) => {
          const existingScript = Array.from(document.scripts).find((s) => s.src.includes(clerkDomain));
          if (existingScript && window.Clerk) return resolve();
          const script = document.createElement('script');
          script.async = true;
          script.crossOrigin = 'anonymous';
          script.setAttribute('data-clerk-publishable-key', config.clerkPublishableKey);
          script.src = `https://${clerkDomain}/npm/@clerk/clerk-js@latest/dist/clerk.browser.js`;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });

        if (!window.Clerk) return null;
        await window.Clerk.load();
        const user = window.Clerk.user;
        if (!user?.id) return null;
        const hydrated = {
          id: user.id,
          email: user.primaryEmailAddress?.emailAddress || '',
          firstName: user.firstName || '',
          lastName: user.lastName || ''
        };
        saveAuthUser(hydrated);
        return hydrated;
      })();
    }

    return authReady;
  }

  function requireAuth() {
    const user = getAuthUser();
    if (user?.id) return user;
    localStorage.setItem(REDIRECT_KEY, '/ask');
    window.location.href = '/login';
    return null;
  }

  function saveAuthUser(user) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  }

  function getBuyerId() {
    const user = getAuthUser();
    if (!user?.id) return null;
    return `user:clerk:${user.id}`;
  }

  async function getClerkToken() {
    await ensureAuth();
    const session = window.Clerk?.session;
    if (!session?.getToken) return null;
    try {
      return await session.getToken();
    } catch {
      return null;
    }
  }

  function setPlanView(plan) {
    els.planBadge.textContent = plan.plan || 'free';
    els.planName.textContent = plan.plan || 'free';
    els.planVerified.textContent = String(plan.verified_quota_monthly ?? 0);
    els.planLimit.textContent = String(plan.prompt_char_limit ?? 4000);
    els.planFree.textContent = typeof plan.free_consensus_daily_limit === 'number' ? String(plan.free_consensus_daily_limit) : '—';
  }

  async function refreshPlan() {
    const user = await ensureAuth();
    if (!user) {
      requireAuth();
      return;
    }
    const buyerId = getBuyerId();
    const { ok, data } = await api(`/me/plan?buyer_wallet=${encodeURIComponent(buyerId)}`);
    if (!ok) {
      setPlanView({ plan: 'free', verified_quota_monthly: 0, prompt_char_limit: 4000, free_consensus_daily_limit: 3 });
      els.planBadge.textContent = 'FREE';
      els.walletStatus.textContent = 'Signed in with email.';
      return;
    }
    const plan = data?.plan || data || {};
    setPlanView(plan);
    els.planBadge.textContent = (plan.plan || 'free').toUpperCase();
    els.walletStatus.textContent = plan.plan === 'free'
      ? 'Signed in with email.'
      : `Signed in with email. Paid fact-checking is available on your ${plan.plan} plan.`;
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
        const user = getAuthUser();
        if (!user?.id) {
          localStorage.setItem(REDIRECT_KEY, '/ask');
          window.location.href = '/login';
          return;
        }
        els.upgradeStatus.textContent = `Selected ${button.dataset.plan}. PayPal checkout will attach this plan to ${user.email || 'your account'}.`;
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
    const user = await ensureAuth();
    if (!user?.id) {
      event.preventDefault();
      localStorage.setItem(REDIRECT_KEY, '/ask');
      window.location.href = '/login';
      return;
    }

    const token = await getClerkToken();
    if (!token) {
      event.preventDefault();
      els.askStatus.textContent = 'Your session expired. Sign in again.';
      localStorage.setItem(REDIRECT_KEY, '/ask');
      window.location.href = '/login';
      return;
    }

    let tokenInput = els.askForm.querySelector('input[name="clerk_token"]');
    if (!tokenInput) {
      tokenInput = document.createElement('input');
      tokenInput.type = 'hidden';
      tokenInput.name = 'clerk_token';
      els.askForm.appendChild(tokenInput);
    }
    tokenInput.value = token;

    els.askSubmit.disabled = true;
    els.askSubmit.textContent = 'Thinking…';
    els.askStatus.textContent = 'Submitting your question…';
  });

  (async () => {
    const user = await ensureAuth();
    if (!user?.id) {
      requireAuth();
      return;
    }
    await refreshPlan();
    await loadPlans();
  })();
})();
