(() => {
  const STORAGE_KEY = 'happythoughts_auth_user';
  const REDIRECT_KEY = 'happythoughts_post_auth_redirect';

  function safeRedirectPath(value) {
    if (typeof value !== 'string') return '/ask';
    const trimmed = value.trim();
    if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/ask';
    return trimmed;
  }

  function getClerkDomain(publishableKey) {
    const encoded = publishableKey.split('_')[2] || '';
    const decoded = atob(encoded).slice(0, -1);
    if (!/^[a-z0-9.-]+$/i.test(decoded)) throw new Error('invalid Clerk domain');
    if (!decoded.endsWith('.clerk.accounts.dev')) throw new Error('unexpected Clerk domain');
    return decoded;
  }

  async function getAuthConfig() {
    const resp = await fetch('/auth/config');
    return resp.json();
  }

  function saveUser(user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  }

  function getRedirect() {
    return safeRedirectPath(localStorage.getItem(REDIRECT_KEY) || '/ask');
  }

  function clearRedirect() {
    localStorage.removeItem(REDIRECT_KEY);
  }

  async function mountLogin() {
    const authStatus = document.getElementById('auth-status');
    const authContainer = document.getElementById('auth-container');
    const config = await getAuthConfig().catch(() => ({ enabled: false }));

    if (!config?.enabled || !config?.clerkPublishableKey) {
      authStatus.textContent = 'Email auth is scaffolded, but Clerk is not configured on this deployment yet.';
      authContainer.innerHTML = '<div class="notice">Set CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY, then this login will go live immediately.</div>';
      return;
    }

    authStatus.textContent = 'Continue with email.';
    let clerkDomain = '';
    try {
      clerkDomain = getClerkDomain(config.clerkPublishableKey);
    } catch {
      authStatus.textContent = 'Login config looks invalid on this deployment.';
      return;
    }
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.setAttribute('data-clerk-publishable-key', config.clerkPublishableKey);
    script.src = `https://${clerkDomain}/npm/@clerk/clerk-js@latest/dist/clerk.browser.js`;
    script.onload = async () => {
      const Clerk = window.Clerk;
      await Clerk.load();

      if (Clerk.user) {
        const email = Clerk.user.primaryEmailAddress?.emailAddress || '';
        saveUser({
          id: Clerk.user.id,
          email,
          firstName: Clerk.user.firstName || '',
          lastName: Clerk.user.lastName || ''
        });
        const redirect = getRedirect();
        clearRedirect();
        window.location.href = redirect;
        return;
      }

      Clerk.mountSignIn(authContainer, {
        appearance: {
          variables: {
            colorPrimary: '#c026d3',
            colorBackground: '#0a0a0f',
            colorText: '#f0e6ff',
            colorInputBackground: '#151122',
            colorInputText: '#f0e6ff',
            borderRadius: '16px'
          }
        },
        signUpUrl: '/login',
        afterSignInUrl: getRedirect(),
        afterSignUpUrl: getRedirect()
      });
    };
    script.onerror = () => {
      authStatus.textContent = 'Could not load email login right now.';
    };
    document.head.appendChild(script);
  }

  mountLogin();
})();
