import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Mic,
  MicOff,
  TrendingUp,
  Calendar,
  Wallet,
  PieChart,
  BarChart3,
  Plus,
  Sun,
  Moon,
  LogOut,
  Settings,
  Bell,
  ChevronRight,
  ChevronDown,
  Activity,
  Home,
  X,
  AlertTriangle,
  CheckCircle,
  Info,
  Menu,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
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

const CATEGORY_COLORS = {
  food: { light: '#0ea5e9', dark: '#38bdf8' },
  transport: { light: '#8b5cf6', dark: '#a78bfa' },
  entertainment: { light: '#f59e0b', dark: '#fbbf24' },
  shopping: { light: '#ec4899', dark: '#f472b6' },
  utilities: { light: '#10b981', dark: '#34d399' },
  health: { light: '#ef4444', dark: '#f87171' },
  personal: { light: '#6366f1', dark: '#818cf8' },
  gifts: { light: '#14b8a6', dark: '#2dd4bf' },
  savings: { light: '#22c55e', dark: '#4ade80' },
  uncategorized: { light: '#94a3b8', dark: '#cbd5e1' },
  other: { light: '#64748b', dark: '#94a3b8' },
};

const getCategoryColor = (category, isDark) => {
  const key = (category || '').toLowerCase();
  return (CATEGORY_COLORS[key] || CATEGORY_COLORS.other)[isDark ? 'dark' : 'light'];
};

const formatINR = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value));
};

const formatINRDecimal = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '₹0.00';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
};

const titleCase = (value) =>
  value
    ? value.toString().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : '';

const parseCurrencyValue = (line) => {
  if (!line) return null;
  const match = line.match(/₹\s*([\d,]+(?:\.\d+)?)/);
  if (!match) return null;
  return Number(match[1].replace(/,/g, ''));
};

const parseCategoryLine = (line) => {
  if (!line) return [];
  const [, listPart = ''] = line.split(':');
  return listPart
    .split(',')
    .map((item) => {
      const trimmed = item.trim();
      if (!trimmed) return null;
      const match = trimmed.match(/^(.*?)\s*\((?:₹)?([\d,]+(?:\.\d+)?)\)/i);
      if (!match) return { name: titleCase(trimmed), amount: null };
      return { name: titleCase(match[1].trim()), amount: Number(match[2].replace(/,/g, '')) };
    })
    .filter(Boolean);
};

const parseWeeklySummary = (text) => {
  const lines =
    typeof text === 'string'
      ? text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
      : [];
  const totalLine = lines.find((l) => l.toLowerCase().includes('weekly spend'));
  const avgLine = lines.find((l) => l.toLowerCase().includes('daily average'));
  const categoriesLine = lines.find((l) => l.toLowerCase().includes('top categories'));
  return {
    total: parseCurrencyValue(totalLine),
    dailyAverage: parseCurrencyValue(avgLine),
    topCategories: parseCategoryLine(categoriesLine),
    lines,
  };
};

const parseMonthlySummary = (text) => {
  const lines =
    typeof text === 'string'
      ? text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
      : [];
  const totalLine = lines.find((l) => l.toLowerCase().includes('total'));
  const categoriesLine = lines.find((l) => l.toLowerCase().includes('leading categories'));
  return {
    total: parseCurrencyValue(totalLine),
    topCategories: parseCategoryLine(categoriesLine),
    lines,
  };
};

const normalizeCategoryTotals = (raw = []) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry, index) => {
      if (Array.isArray(entry)) {
        return { key: entry[0] ?? `cat-${index}`, category: (entry[0] || '').toString().toLowerCase(), amount: Number(entry[1]) || 0 };
      }
      if (entry && typeof entry === 'object') {
        const category = (entry.category ?? entry[0] ?? '').toString().toLowerCase();
        const amount = Number(entry.total ?? entry.amount ?? entry[1] ?? 0) || 0;
        return { key: entry.id ?? `cat-${index}`, category, amount };
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
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry, index) => {
      if (!entry) return null;
      const key = (entry.category ?? entry.name ?? `category-${index}`).toString();
      const amount = Number(entry.total ?? entry.amount ?? 0) || 0;
      return { key, category: titleCase(key), amount };
    })
    .filter(Boolean);
};

const normalizeDailyChart = (raw = []) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry, index) => {
      if (!entry) return null;
      const label = entry.label ?? entry.day ?? `Day ${index + 1}`;
      const amount = Number(entry.total ?? entry.amount ?? 0) || 0;
      return { day: label, amount };
    })
    .filter(Boolean);
};

const normalizeMonthlyChart = (raw = []) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry, index) => {
      if (!entry) return null;
      const label = entry.label ?? entry.month ?? `Month ${index + 1}`;
      const amount = Number(entry.total ?? entry.amount ?? 0) || 0;
      return { label, amount };
    })
    .filter(Boolean);
};

const computeDailySpending = (expenses = []) => {
  const today = new Date();
  const buckets = [];
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = date.toISOString().slice(0, 10);
    buckets.push({ key, day: date.toLocaleDateString('en-IN', { weekday: 'short' }), amount: 0 });
  }
  const indexByKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
  expenses.forEach((e) => {
    const bucket = indexByKey[e.date];
    if (bucket) bucket.amount += Number(e.amount) || 0;
  });
  return buckets.map(({ day, amount }) => ({ day, amount }));
};

// ─── Theme hook ──────────────────────────────────────────────────────────────
const useTheme = () => {
  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem('voxly_theme');
    if (stored) return stored === 'dark';
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('voxly_theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  return [isDark, () => setIsDark((d) => !d)];
};

// ─── Stat Card ────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, sub, icon: Icon, trend, color = 'blue', isDark }) => {
  const colorMap = {
    blue: { bg: isDark ? '#1e3a5f' : '#eff6ff', icon: isDark ? '#60a5fa' : '#2563eb', text: isDark ? '#93c5fd' : '#1d4ed8' },
    green: { bg: isDark ? '#14532d' : '#f0fdf4', icon: isDark ? '#4ade80' : '#16a34a', text: isDark ? '#86efac' : '#15803d' },
    amber: { bg: isDark ? '#451a03' : '#fffbeb', icon: isDark ? '#fbbf24' : '#d97706', text: isDark ? '#fcd34d' : '#b45309' },
    purple: { bg: isDark ? '#2e1065' : '#faf5ff', icon: isDark ? '#c084fc' : '#9333ea', text: isDark ? '#d8b4fe' : '#7e22ce' },
  };
  const c = colorMap[color] || colorMap.blue;
  return (
    <div style={{
      background: isDark ? '#1e2433' : '#ffffff',
      border: `1px solid ${isDark ? '#2d3748' : '#e5e7eb'}`,
      borderRadius: 12,
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: isDark ? '#94a3b8' : '#6b7280', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          {label}
        </span>
        <div style={{ background: c.bg, borderRadius: 8, padding: '6px', display: 'flex' }}>
          <Icon size={16} color={c.icon} />
        </div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: isDark ? '#f1f5f9' : '#0f172a', lineHeight: 1 }}>
        {value}
      </div>
      {(sub || trend !== undefined) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          {trend !== undefined && (
            trend >= 0
              ? <ArrowUpRight size={12} color="#22c55e" />
              : <ArrowDownRight size={12} color="#ef4444" />
          )}
          <span style={{ color: isDark ? '#64748b' : '#9ca3af' }}>{sub}</span>
        </div>
      )}
    </div>
  );
};

