import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  RefreshCw,
  ChevronDown,
} from 'lucide-react';

import {
  addExpense as apiAddExpense,
  getBudgets,
  setBudget as apiSetBudget,
  getCategoryBreakdown,
  getDailyTotals,
  getMonthlyTotals,
  getRecent,
  getSummary,
  getForecast,
  getRecurring,
  getInsight,
  sendVoiceCommand as apiSendVoiceCommand,
  updateExpense as apiUpdateExpense,
} from './api';
import ConfirmDialog from './components/ConfirmDialog';
import { AuthProvider, useAuth } from './context/AuthContext';
import UserHeader from './components/UserHeader';
import VoiceButton from './components/VoiceButton';
import SummaryDropdowns from './components/SummaryDropdowns';
import CategoryPieChart from './components/CategoryPieChart';
import DailyBarChart from './components/DailyBarChart';
import MonthlyBarChart from './components/MonthlyBarChart';
import ExpenseTable from './components/ExpenseTable';
import AddExpenseForm from './components/AddExpenseForm';
import CategorySummary from './components/CategorySummary';
import { formatINR, toLocalISO, titleCase } from './utils';

const RECENT_LIMIT = 12;

// TODO: replace with structured fields from /api/summary once backend is updated
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

// TODO: replace with structured fields from /api/summary once backend is updated
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
    const key = toLocalISO(date);
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

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'An unexpected error occurred.' };
  }

  componentDidCatch(error, info) {
    // Log to console so developers can see the stack trace
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-blue-50 flex items-center justify-center px-4">
          <div className="max-w-md w-full bg-white rounded-2xl border border-red-200 shadow-lg p-8 text-center">
            <h2 className="text-xl font-bold text-red-700 mb-2">Something went wrong</h2>
            <p className="text-sm text-red-600 mb-4">{this.state.message}</p>
            <button
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="px-6 py-2 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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
  const [userBudgets, setUserBudgets] = useState({});
  const [isRecording, setIsRecording] = useState(false);
  const [expandedSection, setExpandedSection] = useState(null);
  const [newExpense, setNewExpense] = useState({ amount: '', category: 'food' });
  const [budgetForm, setBudgetForm] = useState({ amount: '', category: 'food' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceConfirm, setVoiceConfirm] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [budgetWarning, setBudgetWarning] = useState(null);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ amount: '', category: '', description: '' });
  const [expenseFilter, setExpenseFilter] = useState({ from: '', to: '', category: '' });
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [forecast, setForecast] = useState(null);
  const [recurring, setRecurring] = useState([]);
  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const recognitionRef = useRef(null);
  const toastTimerRef = useRef(null);
  const lastCommandRef = useRef(null);
  const displayName = user?.display_name || user?.displayName || user?.email || 'You';
  const userEmail = user?.email || '';

  const loadData = useCallback(async () => {
    if (!user) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [summaryResult, recentResult, categoryResult, dailyResult, monthlyResult, budgetResult, forecastResult, recurringResult, insightResult] =
        await Promise.allSettled([
          getSummary(),
          getRecent(RECENT_LIMIT),
          getCategoryBreakdown(),
          getDailyTotals(7),
          getMonthlyTotals(6),
          getBudgets(),
          getForecast(),
          getRecurring(),
          getInsight(),
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

      if (budgetResult.status === 'fulfilled') {
        setUserBudgets(budgetResult.value || {});
      } else {
        setUserBudgets({});
      }

      if (forecastResult.status === 'fulfilled') {
        setForecast(forecastResult.value);
      } else {
        setForecast(null);
      }

      if (recurringResult.status === 'fulfilled') {
        setRecurring(recurringResult.value?.items || []);
      } else {
        setRecurring([]);
      }

      if (insightResult.status === 'fulfilled') {
        setInsight(insightResult.value?.insight || null);
      } else {
        setInsight(null);
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
      setUserBudgets({});
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

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;

    const handler = (event) => {
      if (event.data?.type === 'SYNC_COMPLETE') {
        const count = event.data.count || 0;
        setPendingSyncCount(0);
        setToast({ type: 'success', message: `${count} offline expense${count !== 1 ? 's' : ''} synced.` });
        loadData();
      }
    };

    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [loadData]);

  const handleRefreshInsight = useCallback(async () => {
    setInsightLoading(true);
    try {
      const result = await getInsight(true);
      setInsight(result?.insight || null);
    } catch {
      // keep existing insight
    } finally {
      setInsightLoading(false);
    }
  }, []);

  const handleVoiceResponse = useCallback(
    async (data) => {
      if (!data) {
        setVoiceStatus('No response from the assistant.');
        setToast({ type: 'error', message: 'No response from the assistant.' });
        return true;
      }
      
      if (data.action === "repeat") {
        if (lastCommandRef.current) {
          try {
            const response = await apiSendVoiceCommand(lastCommandRef.current);
            await handleVoiceResponse(response);
          } catch (err) {
            const message = err?.message || 'Voice command failed.';
            setVoiceStatus(message);
            setToast({ type: 'error', message });
          }
        } else {
          const msg = data.reply || data.message || 'No previous command to repeat.';
          setVoiceStatus(msg);
          setToast({ type: 'info', message: msg });
        }
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
        window.speechSynthesis.cancel();
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
          budget_status: data.dashboard.budget_status,
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

    let cancelled = false;

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
      if (cancelled) return;
      const transcript = event.results[0][0].transcript;
      if (transcript.toLowerCase().trim() !== "repeat") {
        lastCommandRef.current = transcript;
      }
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
      cancelled = true;
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
      if (payload.offline) {
        setPendingSyncCount((n) => n + 1);
        setToast({ type: 'info', message: 'Saved offline — will sync when connected.' });
        setNewExpense({ amount: '', category: newExpense.category });
      } else {
        setToast({ type: 'success', message: payload.message || 'Expense added.' });
        setNewExpense({ amount: '', category: newExpense.category });
        await loadData();
      }
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to add expense.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetBudget = async () => {
    const amountValue = Number(budgetForm.amount);
    if (!amountValue || amountValue <= 0) {
      setToast({ type: 'error', message: 'Enter a positive budget amount.' });
      return;
    }
    if (!budgetForm.category) {
      setToast({ type: 'error', message: 'Select a category for the budget.' });
      return;
    }
    setSubmitting(true);
    try {
      await apiSetBudget({
        limit: amountValue,
        category: budgetForm.category,
      });
      setToast({ type: 'success', message: `Budget for ${budgetForm.category} updated to ${formatINR(amountValue)}.` });
      setBudgetForm({ amount: '', category: budgetForm.category });
      await loadData();
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to set budget.' });
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
        const budgetInfo = userBudgets[item.category];
        const budget = budgetInfo ? budgetInfo.limit : 0;
        const percentage = budget > 0 ? Math.round((item.amount / budget) * 100) : 0;
        return {
          category: titleCase(item.category),
          total: item.amount,
          budget,
          percentage,
        };
      }),
    [categoryTotals, userBudgets],
  );

  const maxDaily = dailySpending.reduce((max, entry) => Math.max(max, entry.amount), 0) || 1;
  const maxMonthly = Math.max(monthlyTrend.reduce((max, entry) => Math.max(max, entry.amount), 0), forecast?.projected_total || 0) || 1;
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
        
        <UserHeader
          displayName={displayName}
          userEmail={userEmail}
          onLogout={onLogout}
          loggingEnabled={loggingEnabled}
          preferenceSaving={preferenceSaving}
          handlePreferenceToggle={handlePreferenceToggle}
        />

        {pendingSyncCount > 0 && (
          <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl flex items-center justify-between">
            <span className="text-sm">
              <strong>{pendingSyncCount}</strong> expense{pendingSyncCount !== 1 ? 's' : ''} saved offline — waiting to sync.
            </span>
            <button
              type="button"
              className="text-xs text-amber-700 underline"
              onClick={() => {
                if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                  navigator.serviceWorker.controller.postMessage({ type: 'TRIGGER_SYNC' });
                }
              }}
            >
              Sync now
            </button>
          </div>
        )}

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

        {/* AI Financial Insight */}
        {insight && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <span className="text-xl mt-0.5" role="img" aria-label="insight">💡</span>
              <div>
                <h4 className="font-semibold text-amber-900 text-sm">Weekly Spending Insight</h4>
                <p className="text-amber-800 text-sm mt-1">{insight}</p>
              </div>
            </div>
            <button
              onClick={handleRefreshInsight}
              disabled={insightLoading}
              className={`text-amber-700 hover:text-amber-900 hover:bg-amber-100 p-1.5 rounded-lg transition-colors flex-shrink-0 ${
                insightLoading ? 'animate-spin' : ''
              }`}
              aria-label="Refresh insight"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        )}

        
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="col-span-12 lg:col-span-5">
            <VoiceButton
              toggleRecording={toggleRecording}
              voiceProcessing={voiceProcessing}
              voiceConfirm={voiceConfirm}
              isRecording={isRecording}
              voiceStatus={voiceStatus}
            />
          </div>
          <SummaryDropdowns
            toggleSection={toggleSection}
            expandedSection={expandedSection}
            todayTotal={todayTotal}
            weeklyTotal={weeklyTotal}
            dailyAverage={dailyAverage}
            weeklyTopCategories={weeklyTopCategories}
            weeklySummaryLines={weeklySummaryLines}
            monthlyTotal={monthlyTotal}
            monthlySummaryLines={monthlySummaryLines}
            monthlyCategories={monthlyCategories}
            forecast={forecast}
          />
        </div>

        {/* Recurring Expenses Card */}
        {recurring.length > 0 && (
          <div className="app-card p-6 border-2 border-blue-200">
            <details>
              <summary className="text-xl font-bold text-blue-900 cursor-pointer list-none flex items-center justify-between">
                <span>🔁 Recurring Expenses <span className="text-sm font-normal text-blue-600 ml-2">{recurring.length} detected</span></span>
                <ChevronDown className="w-5 h-5 text-blue-600" />
              </summary>
              <div className="mt-4 space-y-4">
                {recurring.map((item, index) => {
                  const isOverdue = new Date(item.next_expected_date) < new Date();
                  const isDueSoon = !isOverdue && (new Date(item.next_expected_date) - new Date()) / 86400000 <= 5;
                  return (
                    <div key={`recurring-${index}`} className="flex items-center justify-between border-b border-blue-100 pb-3 last:border-0 last:pb-0">
                      <div>
                        <p className="font-semibold text-blue-900 capitalize">{item.category}</p>
                        <div className="flex items-center gap-2 mt-1 text-xs">
                          <span className="text-blue-500">Next expected: {item.next_expected_date}</span>
                          {isOverdue ? (
                            <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-semibold text-[10px]">OVERDUE</span>
                          ) : isDueSoon ? (
                            <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-semibold text-[10px]">DUE SOON</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-blue-800">{formatINR(item.representative_amount)}</p>
                        <span className="text-xs text-blue-500">{item.avg_gap_days}d gap · {item.confidence} confidence</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          </div>
        )}

        
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <CategoryPieChart categorySpending={categorySpending} />
          <DailyBarChart dailySpending={dailySpending} maxDaily={maxDaily} userBudgets={userBudgets} />
          <MonthlyBarChart monthlyTrend={monthlyTrend} maxMonthly={maxMonthly} forecast={forecast} />
        </div>

        
        <ExpenseTable
          recentExpenses={recentExpenses}
          loading={loading}
          expenseFilter={expenseFilter}
          setExpenseFilter={setExpenseFilter}
          getRecent={getRecent}
          setRecentExpenses={setRecentExpenses}
          mapRecentExpenses={mapRecentExpenses}
          editingId={editingId}
          setEditingId={setEditingId}
          editForm={editForm}
          setEditForm={setEditForm}
          apiUpdateExpense={apiUpdateExpense}
          setToast={setToast}
          loadData={loadData}
          categories={Object.keys(userBudgets).length > 0 ? Object.keys(userBudgets) : ['food', 'transport', 'utilities']}
        />

        
        <AddExpenseForm
          newExpense={newExpense}
          setNewExpense={setNewExpense}
          handleAddExpense={handleAddExpense}
          submitting={submitting}
          categories={Object.keys(userBudgets).length > 0 ? Object.keys(userBudgets) : ['food', 'transport', 'utilities']}
        />

        {/* Set Budget Widget */}
        <div className="app-card p-6 border-2 border-purple-200 mt-6 mb-6 bg-purple-50">
          <h3 className="text-xl font-bold text-purple-900 mb-4">Set Monthly Budget</h3>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <input
                type="number"
                placeholder="Amount (₹)"
                className="w-full rounded-lg border-2 border-purple-200 px-4 py-3 text-purple-900 focus:border-purple-500 focus:outline-none bg-white"
                value={budgetForm.amount}
                onChange={(e) => setBudgetForm({ ...budgetForm, amount: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSetBudget();
                }}
              />
            </div>
            <div className="flex-1 relative">
              <select
                className="w-full appearance-none rounded-lg border-2 border-purple-200 bg-white px-4 py-3 text-purple-900 focus:border-purple-500 focus:outline-none"
                value={budgetForm.category}
                onChange={(e) => setBudgetForm({ ...budgetForm, category: e.target.value })}
              >
                <option value="food">Food</option>
                <option value="transport">Transport</option>
                <option value="shopping">Shopping</option>
                <option value="entertainment">Entertainment</option>
                <option value="utilities">Utilities</option>
                <option value="health">Health</option>
                <option value="personal">Personal</option>
                <option value="other">Other</option>
              </select>
            </div>
            <button
              onClick={handleSetBudget}
              disabled={submitting}
              className={`px-8 py-3 rounded-lg font-semibold transition-colors shadow-md ${
                submitting
                  ? 'bg-purple-300 text-white cursor-not-allowed'
                  : 'bg-purple-600 text-white hover:bg-purple-700'
              }`}
            >
              {submitting ? 'Setting...' : 'Set Budget'}
            </button>
          </div>
        </div>

        
        <CategorySummary categoryData={categoryData} />
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
    <ErrorBoundary>
      <VoiceFinanceDashboard
        user={user}
        preferences={preferences}
        onLogout={logout}
        onToggleLogging={setLoggingPreference}
      />
    </ErrorBoundary>
  );
};

const App = () => (
  <AuthProvider>
    <ProtectedApp />
  </AuthProvider>
);

export default App;
