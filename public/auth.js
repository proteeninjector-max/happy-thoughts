(() => {
  const STORAGE_KEY = 'happythoughts_auth_user';
  const REDIRECT_KEY = 'happythoughts_post_auth_redirect';

  async function getAuthConfig() {
    const resp = await fetch('/auth/config');
    return resp.json();
  }

  function saveUser(user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  }

  function getRedirect() {
    return localStorage.getItem(REDIRECT_KEY) || '/ask';
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
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@latest/dist/clerk.browser.js';
    script.async = true;
    script.onload = async () => {
      const Clerk = window.Clerk;
      await Clerk.load({ publishableKey: config.clerkPublishableKey });

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
    document.head.appendChild(script);
  }

  mountLogin();
})();
