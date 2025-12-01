import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  clearStoredAuthTokens,
  fetchCurrentUser,
  getPreferences,
  getStoredTokens,
  loginUser,
  logoutUser,
  onAuthFailure,
  persistAuthTokens,
  registerUser,
  updatePreferences,
} from '../api';

const DEFAULT_PREFERENCES = { log_opt_in: false };

const AuthContext = createContext({
  user: null,
  initializing: true,
  preferences: DEFAULT_PREFERENCES,
  login: async () => undefined,
  register: async () => undefined,
  logout: async () => undefined,
  setLoggingPreference: async () => undefined,
});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);

  const loadPreferences = useCallback(async () => {
    if (!user) {
      setPreferences(DEFAULT_PREFERENCES);
      return;
    }
    try {
      const payload = await getPreferences();
      setPreferences(payload?.preferences || DEFAULT_PREFERENCES);
    } catch (err) {
      setPreferences(DEFAULT_PREFERENCES);
    }
  }, [user]);

  useEffect(() => {
    const tokens = getStoredTokens();
    if (!tokens.accessToken) {
      setInitializing(false);
      return undefined;
    }
    let cancelled = false;
    fetchCurrentUser()
      .then((data) => {
        if (!cancelled) {
          setUser(data?.user || null);
        }
      })
      .catch(() => {
        clearStoredAuthTokens({ notify: false });
        if (!cancelled) {
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setInitializing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setPreferences(DEFAULT_PREFERENCES);
      return;
    }
    loadPreferences();
  }, [loadPreferences, user]);

  useEffect(() => {
    const unsubscribe = onAuthFailure(() => {
      clearStoredAuthTokens({ notify: false });
      setUser(null);
      setPreferences(DEFAULT_PREFERENCES);
    });
    return unsubscribe;
  }, []);

  const handleAuthSuccess = useCallback((payload) => {
    persistAuthTokens(payload);
    setUser(payload?.user || null);
    return payload?.user || null;
  }, []);

  const login = useCallback(
    async (credentials) => {
      const payload = await loginUser(credentials);
      return handleAuthSuccess(payload);
    },
    [handleAuthSuccess],
  );

  const register = useCallback(
    async (details) => {
      const payload = await registerUser(details);
      return handleAuthSuccess(payload);
    },
    [handleAuthSuccess],
  );

  const logout = useCallback(async () => {
    try {
      await logoutUser();
    } catch (err) {
      // ignore network/logout errors here
    } finally {
      clearStoredAuthTokens({ notify: false });
      setUser(null);
      setPreferences(DEFAULT_PREFERENCES);
    }
  }, []);

  const setLoggingPreference = useCallback(async (value) => {
    const payload = await updatePreferences({ log_opt_in: Boolean(value) });
    const prefs = payload?.preferences || { log_opt_in: Boolean(value) };
    setPreferences(prefs);
    setUser((prev) => (prev ? { ...prev, log_opt_in: prefs.log_opt_in } : prev));
    return prefs;
  }, []);

  const value = useMemo(
    () => ({
      user,
      initializing,
      preferences,
      login,
      register,
      logout,
      setLoggingPreference,
    }),
    [initializing, login, logout, preferences, register, setLoggingPreference, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
