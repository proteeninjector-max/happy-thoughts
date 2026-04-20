(() => {
  const API_BASE = '';
  const AUTH_STORAGE_KEY = "happythoughts_auth_user";
  const REDIRECT_KEY = "happythoughts_post_auth_redirect";
  const ASK_DRAFT_KEY = "happythoughts_ask_draft";
  let authReady = null;
  const els = {
    walletStatus: document.getElementById('wallet-status'),
    authButton: document.getElementById('auth-button'),
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
    const headers = new Headers(init.headers || {});
    const token = await getClerkToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const resp = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      credentials: 'same-origin'
    });
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

  function saveDraft() {
    localStorage.setItem(ASK_DRAFT_KEY, JSON.stringify({
      prompt: els.prompt?.value || '',
      specialty: els.specialty?.value || '',
      mode: els.mode?.value || 'consensus'
    }));
  }

  function restoreDraft() {
    try {
      const raw = localStorage.getItem(ASK_DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (typeof draft?.prompt === 'string' && !els.prompt.value) els.prompt.value = draft.prompt;
      if (typeof draft?.specialty === 'string' && !els.specialty.value) els.specialty.value = draft.specialty;
      if (typeof draft?.mode === 'string' && els.mode.querySelector(`option[value="${draft.mode}"]`)) els.mode.value = draft.mode;
    } catch {}
  }

  function clearDraft() {
    localStorage.removeItem(ASK_DRAFT_KEY);
  }

  function saveAuthUser(user) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  }

  function clearAuthUser() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    authReady = null;
  }

  async function signOutAndReturn() {
    try {
      await ensureAuth();
      if (window.Clerk?.signOut) {
        await window.Clerk.signOut();
      }
    } catch {}
    clearAuthUser();
    window.location.href = '/ask';
  }

  function syncAuthButton(user) {
    if (!els.authButton) return;
    if (user?.id) {
      els.authButton.textContent = 'Log out';
      els.authButton.onclick = () => { void signOutAndReturn(); };
    } else {
      els.authButton.textContent = 'Log in';
      els.authButton.onclick = () => {
        localStorage.setItem(REDIRECT_KEY, '/ask');
        window.location.href = '/login';
      };
    }
  }

  function getBuyerId() {
    const user = getAuthUser();
    if (user?.id) return `user:clerk:${user.id}`;
    return null;
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
    els.planFree.textContent = typeof plan.free_consensus_daily_remaining === 'number'
      ? String(plan.free_consensus_daily_remaining)
      : (typeof plan.free_consensus_daily_limit === 'number' ? String(plan.free_consensus_daily_limit) : '—');
  }

  function normalizePlanPayload(data) {
    const planCatalog = data?.plan_catalog || {};
    const planName = typeof data?.plan === 'string'
      ? data.plan
      : (typeof data?.plan?.plan === 'string' ? data.plan.plan : 'free');
    const freeQuota = data?.quotas?.free_consensus_daily || data?.usage || null;
    const verifiedQuota = data?.quotas?.verified_monthly || null;

    return {
      plan: planCatalog.plan || planName || 'free',
      verified_quota_monthly: typeof planCatalog.verified_quota_monthly === 'number'
        ? planCatalog.verified_quota_monthly
        : (typeof verifiedQuota?.limit === 'number' ? verifiedQuota.limit : 0),
      prompt_char_limit: typeof planCatalog.prompt_char_limit === 'number' ? planCatalog.prompt_char_limit : 4000,
      free_consensus_daily_limit: typeof planCatalog.free_consensus_daily_limit === 'number'
        ? planCatalog.free_consensus_daily_limit
        : (typeof freeQuota?.limit === 'number' ? freeQuota.limit : 3),
      free_consensus_daily_remaining: typeof freeQuota?.remaining === 'number' ? freeQuota.remaining : null
    };
  }

  async function refreshPlan() {
    const user = await ensureAuth();
    if (!user) {
      syncAuthButton(null);
      setPlanView({ plan: 'free', verified_quota_monthly: 0, prompt_char_limit: 4000, free_consensus_daily_limit: 3 });
      els.planBadge.textContent = 'FREE';
      els.walletStatus.textContent = 'Free mode. Ask one now; sign in later if you want history or upgrades.';
      return;
    }
    const { ok, data } = await api('/me/plan');
    if (!ok) {
      setPlanView({ plan: 'free', verified_quota_monthly: 0, prompt_char_limit: 4000, free_consensus_daily_limit: 3 });
      els.planBadge.textContent = 'FREE';
      els.walletStatus.textContent = 'Signed in with email.';
      return;
    }
    syncAuthButton(user);
    const plan = normalizePlanPayload(data || {});
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
          els.upgradeStatus.textContent = `Selected ${button.dataset.plan}. Sign in first and we’ll attach this plan to your account.`;
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

  let submitting = false;

  els.askSubmit.addEventListener('click', async () => {
    if (submitting) return;

    const user = await ensureAuth();

    if (!user?.id) {
      saveDraft();
      els.askStatus.textContent = 'Sign in to get your free tracked answers.';
      requireAuth();
      return;
    }

    const buyerId = getBuyerId();
    if (!buyerId) {
      els.askStatus.textContent = 'Missing account identity. Reload and try again.';
      return;
    }

    const prompt = els.prompt.value.trim();
    const specialty = els.specialty.value.trim();
    const mode = els.mode.value || 'consensus';

    if (!prompt) {
      els.askStatus.textContent = 'Question required.';
      els.prompt.focus();
      return;
    }

    submitting = true;
    els.askSubmit.disabled = true;
    els.askSubmit.textContent = 'Thinking…';
    els.askStatus.textContent = 'Getting your answer…';
    els.answerEmpty.classList.remove('hide');
    els.answerShell.classList.add('hide');
    els.answerEmpty.textContent = 'Thinking…';
    els.answerModeBadge.textContent = mode === 'verified' ? 'Fact-checking' : 'Consensus';

    const { ok, data, status } = await api('/think', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        specialty,
        mode,
        buyer_wallet: buyerId
      })
    });

    if (!ok) {
      const message = data?.message || data?.error || `Request failed (${status})`;
      if (status === 401 || /session expired|invalid session|unauthorized/i.test(String(message))) {
        saveDraft();
        clearAuthUser();
        els.askStatus.textContent = 'Session expired. Sign in again.';
        localStorage.setItem(REDIRECT_KEY, '/ask');
        window.location.href = '/login';
        return;
      }
      els.askStatus.textContent = String(message);
      renderAnswer({
        mode,
        message: String(message),
        confidence: '—',
        confidence_reason: ok ? 'Done.' : 'Request failed.'
      });
      submitting = false;
      els.askSubmit.disabled = false;
      els.askSubmit.textContent = 'Get answer';
      return;
    }

    renderAnswer(data || {});
    clearDraft();
    const usage = data?.usage?.remaining;
    els.askStatus.textContent = typeof usage === 'number'
      ? `${usage} free answer${usage === 1 ? '' : 's'} remaining today.`
      : 'Answer ready.';

    await refreshPlan();

    submitting = false;
    els.askSubmit.disabled = false;
    els.askSubmit.textContent = 'Get answer';
  });

  (async () => {
    restoreDraft();
    const user = await ensureAuth();
    syncAuthButton(user);
    await refreshPlan();
    await loadPlans();
  })();
})();