// ─── Budget Status Badge ──────────────────────────────────────────────────────
const BudgetBar = ({ category, spent, budget, isDark }) => {
  const pct = budget ? Math.min((spent / budget) * 100, 100) : 0;
  const isOver = pct >= 100;
  const isWarn = pct >= 80 && !isOver;
  const barColor = isOver ? '#ef4444' : isWarn ? '#f59e0b' : '#22c55e';
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: isDark ? '#cbd5e1' : '#374151' }}>{titleCase(category)}</span>
        <span style={{ fontSize: 12, color: isDark ? '#94a3b8' : '#6b7280' }}>
          {formatINR(spent)} <span style={{ color: isDark ? '#475569' : '#d1d5db' }}>/</span> {formatINR(budget)}
          <span style={{
            marginLeft: 6,
            fontWeight: 600,
            color: isOver ? '#ef4444' : isWarn ? '#f59e0b' : isDark ? '#4ade80' : '#16a34a',
          }}>{Math.round(pct)}%</span>
        </span>
      </div>
      <div style={{ height: 6, background: isDark ? '#334155' : '#f1f5f9', borderRadius: 99 }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: barColor,
          borderRadius: 99,
          transition: 'width 0.6s ease',
        }} />
      </div>
    </div>
  );
};

// ─── Alert Banner ─────────────────────────────────────────────────────────────
const AlertBanner = ({ type = 'info', message, onDismiss, isDark }) => {
  const styles = {
    warning: { bg: isDark ? '#451a03' : '#fffbeb', border: isDark ? '#78350f' : '#fde68a', text: isDark ? '#fcd34d' : '#92400e', icon: AlertTriangle },
    error: { bg: isDark ? '#450a0a' : '#fef2f2', border: isDark ? '#7f1d1d' : '#fecaca', text: isDark ? '#fca5a5' : '#991b1b', icon: AlertTriangle },
    success: { bg: isDark ? '#052e16' : '#f0fdf4', border: isDark ? '#14532d' : '#bbf7d0', text: isDark ? '#86efac' : '#15803d', icon: CheckCircle },
    info: { bg: isDark ? '#0c1a2e' : '#eff6ff', border: isDark ? '#1e3a5f' : '#bfdbfe', text: isDark ? '#93c5fd' : '#1d4ed8', icon: Info },
  };
  const s = styles[type] || styles.info;
  const Icon = s.icon;
  return (
    <div style={{
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderRadius: 10,
      padding: '10px 14px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      marginBottom: 8,
    }}>
      <Icon size={16} color={s.text} style={{ marginTop: 1, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: s.text, flex: 1, lineHeight: 1.5 }}>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: s.text, opacity: 0.6, display: 'flex' }}>
          <X size={14} />
        </button>
      )}
    </div>
  );
};

