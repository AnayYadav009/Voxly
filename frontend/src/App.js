import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Mic,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Calendar,
  Wallet,
  PieChart,
  BarChart3,
  Plus,
} from 'lucide-react';

import {
  addExpense as apiAddExpense,
  getCategoryBreakdown,
  getDailyTotals,
  getMonthlyTotals,
  getRecent,
  getSummary,
  sendVoiceCommand as apiSendVoiceCommand,
} from './api';
import ConfirmDialog from './components/ConfirmDialog';
import { AuthProvider, useAuth } from './context/AuthContext';

const RECENT_LIMIT = 12;
const BUDGET_GUESSES = {
  food: 10000,
  transport: 4000,
  entertainment: 3000,
  shopping: 5000,
  utilities: 5000,
  health: 3000,
  personal: 2000,
  gifts: 2000,
  savings: 6000,
  uncategorized: 2000,
  other: 2500,
};

const formatINR = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '₹0.00';
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
};

const titleCase = (value) =>
  value
    ? value
        .toString()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase())
    : '';

const parseCurrencyValue = (line) => {
  if (!line) {
    return null;
  }
  const match = line.match(/₹\s*([\d,]+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  return Number(match[1].replace(/,/g, ''));
};

const parseCategoryLine = (line) => {
  if (!line) {
    return [];
  }
  const [, listPart = ''] = line.split(':');
  return listPart
    .split(',')
    .map((item) => {
      const trimmed = item.trim();
      if (!trimmed) {
        return null;
      }
      const match = trimmed.match(/^(.*?)\s*\((?:₹)?([\d,]+(?:\.\d+)?)\)/i);
      if (!match) {
        return { name: titleCase(trimmed), amount: null };
      }
      return {
        name: titleCase(match[1].trim()),
        amount: Number(match[2].replace(/,/g, '')),
      };
    })
    .filter(Boolean);
};

const parseWeeklySummary = (text) => {
  const lines = typeof text === 'string'
    ? text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  const totalLine = lines.find((line) => line.toLowerCase().includes('weekly spend'));
  const avgLine = lines.find((line) => line.toLowerCase().includes('daily average'));
  const categoriesLine = lines.find((line) => line.toLowerCase().includes('top categories'));
  return {
    total: parseCurrencyValue(totalLine),
    dailyAverage: parseCurrencyValue(avgLine),
    topCategories: parseCategoryLine(categoriesLine),
    lines,
  };
};

const parseMonthlySummary = (text) => {
  const lines = typeof text === 'string'
    ? text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  const totalLine = lines.find((line) => line.toLowerCase().includes('total')); // first line
  const categoriesLine = lines.find((line) => line.toLowerCase().includes('leading categories'));
  return {
    total: parseCurrencyValue(totalLine),
    topCategories: parseCategoryLine(categoriesLine),
    lines,
  };
};

const normalizeCategoryTotals = (raw = []) => {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry, index) => {
      if (Array.isArray(entry)) {
        const [category, amount] = entry;
        return {
          key: entry[0] ?? `cat-${index}`,
          category: (category || '').toString().toLowerCase(),
          amount: Number(amount) || 0,
        };
      }
      if (entry && typeof entry === 'object') {
        const category = (entry.category ?? entry[0] ?? '').toString().toLowerCase();
        const amount = Number(entry.total ?? entry.amount ?? entry[1] ?? 0) || 0;
        return {
          key: entry.id ?? `cat-${index}`,
          category,
          amount,
        };
      }
      return null;
    })
    .filter(Boolean);
};

const mapRecentExpenses = (raw = []) =>
  raw.map((item, index) => ({
    id: item.id ?? `expense-${index}`,
    date: item.date ?? '',
    time: item.time ?? '',
    amount: Number(item.amount ?? 0) || 0,
    category: item.category ? item.category.toString() : 'uncategorized',
    description: item.description ?? '',
  }));

const normalizeCategoryChart = (raw = []) => {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry, index) => {
      if (!entry) {
        return null;
      }
      const key = (entry.category ?? entry.name ?? `category-${index}`).toString();
      const amount = Number(entry.total ?? entry.amount ?? 0) || 0;
      return {
        key,
        category: titleCase(key),
        amount,
      };
    })
    .filter(Boolean);
};

const normalizeDailyChart = (raw = []) => {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry, index) => {
      if (!entry) {
        return null;
      }
      const label = entry.label ?? entry.day ?? `Day ${index + 1}`;
      const amount = Number(entry.total ?? entry.amount ?? 0) || 0;
      return {
        day: label,
        amount,
      };
    })
    .filter(Boolean);
};

const normalizeMonthlyChart = (raw = []) => {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry, index) => {
      if (!entry) {
        return null;
      }
      const label = entry.label ?? entry.month ?? `Month ${index + 1}`;
      const amount = Number(entry.total ?? entry.amount ?? 0) || 0;
      return {
        label,
        amount,
      };
    })
    .filter(Boolean);
};

