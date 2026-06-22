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

// ─── IndexedDB offline requests queue ────────────────────────────────────────

const DB_NAME = 'voxly_offline_api';
const STORE_NAME = 'offline_requests';

const getIDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
};

const saveOfflineRequest = async (path, options) => {
  const db = await getIDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.add({
      path,
      method: options.method || 'GET',
      body: options.body,
      timestamp: Date.now(),
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = (event) => reject(event.target.error);
  });
};

const getOfflineRequests = async () => {
  const db = await getIDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
};

const clearOfflineRequest = async (id) => {
  const db = await getIDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = (event) => reject(event.target.error);
  });
};

export const syncOfflineTransactions = async () => {
  const requests = await getOfflineRequests();
  if (!requests.length) return;

  const payloads = [];
  const ids = [];

  for (const req of requests) {
    if (req.path === '/api/add') {
      try {
        const payload = JSON.parse(req.body);
        payloads.push(payload);
        ids.push(req.id);
      } catch (e) {
        console.error('Failed to parse offline request body:', e);
      }
    }
  }

  if (payloads.length > 0) {
    try {
      const { accessToken } = getStoredTokens();
      const headers = { 'Content-Type': 'application/json' };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
      const response = await fetch(`${API_BASE}/api/expenses/bulk_sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ expenses: payloads }),
      });
      if (response.ok) {
        for (const id of ids) {
          await clearOfflineRequest(id);
        }
        window.dispatchEvent(new CustomEvent('offline-sync-complete', {
          detail: { count: payloads.length }
        }));
      }
    } catch (err) {
      console.error('Bulk sync request failed:', err);
    }
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', syncOfflineTransactions);
}

// ─── Web Push Subscriptions ───────────────────────────────────────────────────

export const subscribeUserToPush = async () => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const { public_key } = await apiFetch('/api/notifications/vapid_public_key');
    if (!public_key) {
      console.warn('VAPID public key not found on server.');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return;
    }

    const padding = '='.repeat((4 - (public_key.length % 4)) % 4);
    const base64 = (public_key + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: outputArray,
    });

    await apiFetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    });
    console.log('Push notification subscription successful.');
  } catch (err) {
    console.warn('Failed to subscribe user to push notifications:', err);
  }
};


async function apiFetch(path, options = {}) {
  // Intercept when offline
  if (typeof navigator !== 'undefined' && !navigator.onLine && options.method === 'POST' && path === '/api/add') {
    try {
      await saveOfflineRequest(path, options);
      return {
        message: 'Saved offline. Will sync when connection is restored.',
        offline: true,
        success: true,
      };
    } catch (err) {
      console.error('Failed to queue offline request:', err);
    }
  }

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
export const getCategoryExpenses = (category, { start, end } = {}) => {
  const params = new URLSearchParams({ category });
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  return apiFetch(`/api/expenses/by-category?${params.toString()}`);
};
export const getBudgets = () => apiFetch("/api/budgets");

export const setBudget = (payload) =>
  apiFetch("/api/budgets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const deleteBudget = (category) =>
  apiFetch("/api/budgets", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category }),
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