// ─── Voice Button ─────────────────────────────────────────────────────────────
const VoiceButton = ({ isRecording, voiceProcessing, voiceConfirm, onClick, voiceStatus, isDark }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '32px 0' }}>
      <div style={{ position: 'relative' }}>
        {isRecording && (
          <>
            <div style={{
              position: 'absolute', inset: -16,
              borderRadius: '50%',
              border: '2px solid rgba(239,68,68,0.4)',
              animation: 'voicePulse 1.5s ease-out infinite',
            }} />
            <div style={{
              position: 'absolute', inset: -8,
              borderRadius: '50%',
              border: '2px solid rgba(239,68,68,0.6)',
              animation: 'voicePulse 1.5s ease-out infinite 0.3s',
            }} />
          </>
        )}
        <button
          onClick={onClick}
          disabled={voiceProcessing || Boolean(voiceConfirm)}
          aria-pressed={isRecording}
          aria-label={isRecording ? 'Stop listening' : 'Start voice command'}
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            border: 'none',
            cursor: voiceProcessing || voiceConfirm ? 'not-allowed' : 'pointer',
            background: isRecording
              ? 'linear-gradient(135deg, #ef4444, #dc2626)'
              : voiceProcessing
              ? isDark ? '#374151' : '#d1d5db'
              : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.15s, box-shadow 0.15s',
            boxShadow: isRecording
              ? '0 0 0 4px rgba(239,68,68,0.2)'
              : '0 4px 20px rgba(37,99,235,0.35)',
          }}
        >
          {isRecording ? <MicOff size={32} color="white" /> : <Mic size={32} color="white" />}
        </button>
      </div>

      <div style={{ textAlign: 'center' }}>
        <p style={{
          fontSize: 14,
          fontWeight: 600,
          color: isRecording ? '#ef4444' : isDark ? '#e2e8f0' : '#1e293b',
          margin: '0 0 4px',
        }}>
          {voiceProcessing ? 'Processing…' : isRecording ? 'Listening' : 'Tap to speak'}
        </p>
        <p style={{
          fontSize: 12,
          color: isDark ? '#64748b' : '#9ca3af',
          margin: 0,
          minHeight: 20,
          maxWidth: 240,
          textAlign: 'center',
        }}>
          {voiceStatus || '"Add 500 to food" · "Weekly summary"'}
        </p>
      </div>

      {/* Animated equalizer when recording */}
      {isRecording && (
        <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 24 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{
              width: 4,
              background: '#ef4444',
              borderRadius: 2,
              animation: `voiceBar${i} 0.8s ease-in-out infinite`,
            }} />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Section Card ─────────────────────────────────────────────────────────────
const SectionCard = ({ title, icon: Icon, children, action, isDark, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: isDark ? '#1e2433' : '#ffffff',
      border: `1px solid ${isDark ? '#2d3748' : '#e5e7eb'}`,
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          borderBottom: open ? `1px solid ${isDark ? '#2d3748' : '#f3f4f6'}` : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {Icon && <Icon size={16} color={isDark ? '#60a5fa' : '#2563eb'} />}
          <span style={{ fontSize: 14, fontWeight: 600, color: isDark ? '#e2e8f0' : '#111827' }}>{title}</span>
          {action && <span style={{ fontSize: 12, color: isDark ? '#64748b' : '#9ca3af' }}>{action}</span>}
        </div>
        <ChevronDown
          size={16}
          color={isDark ? '#64748b' : '#9ca3af'}
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
        />
      </button>
      {open && <div style={{ padding: '16px 20px' }}>{children}</div>}
    </div>
  );
};

// ─── Main Dashboard ───────────────────────────────────────────────────────────
const VoiceFinanceDashboard = ({ user, preferences = {}, onLogout, onToggleLogging }) => {
  const [isDark, toggleDark] = useTheme();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [summary, setSummary] = useState(null);
  const [recentExpenses, setRecentExpenses] = useState([]);
  const [chartCategories, setChartCategories] = useState([]);
  const [chartDaily, setChartDaily] = useState([]);
  const [chartMonthly, setChartMonthly] = useState([]);

  const [isRecording, setIsRecording] = useState(false);
  const [newExpense, setNewExpense] = useState({ amount: '', category: 'food', description: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceConfirm, setVoiceConfirm] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [budgetWarnings, setBudgetWarnings] = useState([]);
  const [preferenceSaving, setPreferenceSaving] = useState(false);

  const recognitionRef = useRef(null);
  const toastTimerRef = useRef({});

  const displayName = user?.display_name || user?.email || 'You';
  const loggingEnabled = Boolean(preferences?.log_opt_in);

  const addToast = useCallback((type, message) => {
    const id = Date.now();
    setToasts((prev) => [...prev.slice(-2), { id, type, message }]);
    toastTimerRef.current[id] = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const loadData = useCallback(async () => {
    if (!user) return;
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

      if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value);
      else setSummary(null);

      if (recentResult.status === 'fulfilled') {
        const payload = recentResult.value;
        const items = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.recent) ? payload.recent : [];
        setRecentExpenses(mapRecentExpenses(items));
      } else setRecentExpenses([]);

      if (categoryResult.status === 'fulfilled') {
        const items = categoryResult.value?.items || categoryResult.value?.data || [];
        setChartCategories(Array.isArray(items) ? items : []);
      } else setChartCategories([]);

      if (dailyResult.status === 'fulfilled') {
        const items = dailyResult.value?.items || dailyResult.value?.data || [];
        setChartDaily(Array.isArray(items) ? items : []);
      } else setChartDaily([]);

      if (monthlyResult.status === 'fulfilled') {
        const items = monthlyResult.value?.items || monthlyResult.value?.data || [];
        setChartMonthly(Array.isArray(items) ? items : []);
      } else setChartMonthly([]);

    } catch (err) {
      setError(err.message || 'Unable to load data.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleVoiceResponse = useCallback(async (data) => {
    if (!data) { addToast('error', 'No response from assistant.'); return; }
    const replyMessage = data.reply || data.message || 'Command processed.';
    const isError = data.error || data.success === false;
    setVoiceStatus(replyMessage);
    addToast(isError ? 'error' : 'success', replyMessage);

    if (data.budget_alert) setBudgetWarnings((prev) => [...new Set([...prev, data.budget_alert])]);
    else if (Array.isArray(data?.dashboard?.budget_alerts) && data.dashboard.budget_alerts.length > 0) {
      setBudgetWarnings(data.dashboard.budget_alerts);
    }

    if (replyMessage && 'speechSynthesis' in window && replyMessage.length <= 160) {
      const utter = new SpeechSynthesisUtterance(replyMessage);
      window.speechSynthesis.speak(utter);
    }

    const options = data.options || data.option_list || data.clarification_options;
    const needsConfirmation = data.needs_confirmation || data.needsClarification || data.request_confirmation;
    if (needsConfirmation && Array.isArray(options) && options.length > 0) {
      setVoiceConfirm({ title: data.confirmation_prompt || 'Confirm command', message: replyMessage, options });
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
      } else await loadData();
    } else if (!isError) await loadData();
    return true;
  }, [addToast, loadData]);

  const handleVoiceConfirmSelect = useCallback(async (option) => {
    setVoiceConfirm(null);
    const cmd = option?.value || option?.command || option?.text || option?.label || option;
    if (!cmd || (typeof cmd === 'string' && !cmd.trim())) { setVoiceStatus('Cancelled.'); return; }
    setVoiceProcessing(true);
    try {
      const response = await apiSendVoiceCommand(String(cmd));
      await handleVoiceResponse(response);
    } catch (err) {
      addToast('error', err?.message || 'Voice command failed.');
    } finally { setVoiceProcessing(false); }
  }, [handleVoiceResponse, addToast]);

  const handleVoiceConfirmCancel = useCallback(() => {
    setVoiceConfirm(null);
    setVoiceStatus('Cancelled.');
  }, []);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { recognitionRef.current = null; return; }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => { setIsRecording(true); setVoiceStatus('Listening…'); };
    recognition.onerror = (e) => {
      setIsRecording(false);
      setVoiceProcessing(false);
      setVoiceStatus(e.error === 'no-speech' ? 'No speech detected.' : `Error: ${e.error}`);
    };
    recognition.onend = () => setIsRecording(false);
    recognition.onresult = async (e) => {
      const transcript = e.results[0][0].transcript;
      setVoiceStatus(`"${transcript}"`);
      setVoiceProcessing(true);
      try {
        const response = await apiSendVoiceCommand(transcript);
        await handleVoiceResponse(response);
      } catch (err) {
        addToast('error', err?.message || 'Voice command failed.');
        setVoiceConfirm(null);
      }
      setVoiceProcessing(false);
    };
    recognitionRef.current = recognition;
    return () => recognition.stop();
  }, [handleVoiceResponse, addToast]);

  const toggleRecording = () => {
    if (voiceProcessing || voiceConfirm) return;
    const recognition = recognitionRef.current;
    if (!recognition) { addToast('error', 'Voice not supported in this browser.'); return; }
    if (isRecording) { recognition.stop(); return; }
    setVoiceStatus('Preparing…');
    try { recognition.start(); } catch { setVoiceStatus('Could not access microphone.'); }
  };

  const handleAddExpense = async () => {
    const amountValue = Number(newExpense.amount);
    if (!amountValue || amountValue <= 0) { addToast('error', 'Enter a valid amount.'); return; }
    if (!newExpense.category) { addToast('error', 'Select a category.'); return; }
    setSubmitting(true);
    try {
      const payload = await apiAddExpense({ amount: amountValue, category: newExpense.category, description: newExpense.description });
      addToast('success', payload.message || 'Expense added.');
      setNewExpense({ amount: '', category: newExpense.category, description: '' });
      await loadData();
    } catch (err) {
      addToast('error', err.message || 'Failed to add expense.');
    } finally { setSubmitting(false); }
  };

  const handlePreferenceToggle = useCallback(async () => {
    if (!user) return;
    setPreferenceSaving(true);
    try {
      const next = !loggingEnabled;
      await onToggleLogging(next);
      addToast('success', next ? 'Command logging enabled.' : 'Command logging disabled.');
    } catch (err) {
      addToast('error', err.message || 'Unable to update preference.');
    } finally { setPreferenceSaving(false); }
  }, [loggingEnabled, onToggleLogging, user, addToast]);

  // Computed values
  const weeklySummaryData = useMemo(() => parseWeeklySummary(summary?.weekly_summary), [summary?.weekly_summary]);
  const monthlySummaryData = useMemo(() => parseMonthlySummary(summary?.monthly_summary), [summary?.monthly_summary]);
  const categoryTotals = useMemo(() => normalizeCategoryTotals(summary?.category_totals), [summary?.category_totals]);

  const todayTotal = summary ? Number(summary.total_today) || 0 : 0;
  const monthlyTotal = summary?.monthly_total ?? monthlySummaryData.total ?? 0;

  const categorySpending = useMemo(() => {
    const fromApi = normalizeCategoryChart(chartCategories);
    if (fromApi.length > 0) return fromApi;
    return categoryTotals.map((item) => ({ category: titleCase(item.category), amount: item.amount, key: item.category }));
  }, [chartCategories, categoryTotals]);

  const dailySpending = useMemo(() => {
    const fromApi = normalizeDailyChart(chartDaily);
    if (fromApi.length > 0) return fromApi;
    return computeDailySpending(recentExpenses);
  }, [chartDaily, recentExpenses]);

  const monthlyTrend = useMemo(() => normalizeMonthlyChart(chartMonthly), [chartMonthly]);

  const categoryData = useMemo(() =>
    categoryTotals.map((item) => {
      const budget = BUDGET_GUESSES[item.category] ?? 4000;
      return { category: item.category, total: item.amount, budget };
    }), [categoryTotals]);

  const maxDaily = useMemo(() => Math.max(...dailySpending.map((d) => d.amount), 1), [dailySpending]);
  const maxMonthly = useMemo(() => Math.max(...monthlyTrend.map((m) => m.amount), 1), [monthlyTrend]);

  const bg = isDark ? '#0f1623' : '#f8fafc';
  const cardBg = isDark ? '#1e2433' : '#ffffff';
  const borderColor = isDark ? '#2d3748' : '#e5e7eb';
  const textPrimary = isDark ? '#f1f5f9' : '#0f172a';
  const textSecondary = isDark ? '#94a3b8' : '#6b7280';
  const textMuted = isDark ? '#475569' : '#d1d5db';

  const navItems = [
    { id: 'dashboard', icon: Home, label: 'Dashboard' },
    { id: 'analytics', icon: BarChart3, label: 'Analytics' },
    { id: 'expenses', icon: Wallet, label: 'Expenses' },
    { id: 'budget', icon: Activity, label: 'Budget' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  // ─── Sidebar ────────────────────────────────────────────────────────────────
  const Sidebar = ({ mobile = false }) => (
    <nav style={{
      width: mobile ? '100%' : 220,
      background: isDark ? '#141924' : '#1e3a8a',
      display: 'flex',
      flexDirection: mobile ? 'row' : 'column',
      padding: mobile ? '8px 8px' : '24px 12px',
      gap: mobile ? 4 : 4,
      flexShrink: 0,
      ...(mobile ? { borderTop: `1px solid ${isDark ? '#2d3748' : '#1e40af'}` } : {}),
    }}>
      {!mobile && (
        <div style={{ padding: '0 8px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, background: '#3b82f6', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={18} color="white" />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'white' }}>Voxly</p>
              <p style={{ margin: 0, fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.08em' }}>FINANCE</p>
            </div>
          </div>
        </div>
      )}
      {navItems.map((item) => {
        const active = activeTab === item.id;
        return (
          <button
            key={item.id}
            onClick={() => { setActiveTab(item.id); if (mobile) setSidebarOpen(false); }}
            style={{
              display: 'flex',
              flexDirection: mobile ? 'column' : 'row',
              alignItems: 'center',
              gap: mobile ? 4 : 10,
              padding: mobile ? '6px 4px' : '10px 12px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              flex: mobile ? 1 : 'none',
              background: active ? 'rgba(255,255,255,0.15)' : 'transparent',
              color: active ? 'white' : 'rgba(255,255,255,0.55)',
              fontSize: mobile ? 10 : 14,
              fontWeight: active ? 600 : 400,
              transition: 'all 0.15s',
            }}
          >
            <item.icon size={mobile ? 20 : 18} />
            {item.label}
          </button>
        );
      })}
      {!mobile && (
        <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <button
            onClick={onLogout}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              borderRadius: 8, border: 'none', cursor: 'pointer', background: 'transparent',
              color: 'rgba(255,255,255,0.55)', fontSize: 14, width: '100%',
            }}
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      )}
    </nav>
  );

  // ─── Dashboard Tab ──────────────────────────────────────────────────────────
  const DashboardTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <StatCard label="Today's Spend" value={formatINR(todayTotal)} icon={Wallet} color="blue" isDark={isDark} />
        <StatCard label="This Month" value={formatINR(monthlyTotal)} icon={Calendar} color="purple" isDark={isDark}
          sub={weeklySummaryData.dailyAverage ? `Avg ${formatINR(weeklySummaryData.dailyAverage)}/day` : undefined} />
        <StatCard label="Weekly Total" value={weeklySummaryData.total != null ? formatINR(weeklySummaryData.total) : '—'} icon={TrendingUp} color="green" isDark={isDark} />
        <StatCard label="Categories" value={categorySpending.length || '—'} icon={PieChart} color="amber" isDark={isDark} sub="active this month" />
      </div>

      {/* Alerts */}
      {(budgetWarnings.length > 0 || (summary?.budget_alerts?.length > 0)) && (
        <div>
          {budgetWarnings.map((w, i) => (
            <AlertBanner key={`bw-${i}`} type="warning" message={w} isDark={isDark}
              onDismiss={() => setBudgetWarnings((prev) => prev.filter((_, idx) => idx !== i))} />
          ))}
          {(summary?.budget_alerts || []).map((a, i) => (
            <AlertBanner key={`ba-${i}`} type="warning" message={a} isDark={isDark} />
          ))}
        </div>
      )}

      {/* Voice + Daily chart row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.6fr)', gap: 12 }}>
        {/* Voice card */}
        <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px 0', borderBottom: `1px solid ${borderColor}` }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: textPrimary }}>Voice Assistant</p>
            <p style={{ margin: '2px 0 12px', fontSize: 11, color: textSecondary }}>Natural language commands</p>
          </div>
          <VoiceButton isRecording={isRecording} voiceProcessing={voiceProcessing} voiceConfirm={voiceConfirm}
            onClick={toggleRecording} voiceStatus={voiceStatus} isDark={isDark} />
          {/* Quick commands */}
          <div style={{ padding: '0 16px 16px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {['Add 500 food', 'Weekly summary', 'My budget', 'Delete last'].map((cmd) => (
              <button key={cmd} onClick={async () => {
                setVoiceProcessing(true);
                try { const r = await apiSendVoiceCommand(cmd); await handleVoiceResponse(r); }
                catch (err) { addToast('error', err.message || 'Failed.'); }
                finally { setVoiceProcessing(false); }
              }} style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 99,
                background: isDark ? '#1e3a5f' : '#eff6ff',
                border: `1px solid ${isDark ? '#2563eb' : '#bfdbfe'}`,
                color: isDark ? '#93c5fd' : '#1d4ed8',
                cursor: 'pointer', fontWeight: 500,
              }}>{cmd}</button>
            ))}
          </div>
        </div>

        {/* Daily spend chart */}
        <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 12, padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: textPrimary }}>Daily Spending</p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: textSecondary }}>Last 7 days</p>
            </div>
            <BarChart3 size={16} color={textMuted} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
            {dailySpending.map((day, idx) => {
              const height = maxDaily ? (day.amount / maxDaily) * 100 : 0;
              const isToday = idx === dailySpending.length - 1;
              const isOver = day.amount > 1500;
              return (
                <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                  <div
                    title={formatINRDecimal(day.amount)}
                    style={{
                      width: '100%',
                      height: `${height}%`,
                      minHeight: day.amount > 0 ? 4 : 0,
                      background: isOver ? '#ef4444' : isToday ? '#2563eb' : isDark ? '#3b4d6a' : '#bfdbfe',
                      borderRadius: '4px 4px 0 0',
                      transition: 'height 0.4s ease',
                      cursor: 'pointer',
                    }}
                  />
                  <span style={{ fontSize: 10, color: textSecondary }}>{day.day}</span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 12, fontSize: 11, color: textSecondary }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: '#2563eb', display: 'inline-block' }} />Today
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: '#ef4444', display: 'inline-block' }} />Over budget
            </span>
          </div>
        </div>
      </div>

      {/* Recent expenses */}
      <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 12 }}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${borderColor}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: textPrimary }}>Recent Expenses</p>
          {loading && <span style={{ fontSize: 11, color: textSecondary }}>Refreshing…</span>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          {recentExpenses.length === 0 ? (
            <p style={{ textAlign: 'center', color: textSecondary, fontSize: 13, padding: '24px 0' }}>No expenses yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Date', 'Amount', 'Category', 'Description'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 600, color: textSecondary, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: `1px solid ${borderColor}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentExpenses.slice(0, 8).map((exp) => (
                  <tr key={exp.id} style={{ borderBottom: `1px solid ${isDark ? '#1e2d42' : '#f9fafb'}` }}>
                    <td style={{ padding: '10px 16px', fontSize: 13, color: textSecondary }}>{exp.date || '—'}</td>
                    <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, color: textPrimary }}>{formatINRDecimal(exp.amount)}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{
                        padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                        background: `${getCategoryColor(exp.category, isDark)}22`,
                        color: getCategoryColor(exp.category, isDark),
                      }}>{titleCase(exp.category)}</span>
                    </td>
                    <td style={{ padding: '10px 16px', fontSize: 13, color: textSecondary }}>{exp.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );

  // ─── Analytics Tab ──────────────────────────────────────────────────────────
  const AnalyticsTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {/* Category donut */}
        <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 12, padding: '16px 20px' }}>
          <p style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 600, color: textPrimary }}>Category Breakdown</p>
          {categorySpending.length === 0 ? (
            <p style={{ textAlign: 'center', color: textSecondary, fontSize: 13, padding: '32px 0' }}>Add expenses to see breakdown.</p>
          ) : (() => {
            const total = categorySpending.reduce((s, c) => s + c.amount, 0) || 1;
            let cumulative = 0;
            const segments = categorySpending.map((cat) => {
              const pct = cat.amount / total;
              const startAngle = cumulative * 360;
              cumulative += pct;
              const endAngle = cumulative * 360;
              return { ...cat, pct, startAngle, endAngle };
            });
            const toXY = (angle, r) => {
              const rad = ((angle - 90) * Math.PI) / 180;
              return [50 + r * Math.cos(rad), 50 + r * Math.sin(rad)];
            };
            return (
              <>
                <svg viewBox="0 0 100 100" style={{ width: 140, height: 140, display: 'block', margin: '0 auto 16px' }}>
                  {segments.map((seg, idx) => {
                    const [x1, y1] = toXY(seg.startAngle, 40);
                    const [x2, y2] = toXY(seg.endAngle, 40);
                    const largeArc = seg.endAngle - seg.startAngle > 180 ? 1 : 0;
                    return (
                      <path key={idx}
                        d={`M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`}
                        fill={getCategoryColor(seg.key || seg.category, isDark)}
                        stroke={isDark ? '#1e2433' : 'white'}
                        strokeWidth="1.5"
                      />
                    );
                  })}
                  <circle cx="50" cy="50" r="22" fill={isDark ? '#1e2433' : 'white'} />
                  <text x="50" y="46" textAnchor="middle" fontSize="8" fill={textSecondary}>Total</text>
                  <text x="50" y="56" textAnchor="middle" fontSize="7" fontWeight="600" fill={textPrimary}>
                    {formatINR(total)}
                  </text>
                </svg>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {categorySpending.map((cat, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 3, background: getCategoryColor(cat.key || cat.category, isDark), flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: textSecondary }}>{cat.category}</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: textPrimary }}>{formatINR(cat.amount)}</span>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>

        {/* Monthly trend */}
        <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 12, padding: '16px 20px' }}>
          <p style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 600, color: textPrimary }}>Monthly Trend</p>
          {monthlyTrend.length === 0 ? (
            <p style={{ textAlign: 'center', color: textSecondary, fontSize: 13, padding: '32px 0' }}>No monthly data yet.</p>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
                {monthlyTrend.map((month, idx) => {
                  const height = maxMonthly ? (month.amount / maxMonthly) * 100 : 0;
                  const isLast = idx === monthlyTrend.length - 1;
                  return (
                    <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                      <div title={`${month.label}: ${formatINRDecimal(month.amount)}`} style={{
                        width: '100%',
                        height: `${height}%`,
                        minHeight: month.amount > 0 ? 4 : 0,
                        background: isLast
                          ? isDark ? '#3b82f6' : '#2563eb'
                          : isDark ? '#1e3a5f' : '#dbeafe',
                        borderRadius: '4px 4px 0 0',
                        transition: 'height 0.4s ease',
                      }} />
                      <span style={{ fontSize: 9, color: textSecondary, textAlign: 'center', lineHeight: 1.2 }}>
                        {month.label.replace(' 20', ' ')}
                      </span>
                    </div>
                  );
                })}
              </div>
              {monthlyTrend.length >= 2 && (() => {
                const curr = monthlyTrend[monthlyTrend.length - 1].amount;
                const prev = monthlyTrend[monthlyTrend.length - 2].amount;
                const diff = curr - prev;
                const pct = prev > 0 ? Math.abs((diff / prev) * 100).toFixed(0) : null;
                return (
                  <p style={{ margin: '12px 0 0', fontSize: 12, color: diff >= 0 ? '#ef4444' : '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {diff >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                    {diff >= 0 ? '+' : ''}{formatINR(diff)} {pct && `(${pct}%)`} vs last month
                  </p>
                );
              })()}
            </>
          )}
        </div>
      </div>

      {/* Weekly summary panel */}
      <SectionCard title="Weekly Summary" icon={TrendingUp} isDark={isDark} defaultOpen>
        {weeklySummaryData.lines.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {weeklySummaryData.lines.map((line, i) => (
              <p key={i} style={{ margin: 0, fontSize: 13, color: textSecondary, lineHeight: 1.6 }}>{line}</p>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: textSecondary }}>Add expenses to generate weekly insights.</p>
        )}
      </SectionCard>

      <SectionCard title="Monthly Summary" icon={Calendar} isDark={isDark}>
        {monthlySummaryData.lines.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {monthlySummaryData.lines.map((line, i) => (
              <p key={i} style={{ margin: 0, fontSize: 13, color: textSecondary, lineHeight: 1.6 }}>{line}</p>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: textSecondary }}>Monthly data will appear after expenses are logged.</p>
        )}
      </SectionCard>
    </div>
  );

  // ─── Expenses Tab ───────────────────────────────────────────────────────────
  const ExpensesTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Add form */}
      <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 12, padding: '20px' }}>
        <p style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: textPrimary, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Plus size={16} color={isDark ? '#60a5fa' : '#2563eb'} />
          Add Expense
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: textSecondary, marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Amount (₹)
            </label>
            <input
              type="number"
              value={newExpense.amount}
              onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
              placeholder="0"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '10px 12px', borderRadius: 8,
                border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                background: isDark ? '#111827' : '#f9fafb',
                color: textPrimary, fontSize: 14,
                outline: 'none',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: textSecondary, marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Category
            </label>
            <select
              value={newExpense.category}
              onChange={(e) => setNewExpense({ ...newExpense, category: e.target.value })}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '10px 12px', borderRadius: 8,
                border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                background: isDark ? '#111827' : '#f9fafb',
                color: textPrimary, fontSize: 14,
                outline: 'none',
              }}
            >
              {['food', 'transport', 'entertainment', 'shopping', 'utilities', 'health', 'personal', 'other'].map((c) => (
                <option key={c} value={c}>{titleCase(c)}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: textSecondary, marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Note (optional)
            </label>
            <input
              type="text"
              value={newExpense.description}
              onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
              placeholder="e.g. lunch with team"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '10px 12px', borderRadius: 8,
                border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                background: isDark ? '#111827' : '#f9fafb',
                color: textPrimary, fontSize: 14,
                outline: 'none',
              }}
            />
          </div>
        </div>
        <button
          onClick={handleAddExpense}
          disabled={submitting}
          style={{
            padding: '10px 24px', borderRadius: 8, border: 'none',
            background: submitting ? (isDark ? '#374151' : '#e5e7eb') : '#2563eb',
            color: submitting ? textSecondary : 'white',
            fontSize: 14, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Adding…' : 'Add Expense'}
        </button>
      </div>

      {/* All recent expenses table */}
      <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 12 }}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${borderColor}` }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: textPrimary }}>Expense History</p>
        </div>
        <div style={{ overflowX: 'auto' }}>
          {recentExpenses.length === 0 ? (
            <p style={{ textAlign: 'center', color: textSecondary, fontSize: 13, padding: '32px 0' }}>No expenses yet. Add one above.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Date', 'Time', 'Amount', 'Category', 'Description'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 600, color: textSecondary, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: `1px solid ${borderColor}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentExpenses.map((exp) => (
                  <tr key={exp.id} style={{ borderBottom: `1px solid ${isDark ? '#1a2030' : '#f9fafb'}` }}>
                    <td style={{ padding: '10px 16px', fontSize: 13, color: textSecondary }}>{exp.date || '—'}</td>
                    <td style={{ padding: '10px 16px', fontSize: 12, color: textMuted }}>{exp.time || '—'}</td>
                    <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700, color: textPrimary }}>{formatINRDecimal(exp.amount)}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{
                        padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                        background: `${getCategoryColor(exp.category, isDark)}22`,
                        color: getCategoryColor(exp.category, isDark),
                      }}>{titleCase(exp.category)}</span>
                    </td>
                    <td style={{ padding: '10px 16px', fontSize: 13, color: textSecondary }}>{exp.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );

  // ─── Budget Tab ─────────────────────────────────────────────────────────────
  const BudgetTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 12, padding: '20px' }}>
        <p style={{ margin: '0 0 20px', fontSize: 14, fontWeight: 600, color: textPrimary }}>Budget Status</p>
        {categoryData.length === 0 ? (
          <p style={{ color: textSecondary, fontSize: 13 }}>Add expenses to see budget tracking.</p>
        ) : (
          categoryData.map((cat) => (
            <BudgetBar key={cat.category} category={cat.category} spent={cat.total} budget={cat.budget} isDark={isDark} />
          ))
        )}
      </div>

      <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 12, padding: '16px 20px' }}>
        <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: textPrimary }}>Voice Budget Commands</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            '"Set budget for food to 8000"',
            '"Set budget for transport to 3000 warn me at 70 percent"',
            '"What\'s my food budget"',
            '"Remove budget for entertainment"',
          ].map((cmd) => (
            <div key={cmd} style={{
              padding: '8px 12px', borderRadius: 8,
              background: isDark ? '#111827' : '#f8fafc',
              border: `1px solid ${isDark ? '#1e2d42' : '#e5e7eb'}`,
              fontSize: 12, color: textSecondary, fontFamily: 'monospace',
            }}>{cmd}</div>
          ))}
        </div>
      </div>
    </div>
  );

  // ─── Settings Tab ───────────────────────────────────────────────────────────
  const SettingsTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 12, padding: '20px' }}>
        <p style={{ margin: '0 0 20px', fontSize: 14, fontWeight: 600, color: textPrimary }}>Profile</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: isDark ? '#1e3a5f' : '#eff6ff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 700, color: isDark ? '#60a5fa' : '#2563eb',
          }}>
            {(displayName || 'U')[0].toUpperCase()}
          </div>
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: textPrimary }}>{displayName}</p>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: textSecondary }}>{user?.email || ''}</p>
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${borderColor}`, paddingTop: 16 }}>
          <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: textPrimary }}>Appearance</p>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: textSecondary }}>Toggle between light and dark theme.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={toggleDark} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
              background: isDark ? '#1e3a5f' : '#eff6ff',
              border: `1px solid ${isDark ? '#2563eb' : '#bfdbfe'}`,
              color: isDark ? '#93c5fd' : '#1d4ed8',
              fontSize: 13, fontWeight: 500,
            }}>
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
              {isDark ? 'Switch to Light' : 'Switch to Dark'}
            </button>
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${borderColor}`, paddingTop: 16, marginTop: 16 }}>
          <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: textPrimary }}>Voice Command Logging</p>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: textSecondary }}>Store transcripts to debug misheard commands. Opt-in only.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={handlePreferenceToggle}
              disabled={preferenceSaving}
              style={{
                width: 44, height: 24, borderRadius: 99, border: 'none', cursor: 'pointer',
                background: loggingEnabled ? '#2563eb' : isDark ? '#374151' : '#d1d5db',
                position: 'relative', transition: 'background 0.2s',
              }}
            >
              <span style={{
                position: 'absolute',
                top: 2, left: loggingEnabled ? 22 : 2,
                width: 20, height: 20,
                background: 'white',
                borderRadius: '50%',
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </button>
            <span style={{ fontSize: 13, color: textSecondary }}>
              {loggingEnabled ? 'Enabled' : 'Disabled'}{preferenceSaving && ' (saving…)'}
            </span>
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${borderColor}`, paddingTop: 16, marginTop: 16 }}>
          <button onClick={onLogout} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
            background: isDark ? '#450a0a' : '#fef2f2',
            border: `1px solid ${isDark ? '#7f1d1d' : '#fecaca'}`,
            color: isDark ? '#fca5a5' : '#dc2626',
            fontSize: 13, fontWeight: 500,
          }}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );

  const tabContent = {
    dashboard: <DashboardTab />,
    analytics: <AnalyticsTab />,
    expenses: <ExpensesTab />,
    budget: <BudgetTab />,
    settings: <SettingsTab />,
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; font-family: 'DM Sans', sans-serif; }
        input:focus, select:focus { outline: 2px solid #2563eb; outline-offset: 0; }
        @keyframes voicePulse { 0% { transform: scale(1); opacity: 0.8; } 100% { transform: scale(1.6); opacity: 0; } }
        @keyframes voiceBar1 { 0%,100% { height: 6px; } 50% { height: 18px; } }
        @keyframes voiceBar2 { 0%,100% { height: 10px; } 50% { height: 22px; } }
        @keyframes voiceBar3 { 0%,100% { height: 14px; } 50% { height: 10px; } }
        @keyframes voiceBar4 { 0%,100% { height: 8px; } 50% { height: 20px; } }
        @keyframes voiceBar5 { 0%,100% { height: 12px; } 50% { height: 8px; } }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${isDark ? '#374151' : '#d1d5db'}; border-radius: 99px; }
        @media (max-width: 640px) {
          .desktop-sidebar { display: none !important; }
          .mobile-bottom-nav { display: flex !important; }
        }
        @media (min-width: 641px) {
          .mobile-bottom-nav { display: none !important; }
        }
      `}</style>

      {/* Toast container */}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
        {toasts.map((toast) => {
          const colors = {
            success: { bg: isDark ? '#052e16' : '#f0fdf4', border: isDark ? '#166534' : '#86efac', text: isDark ? '#4ade80' : '#166534' },
            error: { bg: isDark ? '#450a0a' : '#fef2f2', border: isDark ? '#991b1b' : '#fecaca', text: isDark ? '#f87171' : '#991b1b' },
            info: { bg: isDark ? '#0c1a2e' : '#eff6ff', border: isDark ? '#1e40af' : '#bfdbfe', text: isDark ? '#93c5fd' : '#1d4ed8' },
          };
          const c = colors[toast.type] || colors.info;
          return (
            <div key={toast.id} style={{
              background: c.bg, border: `1px solid ${c.border}`,
              color: c.text, borderRadius: 10, padding: '10px 14px',
              fontSize: 13, maxWidth: 320, pointerEvents: 'auto',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              animation: 'slideIn 0.2s ease',
            }}>
              {toast.message}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', height: '100dvh', background: bg, overflow: 'hidden' }}>
        {/* Desktop sidebar */}
        <div className="desktop-sidebar" style={{ display: 'flex' }}>
          <Sidebar />
        </div>

        {/* Main content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Top bar */}
          <header style={{
            padding: '12px 20px',
            borderBottom: `1px solid ${borderColor}`,
            background: isDark ? '#141924' : '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Mobile logo */}
              <div style={{ display: 'none' }} className="mobile-only">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Zap size={20} color="#2563eb" />
                  <span style={{ fontSize: 16, fontWeight: 700, color: textPrimary }}>Voxly</span>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: textPrimary }}>
                {navItems.find((n) => n.id === activeTab)?.label}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={toggleDark}
                style={{
                  width: 34, height: 34, borderRadius: 8, border: `1px solid ${borderColor}`,
                  background: 'none', cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  color: textSecondary,
                }}
                aria-label="Toggle theme"
              >
                {isDark ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              <button
                onClick={loadData}
                style={{
                  width: 34, height: 34, borderRadius: 8, border: `1px solid ${borderColor}`,
                  background: 'none', cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  color: textSecondary,
                }}
                aria-label="Refresh data"
              >
                <Activity size={16} />
              </button>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: isDark ? '#1e3a5f' : '#eff6ff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color: isDark ? '#60a5fa' : '#2563eb',
              }}>
                {(displayName || 'U')[0].toUpperCase()}
              </div>
            </div>
          </header>

          {/* Scrollable body */}
          <main style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
            {error && (
              <AlertBanner type="error" message={error} isDark={isDark} onDismiss={() => setError(null)} />
            )}
            {tabContent[activeTab] || <DashboardTab />}
          </main>
        </div>

        {/* Mobile bottom nav */}
        <div className="mobile-bottom-nav" style={{ display: 'none' }}>
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100 }}>
            <Sidebar mobile />
          </div>
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
    </>
  );
};

