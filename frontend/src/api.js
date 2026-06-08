const API_BASE = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");
const DEFAULT_TIMEOUT = 60000;
const ACCESS_TOKEN_KEY = "voxly_access_token";
const REFRESH_TOKEN_KEY = "voxly_refresh_token";

let refreshPromise = null;
let authFailureHandler = null;

const notifyAuthFailure = () => {
  if (typeof authFailureHandler === "function") {
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
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  }
  if (notify) {
    notifyAuthFailure();
  }
};

export const getStoredTokens = () => {
  if (typeof window === "undefined") {
    return { accessToken: null, refreshToken: null };
  }
  return {
    accessToken: window.localStorage.getItem(ACCESS_TOKEN_KEY),
    refreshToken: window.localStorage.getItem(REFRESH_TOKEN_KEY),
  };
};

export const persistAuthTokens = (payload = {}) => {
  if (typeof window === "undefined") {
    return;
  }
  const accessToken = payload?.access_token || payload?.accessToken || null;
  const refreshToken = payload?.refresh_token || payload?.refreshToken || null;
  if (accessToken) {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  }
  if (refreshToken) {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
};
export const clearStoredAuthTokens = (options = {}) => clearAuthState(options);

const attemptRefresh = async () => {
  if (refreshPromise) {
    return refreshPromise;
  }

  const { refreshToken } = getStoredTokens();

  refreshPromise = fetch(`${API_BASE}/api/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: refreshToken ? { "Content-Type": "application/json" } : undefined,
    body: refreshToken
      ? JSON.stringify({ refresh_token: refreshToken })
      : undefined,
  })
    .then(async (response) => {
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Unable to refresh session.");
      }
      persistAuthTokens(data || {});
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
  const {
    timeout = DEFAULT_TIMEOUT,
    skipAuth = false,
    _retry = false,
    ...rest
  } = options;
  const resolvedPath = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const { headers: customHeaders, ...fetchOptions } = rest;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const headers = new Headers(customHeaders || {});
  const { accessToken } = getStoredTokens();
  if (accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const finalOptions = {
    credentials: fetchOptions.credentials || "include",
    ...fetchOptions,
    headers,
    signal: controller.signal,
  };

  const attemptRequest = async (retriesLeft) => {
    try {
      const response = await fetch(resolvedPath, finalOptions);
      const data =
        response.status === 204
          ? null
          : await response.json().catch(() => null);

      if (!response.ok) {
        if (
          response.status >= 500 &&
          response.status < 600 &&
          retriesLeft > 0
        ) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return attemptRequest(retriesLeft - 1);
        }
        if (response.status === 401 && !skipAuth) {
          const refreshed = await attemptRefresh();
          if (refreshed && !_retry) {
            return apiFetch(path, { ...options, _retry: true });
          }
        }
        const error = new Error(
          (data && (data.error || data.message)) ||
            `Request failed: ${response.status}`,
        );
        error.status = response.status;
        error.body = data;
        throw error;
      }

      return data;
    } catch (error) {
      const isAborted = controller.signal.aborted || error.name === "AbortError";
      if (!error.status && retriesLeft > 0 && !isAborted) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return attemptRequest(retriesLeft - 1);
      }
      throw error;
    }
  };

  try {
    return await attemptRequest(1);
  } finally {
    clearTimeout(timer);
  }
}

export const getSummary = () => apiFetch("/api/summary");
export const getDashboard = () => apiFetch("/api/dashboard");
export const getRecent = (limit = 10, { from, to, category } = {}) => {
  const params = new URLSearchParams({ limit });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (category) params.set("category", category);
  return apiFetch(`/api/recent?${params}`);
};
export const getCategoryBreakdown = () =>
  apiFetch("/api/charts/category-breakdown");
export const getDailyTotals = (days = 7) =>
  apiFetch(`/api/charts/daily-totals?days=${days}`);
export const getMonthlyTotals = (months = 6) =>
  apiFetch(`/api/charts/monthly-totals?months=${months}`);
export const getBudgets = () => apiFetch("/api/budgets");

export const setBudget = (payload) =>
  apiFetch("/api/budgets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const addExpense = (payload) =>
  apiFetch("/api/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const updateExpense = (id, payload) =>
  apiFetch(`/api/expenses/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const deleteExpense = (id) =>
  apiFetch(`/api/expenses/${id}`, {
    method: "DELETE",
  });

export const sendVoiceCommand = (command) =>
  apiFetch("/api/voice_command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
    timeout: 45000,
  });

export const registerUser = (payload) =>
  apiFetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    skipAuth: true,
  });

export const loginUser = (payload) =>
  apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    skipAuth: true,
  });

export const logoutUser = () =>
  apiFetch("/api/auth/logout", {
    method: "POST",
  });

export const fetchCurrentUser = () => apiFetch("/api/auth/me");
export const getPreferences = () => apiFetch("/api/preferences");
export const updatePreferences = (payload) =>
  apiFetch("/api/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const getForecast = () => apiFetch("/api/forecast");
export const getRecurring = () => apiFetch("/api/recurring");
export const getInsight = (refresh = false) =>
  apiFetch(`/api/insight${refresh ? "?refresh=1" : ""}`);

export default apiFetch;