const computeDailySpending = (expenses = []) => {
  const today = new Date();
  const buckets = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = date.toISOString().slice(0, 10);
    buckets.push({
      key,
      day: date.toLocaleDateString('en-IN', { weekday: 'short' }),
      amount: 0,
    });
  }
  const indexByKey = Object.fromEntries(buckets.map((bucket) => [bucket.key, bucket]));
  expenses.forEach((expense) => {
    const bucket = indexByKey[expense.date];
    if (!bucket) {
      return;
    }
    bucket.amount += Number(expense.amount) || 0;
  });
  return buckets.map(({ day, amount }) => ({ day, amount }));
};

const VoiceFinanceDashboard = ({
  user,
  preferences = { log_opt_in: false },
  onLogout = () => {},
  onToggleLogging = async () => {},
}) => {
  const [summary, setSummary] = useState(null);
  const [recentExpenses, setRecentExpenses] = useState([]);
  const [chartCategories, setChartCategories] = useState([]);
  const [chartDaily, setChartDaily] = useState([]);
  const [chartMonthly, setChartMonthly] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [expandedSection, setExpandedSection] = useState(null);
  const [newExpense, setNewExpense] = useState({ amount: '', category: 'food' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceConfirm, setVoiceConfirm] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [budgetWarning, setBudgetWarning] = useState(null);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const recognitionRef = useRef(null);
  const toastTimerRef = useRef(null);
  const displayName = user?.display_name || user?.displayName || user?.email || 'You';
  const userEmail = user?.email || '';

  const loadData = useCallback(async () => {
    if (!user) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [summaryResult, recentResult, categoryResult, dailyResult, monthlyResult] =
        await Promise.allSettled([
          getSummary(),
          getRecent(RECENT_LIMIT),
          getCategoryBreakdown(),
          getDailyTotals(7),
          getMonthlyTotals(6),
        ]);

      let loadError = null;

      if (summaryResult.status === 'fulfilled') {
        setSummary(summaryResult.value);
      } else {
        setSummary(null);
        const reason = summaryResult.reason;
        loadError =
          loadError ||
          reason?.message ||
          (typeof reason === 'string' ? reason : reason?.toString()) ||
          'Failed to fetch summary.';
      }

      if (recentResult.status === 'fulfilled') {
        const payload = recentResult.value;
        const items = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.recent)
          ? payload.recent
          : [];
        setRecentExpenses(mapRecentExpenses(items));
      } else {
        setRecentExpenses([]);
        const reason = recentResult.reason;
        loadError =
          loadError ||
          reason?.message ||
          (typeof reason === 'string' ? reason : reason?.toString()) ||
          'Failed to fetch recent expenses.';
      }

      if (categoryResult.status === 'fulfilled') {
        const catItems = categoryResult.value?.items || categoryResult.value?.data || [];
        setChartCategories(Array.isArray(catItems) ? catItems : []);
      } else {
        setChartCategories([]);
      }

      if (dailyResult.status === 'fulfilled') {
        const dailyItems = dailyResult.value?.items || dailyResult.value?.data || [];
        setChartDaily(Array.isArray(dailyItems) ? dailyItems : []);
      } else {
        setChartDaily([]);
      }

      if (monthlyResult.status === 'fulfilled') {
        const monthlyItems = monthlyResult.value?.items || monthlyResult.value?.data || [];
        setChartMonthly(Array.isArray(monthlyItems) ? monthlyItems : []);
      } else {
        setChartMonthly([]);
      }

      if (loadError) {
        setError(loadError);
      }
    } catch (err) {
      setError(err.message || 'Unable to load data right now.');
      setSummary(null);
      setRecentExpenses([]);
      setChartCategories([]);
      setChartDaily([]);
      setChartMonthly([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, [toast]);

  const handleVoiceResponse = useCallback(
    async (data) => {
      if (!data) {
        setVoiceStatus('No response from the assistant.');
        setToast({ type: 'error', message: 'No response from the assistant.' });
        return true;
      }

      const replyMessage = data.reply || data.message || 'Command processed.';
      const isError = data.error || data.success === false;
      setVoiceStatus(replyMessage);
      setToast({ type: isError ? 'error' : 'info', message: replyMessage });

      if (data.budget_alert) {
        setBudgetWarning(data.budget_alert);
      } else if (Array.isArray(data?.dashboard?.budget_alerts) && data.dashboard.budget_alerts.length > 0) {
        setBudgetWarning(data.dashboard.budget_alerts[0]);
      } else if (!isError) {
        setBudgetWarning(null);
      }

      if (replyMessage && 'speechSynthesis' in window && replyMessage.length <= 160) {
        const utterance = new SpeechSynthesisUtterance(replyMessage);
        window.speechSynthesis.speak(utterance);
      }

      const options = data.options || data.option_list || data.clarification_options;
      const needsConfirmation =
        data.needs_confirmation || data.needsClarification || data.request_confirmation;
      if (needsConfirmation && Array.isArray(options) && options.length > 0) {
        setVoiceConfirm({
          title: data.confirmation_prompt || 'Please confirm your command',
          message: replyMessage,
          options,
        });
        return false;
      }

      if (data.dashboard) {
        setSummary({
          total_today: data.dashboard.total_today,
          weekly_summary: data.dashboard.weekly_summary,
          monthly_summary: data.dashboard.monthly_summary,
          category_totals: data.dashboard.category_totals,
          budget_alerts: data.dashboard.budget_alerts,
          monthly_total: data.dashboard.monthly_total,
        });
        setRecentExpenses(mapRecentExpenses(data.dashboard.recent_expenses || []));
        if (data.dashboard.chart_series) {
          const charts = data.dashboard.chart_series;
          setChartCategories(Array.isArray(charts.category_breakdown) ? charts.category_breakdown : []);
          setChartDaily(Array.isArray(charts.daily_totals) ? charts.daily_totals : []);
          setChartMonthly(Array.isArray(charts.monthly_totals) ? charts.monthly_totals : []);
        } else {
          await loadData();
        }
      } else if (!isError) {
        await loadData();
      }

      return true;
    },
    [loadData],
  );

  const handleVoiceConfirmSelect = useCallback(
    async (option) => {
      setVoiceConfirm(null);
      const followupCommand =
        option?.value || option?.command || option?.text || option?.label || option;
      if (!followupCommand || (typeof followupCommand === 'string' && !followupCommand.trim())) {
        setVoiceStatus('Command cancelled.');
        return;
      }
      setVoiceProcessing(true);
      try {
        const response = await apiSendVoiceCommand(String(followupCommand));
        await handleVoiceResponse(response);
      } catch (err) {
        const message = err?.message || 'Voice command failed.';
        setVoiceStatus(message);
        setToast({ type: 'error', message });
      } finally {
        setVoiceProcessing(false);
      }
    },
    [handleVoiceResponse],
  );

  const handleVoiceConfirmCancel = useCallback(() => {
    setVoiceConfirm(null);
    setVoiceStatus('Command cancelled.');
  }, []);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceStatus('Voice recognition not supported in this browser.');
      recognitionRef.current = null;
      return undefined;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsRecording(true);
      setVoiceStatus('Listening...');
    };

    recognition.onerror = (event) => {
      setIsRecording(false);
      setVoiceProcessing(false);
      setVoiceStatus(event.error === 'no-speech' ? 'No speech detected. Try again.' : `Voice error: ${event.error}`);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognition.onresult = async (event) => {
      const transcript = event.results[0][0].transcript;
      setVoiceStatus(`Heard: "${transcript}"`);
      setVoiceProcessing(true);
      try {
        const response = await apiSendVoiceCommand(transcript);
        await handleVoiceResponse(response);
      } catch (err) {
        const message = err?.message || 'Voice command failed.';
        setVoiceStatus(message);
        setToast({ type: 'error', message });
        setVoiceConfirm(null);
      }
      setVoiceProcessing(false);
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.stop();
    };
  }, [handleVoiceResponse]);

  const toggleRecording = () => {
    if (voiceProcessing || voiceConfirm) {
      setVoiceStatus('Please finish the current command first.');
      return;
    }
    const recognition = recognitionRef.current;
    if (!recognition) {
      setVoiceStatus('Voice recognition not supported in this browser.');
      return;
    }
    if (isRecording) {
      recognition.stop();
      return;
    }
    // Speak a short prompt so the user knows to speak, then start recognition.
    const speakPrompt = (text) => {
      return new Promise((resolve) => {
        try {
          if (!('speechSynthesis' in window)) {
            resolve();
            return;
          }
          const utter = new SpeechSynthesisUtterance(text);
          utter.onend = () => resolve();
          utter.onerror = () => resolve();
          // prefer a neutral voice/rate
          utter.lang = 'en-IN';
          utter.rate = 1;
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utter);
        } catch (e) {
          // If anything goes wrong, just resolve and continue
          resolve();
        }
      });
    };

    // Use a short prompt. Start recognition after the prompt finishes.
    setVoiceStatus('Preparing to listen...');
    speakPrompt('Listening now. Please speak after the prompt.')
      .then(() => {
        try {
          recognition.start();
        } catch (err) {
          setVoiceStatus('Unable to access the microphone. Please allow access and try again.');
        }
      })
      .catch(() => {
        try {
          recognition.start();
        } catch (err) {
          setVoiceStatus('Unable to access the microphone. Please allow access and try again.');
        }
      });
  };

  const toggleSection = (section) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const handleAddExpense = async () => {
    const amountValue = Number(newExpense.amount);
    if (!amountValue || amountValue <= 0) {
      setToast({ type: 'error', message: 'Enter a positive amount.' });
      return;
    }
    if (!newExpense.category) {
      setToast({ type: 'error', message: 'Select a category.' });
      return;
    }
    setSubmitting(true);
    try {
      const payload = await apiAddExpense({
        amount: amountValue,
        category: newExpense.category,
      });
      setToast({ type: 'success', message: payload.message || 'Expense added.' });
      setNewExpense({ amount: '', category: newExpense.category });
      await loadData();
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to add expense.' });
    } finally {
      setSubmitting(false);
    }
  };

  const weeklySummaryData = useMemo(
    () => parseWeeklySummary(summary?.weekly_summary),
    [summary?.weekly_summary],
  );
  const monthlySummaryData = useMemo(
    () => parseMonthlySummary(summary?.monthly_summary),
    [summary?.monthly_summary],
  );
  const categoryTotals = useMemo(
    () => normalizeCategoryTotals(summary?.category_totals),
    [summary?.category_totals],
  );

  const todayTotal = summary ? Number(summary.total_today) || 0 : 0;
  const weeklyTotal = weeklySummaryData.total;
  const dailyAverage = weeklySummaryData.dailyAverage;
  const weeklyTopCategories = weeklySummaryData.topCategories;
  const weeklySummaryLines = weeklySummaryData.lines;
  const monthlyTotal = summary?.monthly_total ?? monthlySummaryData.total;
  const monthlySummaryLines = monthlySummaryData.lines;
  const monthlyCategories = monthlySummaryData.topCategories;
  const budgetAlerts = Array.isArray(summary?.budget_alerts) ? summary.budget_alerts : [];

  const dailySpending = useMemo(() => {
    const fromApi = normalizeDailyChart(chartDaily);
    if (fromApi.length > 0) {
      return fromApi;
    }
    return computeDailySpending(recentExpenses);
  }, [chartDaily, recentExpenses]);

  const categorySpending = useMemo(() => {
    const fromApi = normalizeCategoryChart(chartCategories);
    if (fromApi.length > 0) {
      return fromApi;
    }
    return categoryTotals.map((item) => ({
      category: titleCase(item.category),
      amount: item.amount,
    }));
  }, [chartCategories, categoryTotals]);

  const monthlyTrend = useMemo(
    () => normalizeMonthlyChart(chartMonthly),
    [chartMonthly],
  );

  const categoryData = useMemo(
    () =>
      categoryTotals.map((item) => {
        const budget = BUDGET_GUESSES[item.category] ?? 4000;
        const percentage = budget ? Math.round((item.amount / budget) * 100) : 0;
        return {
          category: titleCase(item.category),
          total: item.amount,
          budget,
          percentage,
        };
      }),
    [categoryTotals],
  );

  const maxDaily = dailySpending.reduce((max, entry) => Math.max(max, entry.amount), 0) || 1;
  const maxMonthly = monthlyTrend.reduce((max, entry) => Math.max(max, entry.amount), 0) || 1;
  const loggingEnabled = Boolean(preferences?.log_opt_in);

  const handlePreferenceToggle = useCallback(async () => {
    if (!user) {
      return;
    }
    setPreferenceSaving(true);
    try {
      const next = !loggingEnabled;
      await onToggleLogging(next);
      setToast({
        type: 'success',
        message: next ? 'Voice command logging enabled.' : 'Voice command logging disabled.',
      });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Unable to update preference.' });
    } finally {
      setPreferenceSaving(false);
    }
  }, [loggingEnabled, onToggleLogging, user]);

  return (
    <div className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="text-center md:text-left">
            <h1 className="text-3xl font-bold text-blue-900 md:text-4xl">Voice Finance Tracker</h1>
            <p className="mt-2 text-blue-700">Track your expenses with voice commands or manual entry</p>
          </div>
          <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center md:justify-end">
            <div className="flex items-center gap-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-blue-900 shadow-sm">
              <div className="text-left">
                <p className="text-sm font-semibold">{displayName}</p>
                {userEmail && <p className="text-xs text-blue-600">{userEmail}</p>}
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-800 transition hover:bg-blue-100"
              >
                Logout
              </button>
            </div>
            <div className="rounded-2xl border border-blue-100 bg-white/80 px-4 py-3 text-blue-900 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-500">Voice command logging</p>
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handlePreferenceToggle}
                  disabled={preferenceSaving}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full border transition ${
                    loggingEnabled ? 'bg-blue-600 border-blue-600' : 'bg-gray-300 border-gray-300'
                  } ${preferenceSaving ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                      loggingEnabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
                <div>
                  <p className="text-sm font-semibold">
                    {loggingEnabled ? 'Enabled' : 'Disabled'}
                    {preferenceSaving && <span className="ml-2 text-xs font-normal text-blue-500">Saving...</span>}
                  </p>
                  <p className="text-xs text-blue-600">
                    Store transcripts to debug misheard commands. Nothing is logged unless you opt in.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6">
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl">
              {error}
            </div>
          </div>
        )}

        {toast && (
          <div className="mb-6">
            <div
              className={`px-4 py-3 rounded-xl border ${
                toast.type === 'error'
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : toast.type === 'success'
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-blue-50 border-blue-200 text-blue-700'
              }`}
            >
              {toast.message}
            </div>
          </div>
        )}

        {(budgetAlerts.length > 0 || budgetWarning) && (
          <div className="mb-6">
            <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl space-y-2">
              <p className="font-semibold">Budget alerts</p>
              <ul className="space-y-1 text-sm">
                {budgetWarning && <li>• {budgetWarning}</li>}
                {budgetAlerts.map((alert, index) => (
                  <li key={`alert-${index}`}>• {alert}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Top Section: Microphone and Dropdowns */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Microphone Section */}
          <div className="col-span-12 lg:col-span-5">
            <div className="app-card border-2 border-blue-200 p-6 sm:p-8 h-full flex flex-col items-center justify-center">
              <button
                onClick={toggleRecording}
                disabled={voiceProcessing || Boolean(voiceConfirm)}
                className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300 ${
                  voiceProcessing || voiceConfirm
                    ? 'bg-blue-300 cursor-not-allowed'
                    : isRecording
                    ? 'bg-red-500 hover:bg-red-600 shadow-xl shadow-red-300 animate-pulse'
                    : 'bg-blue-600 hover:bg-blue-700 shadow-xl shadow-blue-300'
                }`}
                aria-pressed={isRecording}
                aria-label={isRecording ? 'Stop listening' : 'Start listening'}
              >
                <Mic className="w-16 h-16 text-white" />
              </button>
              <p className="mt-6 text-base font-semibold text-blue-900 sm:text-lg">
                {voiceProcessing
                  ? 'Processing...'
                  : isRecording
                  ? 'Listening...'
                  : 'Click to Speak'}
              </p>
              <p className="text-sm text-blue-600 mt-2 text-center min-h-[1.5rem]">
                {voiceStatus || 'Say commands like "Add 500 to food"'}
              </p>
            </div>
          </div>

          {/* Dropdown Summaries */}
          <div className="col-span-12 space-y-4 lg:col-span-7">
            {/* Daily Total */}
            <div className="app-card border-2 border-blue-200 overflow-hidden">
              <button
                onClick={() => toggleSection('daily')}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-blue-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Wallet className="w-5 h-5 text-blue-600" />
                  <span className="font-semibold text-blue-900">Today's Total</span>
                  <span className="text-xl font-bold text-blue-700">{formatINR(todayTotal)}</span>
                </div>
                {expandedSection === 'daily' ? (
                  <ChevronUp className="w-5 h-5 text-blue-600" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-blue-600" />
                )}
              </button>
              {expandedSection === 'daily' && (
                <div className="px-6 py-4 bg-blue-50 border-t border-blue-200">
                  <p className="text-blue-800">
                    Latest total for today. Keep logging expenses to stay on top of your spending.
                  </p>
                </div>
              )}
            </div>

            {/* Weekly Total */}
            <div className="app-card border-2 border-blue-200 overflow-hidden">
              <button
                onClick={() => toggleSection('weeklyTotal')}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-blue-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-blue-600" />
                  <span className="font-semibold text-blue-900">Weekly Total</span>
                  <span className="text-xl font-bold text-blue-700">
                    {weeklyTotal !== null && weeklyTotal !== undefined ? formatINR(weeklyTotal) : '—'}
                  </span>
                </div>
                {expandedSection === 'weeklyTotal' ? (
                  <ChevronUp className="w-5 h-5 text-blue-600" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-blue-600" />
                )}
              </button>
              {expandedSection === 'weeklyTotal' && (
                <div className="px-6 py-4 bg-blue-50 border-t border-blue-200 space-y-2 text-blue-800">
                  {weeklySummaryLines.length > 0 ? (
                    weeklySummaryLines.map((line, index) => <p key={`weekly-line-${index}`}>{line}</p>)
                  ) : (
                    <p>No weekly data yet. Add a few expenses to see insights.</p>
                  )}
                </div>
              )}
            </div>

            {/* Weekly Summary */}
            <div className="app-card border-2 border-blue-200 overflow-hidden">
              <button
                onClick={() => toggleSection('weeklySummary')}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-blue-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                  <span className="font-semibold text-blue-900">Weekly Summary</span>
                </div>
                {expandedSection === 'weeklySummary' ? (
                  <ChevronUp className="w-5 h-5 text-blue-600" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-blue-600" />
                )}
              </button>
              {expandedSection === 'weeklySummary' && (
                <div className="px-6 py-4 bg-blue-50 border-t border-blue-200">
                  {weeklySummaryLines.length > 0 ? (
                    <>
                      <p className="text-blue-800 mb-3">
                        Weekly spending: {weeklyTotal !== null && weeklyTotal !== undefined ? formatINR(weeklyTotal) : '—'} {' | '}
                        Daily average: {dailyAverage !== null && dailyAverage !== undefined ? formatINR(dailyAverage) : '—'}
                      </p>
                      {weeklyTopCategories.length > 0 && (
                        <>
                          <p className="text-blue-800 font-semibold mb-2">Top categories:</p>
                          <ul className="space-y-1">
                            {weeklyTopCategories.map((cat, idx) => (
                              <li key={`weekly-cat-${idx}`} className="text-blue-700">
                                • {cat.name}: {cat.amount !== null && cat.amount !== undefined ? formatINR(cat.amount) : '—'}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </>
                  ) : (
                    <p className="text-blue-800">Weekly insights will appear after you add expenses.</p>
                  )}
                </div>
              )}
            </div>

            {/* Monthly Summary */}
            <div className="app-card border-2 border-blue-200 overflow-hidden">
              <button
                onClick={() => toggleSection('monthlySummary')}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-blue-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <BarChart3 className="w-5 h-5 text-blue-600" />
                  <span className="font-semibold text-blue-900">Monthly Summary</span>
                  <span className="text-xl font-bold text-blue-700">
                    {monthlyTotal !== null && monthlyTotal !== undefined ? formatINR(monthlyTotal) : '—'}
                  </span>
                </div>
                {expandedSection === 'monthlySummary' ? (
                  <ChevronUp className="w-5 h-5 text-blue-600" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-blue-600" />
                )}
              </button>
              {expandedSection === 'monthlySummary' && (
                <div className="px-6 py-4 bg-blue-50 border-t border-blue-200">
                  {monthlySummaryLines.length > 0 ? (
                    <>
                      {monthlySummaryLines.map((line, index) => (
                        <p key={`monthly-line-${index}`} className="text-blue-800 mb-2">
                          {line}
                        </p>
                      ))}
                      {monthlyCategories.length > 0 && (
                        <>
                          <p className="text-blue-800 font-semibold mb-2">Leading categories:</p>
                          <ul className="space-y-1">
                            {monthlyCategories.map((cat, index) => (
                              <li key={`monthly-cat-${index}`} className="text-blue-700">
                                • {cat.name}: {cat.amount !== null && cat.amount !== undefined ? formatINR(cat.amount) : '—'}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </>
                  ) : (
                    <p className="text-blue-800">Monthly breakdown will refresh once expenses are logged.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {/* Pie Chart - Category Distribution */}
          <div className="app-card border-2 border-blue-200 p-6">
            <h3 className="text-lg font-bold text-blue-900 mb-4 flex items-center gap-2">
              <PieChart className="w-5 h-5" />
              Category Distribution
            </h3>
            {categorySpending.length > 0 ? (
              <>
                <div className="relative w-48 h-48 mx-auto mb-4">
                  <svg viewBox="0 0 100 100" className="transform -rotate-90">
                    {(() => {
                      let currentAngle = 0;
                      const colors = ['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe'];
                      const total = categorySpending.reduce((sum, c) => sum + c.amount, 0) || 1;

                      return categorySpending.map((cat, idx) => {
                        const percentage = total ? (cat.amount / total) * 100 : 0;
                        const angle = (percentage / 100) * 360;
                        const largeArc = angle > 180 ? 1 : 0;

                        const startX = 50 + 40 * Math.cos((currentAngle * Math.PI) / 180);
                        const startY = 50 + 40 * Math.sin((currentAngle * Math.PI) / 180);
                        const endX = 50 + 40 * Math.cos(((currentAngle + angle) * Math.PI) / 180);
                        const endY = 50 + 40 * Math.sin(((currentAngle + angle) * Math.PI) / 180);

                        const path = `M 50 50 L ${startX} ${startY} A 40 40 0 ${largeArc} 1 ${endX} ${endY} Z`;
                        currentAngle += angle;

                        return (
                          <path
                            key={cat.category}
                            d={path}
                            fill={colors[idx % colors.length]}
                            stroke="white"
                            strokeWidth="0.5"
                          />
                        );
                      });
                    })()}
                  </svg>
                </div>
                <div className="space-y-2">
                  {categorySpending.map((cat, idx) => {
                    const colors = ['bg-blue-900', 'bg-blue-700', 'bg-blue-500', 'bg-blue-400', 'bg-blue-300'];
                    return (
                      <div key={`category-spending-${cat.category}-${idx}`} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className={`w-3 h-3 rounded ${colors[idx % colors.length]}`}></div>
                          <span className="text-blue-800">{cat.category}</span>
                        </div>
                        <span className="font-semibold text-blue-900">{formatINR(cat.amount)}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-blue-700">Add expenses to see the category distribution chart.</p>
            )}
          </div>

          {/* Bar Chart - Daily Spending */}
          <div className="app-card border-2 border-blue-200 p-6">
            <h3 className="text-lg font-bold text-blue-900 mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Last 7 Days Spending
            </h3>
            <div className="h-64 flex items-end justify-around gap-1 px-4">
              {dailySpending.map((day, idx) => {
                const height = maxDaily ? (day.amount / maxDaily) * 100 : 0;
                const avgDailyBudget = Object.values(BUDGET_GUESSES).reduce((a, b) => a + b, 0) / 30;
                const isOverBudget = day.amount > avgDailyBudget;
                return (
                  <div key={`daily-${idx}`} className="flex flex-col items-center">
                    <div className="flex flex-col items-center justify-end h-52">
                      <div className="relative group">
                        <div
                          className={`w-10 rounded-t transition-all hover:opacity-80 ${
                            isOverBudget ? 'bg-red-500' : 'bg-blue-600'
                          }`}
                          style={{ height: `${(height / 100) * 208}px` }}
                        ></div>
                        <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-blue-900 text-white px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                          {formatINR(day.amount)}
                          {isOverBudget && <div className="text-red-300 text-xs">Over budget!</div>}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-blue-700 mt-2 font-medium">{day.day}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-blue-200">
              <div className="flex items-center gap-3 text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 bg-blue-600 rounded"></div>
                  <span className="text-blue-700">Normal</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 bg-red-500 rounded"></div>
                  <span className="text-blue-700">Over Budget</span>
                </div>
              </div>
            </div>
          </div>

          {/* Bar Chart - Monthly Totals */}
          <div className="app-card border-2 border-blue-200 p-6">
            <h3 className="text-lg font-bold text-blue-900 mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Monthly Totals (6 Months)
            </h3>
            {monthlyTrend.length > 0 ? (
              <>
                <div className="h-64 flex items-end justify-around gap-1 px-4">
                  {monthlyTrend.map((month, idx) => {
                    const height = maxMonthly ? (month.amount / maxMonthly) * 100 : 0;
                    return (
                      <div key={`monthly-${idx}`} className="flex flex-col items-center">
                        <div className="flex flex-col items-center justify-end h-52">
                          <div className="relative group">
                            <div
                              className="w-10 rounded-t transition-all hover:opacity-80 bg-blue-600"
                              style={{ height: `${(height / 100) * 208}px` }}
                            ></div>
                            <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-blue-900 text-white px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10">
                              {formatINR(month.amount)}
                            </div>
                          </div>
                        </div>
                        <span className="text-xs text-blue-700 mt-2 font-medium text-center leading-tight">{month.label}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 pt-4 border-t border-blue-200 text-xs text-blue-700 text-center">
                  Recent monthly spending totals
                </div>
              </>
            ) : (
              <p className="text-blue-700">Monthly totals will appear once you log expenses.</p>
            )}
          </div>
        </div>

        {/* Recent Expenses */}
        <div className="app-card p-6 border-2 border-blue-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-blue-900">Recent Expenses</h3>
            {loading && <span className="text-sm text-blue-600">Refreshing...</span>}
          </div>
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-blue-200">
                  <th className="text-left py-3 px-4 text-blue-900 font-semibold">Date</th>
                  <th className="text-left py-3 px-4 text-blue-900 font-semibold">Time</th>
                  <th className="text-left py-3 px-4 text-blue-900 font-semibold">Amount</th>
                  <th className="text-left py-3 px-4 text-blue-900 font-semibold">Category</th>
                  <th className="text-left py-3 px-4 text-blue-900 font-semibold">Description</th>
                </tr>
              </thead>
              <tbody>
                {recentExpenses.length > 0 ? (
                  recentExpenses.map((expense) => (
                    <tr key={expense.id} className="border-b border-blue-100 hover:bg-blue-50 transition-colors">
                      <td className="py-3 px-4 text-blue-800">{expense.date || '—'}</td>
                      <td className="py-3 px-4 text-blue-800">{expense.time || '—'}</td>
                      <td className="py-3 px-4 text-blue-900 font-semibold">{formatINR(expense.amount)}</td>
                      <td className="py-3 px-4">
                        <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                          {titleCase(expense.category)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-blue-700">{expense.description || '—'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="py-4 px-4 text-center text-blue-700">
                      No expenses logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="space-y-4 md:hidden">
            {recentExpenses.length > 0 ? (
              recentExpenses.map((expense) => (
                <div key={`expense-card-${expense.id}`} className="border border-blue-100 rounded-xl p-4 bg-blue-50">
                  <div className="flex items-center justify-between text-sm text-blue-800">
                    <span>{expense.date || '—'}</span>
                    <span>{expense.time || '—'}</span>
                  </div>
                  <p className="mt-2 text-lg font-semibold text-blue-900">{formatINR(expense.amount)}</p>
                  <p className="text-sm text-blue-700">{expense.description || 'No description'}</p>
                  <span className="inline-flex mt-3 px-3 py-1 bg-white text-blue-800 rounded-full text-xs font-semibold">
                    {titleCase(expense.category)}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-blue-700">No expenses logged yet.</p>
            )}
          </div>
        </div>

        {/* Add Expense Manually */}
        <div className="app-card p-6 border-2 border-blue-200">
          <h3 className="text-xl font-bold text-blue-900 mb-4 flex items-center gap-2">
            <Plus className="w-6 h-6" />
            Add Expense Manually
          </h3>
          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            <div className="flex-1 min-w-[200px] w-full">
              <label className="block text-sm font-semibold text-blue-900 mb-2">Amount (₹)</label>
              <input
                type="number"
                value={newExpense.amount}
                onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
                placeholder="Enter amount"
                className="w-full px-4 py-3 border-2 border-blue-200 rounded-lg focus:outline-none focus:border-blue-500 text-blue-900"
              />
            </div>
            <div className="flex-1 min-w-[200px] w-full">
              <label className="block text-sm font-semibold text-blue-900 mb-2">Category</label>
              <select
                value={newExpense.category}
                onChange={(e) => setNewExpense({ ...newExpense, category: e.target.value })}
                className="w-full px-4 py-3 border-2 border-blue-200 rounded-lg focus:outline-none focus:border-blue-500 text-blue-900"
              >
                <option value="food">Food</option>
                <option value="transport">Transport</option>
                <option value="entertainment">Entertainment</option>
                <option value="shopping">Shopping</option>
                <option value="utilities">Utilities</option>
                <option value="health">Health</option>
                <option value="personal">Personal</option>
                <option value="other">Other</option>
              </select>
            </div>
            <button
              onClick={handleAddExpense}
              disabled={submitting}
              className={`px-8 py-3 rounded-lg font-semibold transition-colors shadow-md ${
                submitting
                  ? 'bg-blue-300 text-white cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {submitting ? 'Adding...' : 'Add Expense'}
            </button>
          </div>
        </div>

        {/* Category Summary */}
        <div className="app-card p-6 border-2 border-blue-200">
          <h3 className="text-xl font-bold text-blue-900 mb-6">Category Summary</h3>
          {categoryData.length > 0 ? (
            <div className="space-y-3">
              {categoryData.map((cat, idx) => (
                <div key={`category-data-${idx}`} className="border-b border-blue-100 pb-3 last:border-b-0">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-blue-900">{cat.category}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-blue-700">
                        {formatINR(cat.total)} / {formatINR(cat.budget)}
                      </span>
                      <span
                        className={`text-sm font-semibold ${
                          cat.percentage > 100
                            ? 'text-red-600'
                            : cat.percentage > 80
                            ? 'text-yellow-600'
                            : 'text-green-600'
                        }`}
                      >
                        {Math.round(cat.percentage)}%
                      </span>
                    </div>
                  </div>
                  <div className="relative h-2 bg-blue-100 rounded-full overflow-hidden">
                    <div
                      className={`absolute left-0 top-0 h-full rounded-full transition-all ${
                        cat.percentage > 100
                          ? 'bg-red-500'
                          : cat.percentage > 80
                          ? 'bg-yellow-500'
                          : 'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(cat.percentage, 100)}%` }}
                    ></div>
                    {cat.percentage > 80 && (
                      <div className="absolute right-2 top-0 h-full flex items-center">
                        <span className="text-xs text-white font-bold">
                          {cat.percentage > 100 ? '⚠️ Over Budget' : '⚠️ Warning'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-blue-700">Category insights will appear once you log some expenses.</p>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(voiceConfirm)}
        title={voiceConfirm?.title}
        message={voiceConfirm?.message}
        options={voiceConfirm?.options || []}
        onConfirm={handleVoiceConfirmSelect}
        onCancel={handleVoiceConfirmCancel}
      />
    </div>
  );
};

const AuthScreen = () => {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', name: '', confirmPassword: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    if (!form.email || !form.password) {
      setError('Email and password are required.');
      return;
    }
    if (mode === 'register' && form.password !== form.confirmPassword) {
      setError('Passwords must match.');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login({ email: form.email, password: form.password });
      } else {
        await register({ email: form.email, password: form.password, name: form.name });
      }
    } catch (err) {
      setError(err?.message || 'Authentication failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-blue-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md rounded-3xl border border-blue-100 bg-white p-8 shadow-2xl">
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-bold text-blue-900">Voxly</h1>
          <p className="text-sm text-blue-600">Your voice-powered finance tracker</p>
        </div>
        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="space-y-1">
            <label className="text-sm font-semibold text-blue-900" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="w-full rounded-2xl border border-blue-200 px-4 py-3 text-blue-900 focus:border-blue-500 focus:outline-none"
              placeholder="you@example.com"
              value={form.email}
              onChange={handleChange}
            />
          </div>
          {mode === 'register' && (
            <div className="space-y-1">
              <label className="text-sm font-semibold text-blue-900" htmlFor="auth-name">
                Display name
              </label>
              <input
                id="auth-name"
                name="name"
                type="text"
                className="w-full rounded-2xl border border-blue-200 px-4 py-3 text-blue-900 focus:border-blue-500 focus:outline-none"
                placeholder="e.g. Priya"
                value={form.name}
                onChange={handleChange}
              />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-sm font-semibold text-blue-900" htmlFor="auth-password">
              Password
            </label>
            <input
              id="auth-password"
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              className="w-full rounded-2xl border border-blue-200 px-4 py-3 text-blue-900 focus:border-blue-500 focus:outline-none"
              placeholder="Enter a strong password"
              value={form.password}
              onChange={handleChange}
            />
          </div>
          {mode === 'register' && (
            <div className="space-y-1">
              <label className="text-sm font-semibold text-blue-900" htmlFor="auth-confirm">
                Confirm password
              </label>
              <input
                id="auth-confirm"
                name="confirmPassword"
                type="password"
                required
                className="w-full rounded-2xl border border-blue-200 px-4 py-3 text-blue-900 focus:border-blue-500 focus:outline-none"
                placeholder="Re-enter your password"
                value={form.confirmPassword}
                onChange={handleChange}
              />
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-center text-white font-semibold transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {submitting
              ? 'Please wait...'
              : mode === 'login'
              ? 'Sign in'
              : 'Create account'}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-blue-700">
          {mode === 'login' ? 'Need an account?' : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
            className="font-semibold text-blue-900 hover:underline"
          >
            {mode === 'login' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
};

const LoadingScreen = () => (
  <div className="min-h-screen bg-blue-50 px-4 py-10">
    <div className="mx-auto max-w-sm rounded-3xl border border-blue-100 bg-white p-6 text-center text-blue-900 shadow-xl">
      Loading your workspace...
    </div>
  </div>
);

const ProtectedApp = () => {
  const { user, initializing, logout, preferences, setLoggingPreference } = useAuth();
  if (initializing) {
    return <LoadingScreen />;
  }
  if (!user) {
    return <AuthScreen />;
  }
  return (
    <VoiceFinanceDashboard
      user={user}
      preferences={preferences}
      onLogout={logout}
      onToggleLogging={setLoggingPreference}
    />
  );
};

const App = () => (
  <AuthProvider>
    <ProtectedApp />
  </AuthProvider>
);

export default App;