// ─── Auth Screen ──────────────────────────────────────────────────────────────
const AuthScreen = () => {
  const { login, register } = useAuth();
  const [isDark] = useTheme();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', name: '', confirmPassword: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.email || !form.password) { setError('Email and password are required.'); return; }
    if (mode === 'register' && form.password !== form.confirmPassword) { setError('Passwords must match.'); return; }
    setSubmitting(true);
    try {
      if (mode === 'login') await login({ email: form.email, password: form.password });
      else await register({ email: form.email, password: form.password, name: form.name });
    } catch (err) {
      setError(err?.message || 'Authentication failed.');
    } finally { setSubmitting(false); }
  };

  const bg = isDark ? '#0f1623' : '#f8fafc';
  const cardBg = isDark ? '#1e2433' : '#ffffff';
  const borderColor = isDark ? '#2d3748' : '#e5e7eb';
  const textPrimary = isDark ? '#f1f5f9' : '#0f172a';
  const textSecondary = isDark ? '#94a3b8' : '#6b7280';

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; font-family: 'DM Sans', sans-serif; background: ${bg}; }
      `}</style>
      <div style={{ minHeight: '100dvh', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <div style={{ width: '100%', maxWidth: 380, background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 16, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '28px 28px 0', textAlign: 'center' }}>
            <div style={{ width: 44, height: 44, background: '#2563eb', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              <Zap size={24} color="white" />
            </div>
            <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: textPrimary }}>Voxly</h1>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: textSecondary }}>Voice-powered personal finance</p>
          </div>

          {/* Tab switcher */}
          <div style={{ display: 'flex', margin: '0 28px', background: isDark ? '#111827' : '#f3f4f6', borderRadius: 8, padding: 4, marginBottom: 20 }}>
            {['login', 'register'].map((m) => (
              <button key={m} onClick={() => { setMode(m); setError(null); }} style={{
                flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
                background: mode === m ? (isDark ? '#1e2433' : 'white') : 'transparent',
                color: mode === m ? textPrimary : textSecondary,
                fontSize: 13, fontWeight: mode === m ? 600 : 400, cursor: 'pointer',
                boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s',
              }}>
                {m === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <div style={{ padding: '0 28px 28px' }}>
            {error && (
              <div style={{ background: isDark ? '#450a0a' : '#fef2f2', border: `1px solid ${isDark ? '#7f1d1d' : '#fecaca'}`, color: isDark ? '#fca5a5' : '#dc2626', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 12 }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              {mode === 'register' && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: textSecondary, marginBottom: 6 }}>Display name</label>
                  <input name="name" type="text" value={form.name} onChange={handleChange} placeholder="Your name"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${borderColor}`, background: isDark ? '#111827' : '#f9fafb', color: textPrimary, fontSize: 14, outline: 'none' }} />
                </div>
              )}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: textSecondary, marginBottom: 6 }}>Email</label>
                <input name="email" type="email" required value={form.email} onChange={handleChange} placeholder="you@example.com" autoComplete="email"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${borderColor}`, background: isDark ? '#111827' : '#f9fafb', color: textPrimary, fontSize: 14, outline: 'none' }} />
              </div>
              <div style={{ marginBottom: mode === 'register' ? 12 : 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: textSecondary, marginBottom: 6 }}>Password</label>
                <input name="password" type="password" required value={form.password} onChange={handleChange} placeholder="Enter password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${borderColor}`, background: isDark ? '#111827' : '#f9fafb', color: textPrimary, fontSize: 14, outline: 'none' }} />
              </div>
              {mode === 'register' && (
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: textSecondary, marginBottom: 6 }}>Confirm password</label>
                  <input name="confirmPassword" type="password" required value={form.confirmPassword} onChange={handleChange} placeholder="Re-enter password"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${borderColor}`, background: isDark ? '#111827' : '#f9fafb', color: textPrimary, fontSize: 14, outline: 'none' }} />
                </div>
              )}
              <button type="submit" disabled={submitting} style={{
                width: '100%', padding: '11px 0', borderRadius: 8, border: 'none',
                background: submitting ? (isDark ? '#374151' : '#e5e7eb') : '#2563eb',
                color: submitting ? textSecondary : 'white',
                fontSize: 14, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer',
              }}>
                {submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
};

const LoadingScreen = () => {
  const [isDark] = useTheme();
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: isDark ? '#0f1623' : '#f8fafc' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, background: '#2563eb', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
          <Zap size={22} color="white" />
        </div>
        <p style={{ color: isDark ? '#94a3b8' : '#6b7280', fontSize: 14 }}>Loading your workspace…</p>
      </div>
    </div>
  );
};

const ProtectedApp = () => {
  const { user, initializing, logout, preferences, setLoggingPreference } = useAuth();
  if (initializing) return <LoadingScreen />;
  if (!user) return <AuthScreen />;
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