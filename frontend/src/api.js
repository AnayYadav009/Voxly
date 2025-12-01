const DEFAULT_TIMEOUT = 10000;
const ACCESS_TOKEN_KEY = 'voxly.accessToken';
const REFRESH_TOKEN_KEY = 'voxly.refreshToken';

let accessToken = null;
let refreshToken = null;
let refreshPromise = null;
let authFailureHandler = null;

const hasWindow = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const bootstrapTokens = () => {
  if (!hasWindow()) {
    return;
  }
  accessToken = window.localStorage.getItem(ACCESS_TOKEN_KEY) || null;
  refreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY) || null;
};

bootstrapTokens();

const persistTokens = ({ accessToken: nextAccess = null, refreshToken: nextRefresh = null } = {}) => {
  accessToken = nextAccess || null;
  refreshToken = nextRefresh || null;
  if (!hasWindow()) {
    return;
  }
  if (accessToken) {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  } else {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  }
  if (refreshToken) {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  } else {
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  }
};

const notifyAuthFailure = () => {
  if (typeof authFailureHandler === 'function') {
    authFailureHandler();
  }
};

export const onAuthFailure = (callback) => {
  authFailureHandler = callback;
  return () => {
    if (authFailureHandler === callback) {
      authFailureHandler = null;
    }
  };
};

const clearAuthState = ({ notify = true } = {}) => {
  persistTokens({ accessToken: null, refreshToken: null });
  if (notify) {
    notifyAuthFailure();
  }
};

export const getStoredTokens = () => ({ accessToken, refreshToken });

export const persistAuthTokens = (payload = {}) => {
  persistTokens({
    accessToken: payload.access_token || payload.accessToken || null,
    refreshToken: payload.refresh_token || payload.refreshToken || null,
  });
};

export const clearStoredAuthTokens = (options = {}) => clearAuthState(options);

const attemptRefresh = async () => {
  if (!refreshToken) {
    return false;
  }
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
    .then(async (response) => {
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Unable to refresh session.');
      }
      persistAuthTokens(data);
      return true;
    })
    .catch(() => {
      clearAuthState({ notify: true });
      return false;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
};

async function apiFetch(path, options = {}) {
  const { timeout = DEFAULT_TIMEOUT, skipAuth = false, _retry = false, ...rest } = options;
  const { headers: customHeaders, ...fetchOptions } = rest;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const headers = new Headers(customHeaders || {});

  if (!skipAuth && accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const finalOptions = {
    credentials: fetchOptions.credentials || 'same-origin',
    ...fetchOptions,
    headers,
    signal: controller.signal,
  };

  try {
    const response = await fetch(path, finalOptions);
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      if (response.status === 401 && !skipAuth) {
        const refreshed = await attemptRefresh();
        if (refreshed && !_retry) {
          return apiFetch(path, { ...options, _retry: true });
        }
      }
      const error = new Error(
        (data && (data.error || data.message)) || `Request failed: ${response.status}`,
      );
      error.status = response.status;
      error.body = data;
      throw error;
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const getSummary = () => apiFetch('/api/summary');
export const getRecent = (limit = 10) => apiFetch(`/api/recent?limit=${limit}`);
export const getCategoryBreakdown = () => apiFetch('/api/charts/category-breakdown');
export const getDailyTotals = (days = 7) => apiFetch(`/api/charts/daily-totals?days=${days}`);
export const getMonthlyTotals = (months = 6) => apiFetch(`/api/charts/monthly-totals?months=${months}`);

export const addExpense = (payload) =>
  apiFetch('/api/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const sendVoiceCommand = (command) =>
  apiFetch('/api/voice_command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
    timeout: 15000,
  });

export const registerUser = (payload) =>
  apiFetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    skipAuth: true,
  });

export const loginUser = (payload) =>
  apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    skipAuth: true,
  });

export const logoutUser = () =>
  apiFetch('/api/auth/logout', {
    method: 'POST',
  });

export const fetchCurrentUser = () => apiFetch('/api/auth/me');
export const getPreferences = () => apiFetch('/api/preferences');
export const updatePreferences = (payload) =>
  apiFetch('/api/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export default apiFetch;
