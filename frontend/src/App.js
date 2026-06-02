import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  Calendar,
  ChevronRight,
  LogOut,
  Mic,
  MicOff,
  PieChart,
  Plus,
  Settings,
  TrendingUp,
  Wallet,
  X,
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

// ─── Constants ────────────────────────────────────────────────────────────────

const RECENT_LIMIT = 20;

const CATEGORY_COLORS = {
  food:          { bg: 'bg-orange-100', dot: 'bg-orange-400',  text: 'text-orange-700',  hex: '#f97316' },
  transport:     { bg: 'bg-blue-100',   dot: 'bg-blue-400',    text: 'text-blue-700',    hex: '#3b82f6' },
  entertainment: { bg: 'bg-purple-100', dot: 'bg-purple-400',  text: 'text-purple-700',  hex: '#a855f7' },
  shopping:      { bg: 'bg-pink-100',   dot: 'bg-pink-400',    text: 'text-pink-700',    hex: '#ec4899' },
  utilities:     { bg: 'bg-teal-100',   dot: 'bg-teal-400',    text: 'text-teal-700',    hex: '#14b8a6' },
  health:        { bg: 'bg-green-100',  dot: 'bg-green-400',   text: 'text-green-700',   hex: '#22c55e' },
  personal:      { bg: 'bg-amber-100',  dot: 'bg-amber-400',   text: 'text-amber-700',   hex: '#f59e0b' },
  savings:       { bg: 'bg-indigo-100', dot: 'bg-indigo-400',  text: 'text-indigo-700',  hex: '#6366f1' },
  gifts:         { bg: 'bg-rose-100',   dot: 'bg-rose-400',    text: 'text-rose-700',    hex: '#f43f5e' },
  uncategorized: { bg: 'bg-slate-100',  dot: 'bg-slate-400',   text: 'text-slate-600',   hex: '#94a3b8' },
  other:         { bg: 'bg-slate-100',  dot: 'bg-slate-400',   text: 'text-slate-600',   hex: '#94a3b8' },
};

const BUDGET_GUESSES = {
  food: 10000, transport: 4000, entertainment: 3000,
  shopping: 5000, utilities: 5000, health: 3000,
  personal: 2000, gifts: 2000, savings: 6000,
  uncategorized: 2000, other: 2500,
};

const TABS = ['overview', 'transactions', 'budgets', 'settings'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(Number(n) || 0);

const titleCase = (s) =>
  s ? s.toString().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '';

const catStyle = (cat) =>
  CATEGORY_COLORS[(cat || '').toLowerCase()] || CATEGORY_COLORS.other;

const parseCurrencyValue = (line) => {
  if (!line) return null;
  const m = line.match(/₹\s*([\d,]+(?:\.\d+)?)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

const parseCategoryLine = (line) => {
  if (!line) return [];
  const [, list = ''] = line.split(':');
  return list.split(',').map((item) => {
    const t = item.trim();
    if (!t) return null;
    const m = t.match(/^(.*?)\s*\((?:₹)?([\d,]+(?:\.\d+)?)\)/i);
    if (!m) return { name: titleCase(t), amount: null };
    return { name: titleCase(m[1].trim()), amount: Number(m[2].replace(/,/g, '')) };
  }).filter(Boolean);
};

const parseWeeklySummary = (text) => {
  const lines = typeof text === 'string'
    ? text.split(/\n+/).map((l) => l.trim()).filter(Boolean) : [];
  return {
    total: parseCurrencyValue(lines.find((l) => l.toLowerCase().includes('weekly spend'))),
    dailyAverage: parseCurrencyValue(lines.find((l) => l.toLowerCase().includes('daily average'))),
    topCategories: parseCategoryLine(lines.find((l) => l.toLowerCase().includes('top categories'))),
    lines,
  };
};

const parseMonthlySummary = (text) => {
  const lines = typeof text === 'string'
    ? text.split(/\n+/).map((l) => l.trim()).filter(Boolean) : [];
  return {
    total: parseCurrencyValue(lines.find((l) => l.toLowerCase().includes('total'))),
    topCategories: parseCategoryLine(lines.find((l) => l.toLowerCase().includes('leading categories'))),
    lines,
  };
};

const normalizeCategoryTotals = (raw = []) => {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, i) => {
    if (Array.isArray(entry)) {
      return { key: `${entry[0]}-${i}`, category: (entry[0] || '').toLowerCase(), amount: Number(entry[1]) || 0 };
    }
    if (entry && typeof entry === 'object') {
      return {
        key: entry.id ?? `cat-${i}`,
        category: (entry.category ?? entry[0] ?? '').toString().toLowerCase(),
        amount: Number(entry.total ?? entry.amount ?? entry[1] ?? 0) || 0,
      };
    }
    return null;
  }).filter(Boolean);
};

const mapRecentExpenses = (raw = []) =>
  raw.map((item, i) => ({
    id: item.id ?? `expense-${i}`,
    date: item.date ?? '',
    time: item.time ?? '',
    amount: Number(item.amount ?? 0) || 0,
    category: item.category ? item.category.toString() : 'uncategorized',
    description: item.description ?? '',
  }));

const normalizeDailyChart = (raw = []) => {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, i) => {
    if (!entry) return null;
    return { day: entry.label ?? entry.day ?? `Day ${i + 1}`, amount: Number(entry.total ?? entry.amount ?? 0) || 0 };
  }).filter(Boolean);
};

const normalizeMonthlyChart = (raw = []) => {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, i) => {
    if (!entry) return null;
    return { label: entry.label ?? entry.month ?? `Month ${i + 1}`, amount: Number(entry.total ?? entry.amount ?? 0) || 0 };
  }).filter(Boolean);
};

const normalizeCategoryChart = (raw = []) => {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, i) => {
    if (!entry) return null;
    const key = (entry.category ?? entry.name ?? `cat-${i}`).toString();
    return { category: key, amount: Number(entry.total ?? entry.amount ?? 0) || 0 };
  }).filter(Boolean);
};

const computeDailySpending = (expenses = []) => {
  const today = new Date();
  return Array.from({ length: 7 }, (_, offset) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - offset));
    const key = d.toISOString().slice(0, 10);
    return {
      key,
      day: d.toLocaleDateString('en-IN', { weekday: 'short' }),
      amount: expenses.filter((e) => e.date === key).reduce((s, e) => s + e.amount, 0),
    };
  });
};

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ toast, onDismiss }) {
  if (!toast) return null;
  const styles = {
    success: 'bg-emerald-600 text-white',
    error: 'bg-red-600 text-white',
    info: 'bg-slate-800 text-white',
  };
  return (
    <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg ${styles[toast.type] || styles.info}`}>
      {toast.message}
      <button onClick={onDismiss} className="opacity-70 hover:opacity-100 ml-1">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Alert Banner ─────────────────────────────────────────────────────────────

function AlertBanner({ alerts, onDismiss }) {
  if (!alerts || alerts.length === 0) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex gap-3 items-start">
      <Bell className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
      <div className="flex-1 space-y-0.5">
        {alerts.slice(0, 3).map((msg, i) => (
          <p key={i} className="text-xs text-amber-800">{msg}</p>
        ))}
      </div>
      <button onClick={onDismiss} className="text-amber-400 hover:text-amber-600">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, iconBg }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">{label}</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
}

// ─── Mic Button ───────────────────────────────────────────────────────────────

function MicButton({ isRecording, processing, onToggle, status }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={onToggle}
        disabled={processing}
        aria-pressed={isRecording}
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
        className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-400
          ${processing ? 'bg-slate-300 cursor-not-allowed' :
            isRecording ? 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-200' :
            'bg-slate-900 hover:bg-slate-700 shadow-lg shadow-slate-200'}`}
      >
        {isRecording && (
          <span className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-30" />
        )}
        {isRecording
          ? <MicOff className="w-8 h-8 text-white relative z-10" />
          : <Mic className="w-8 h-8 text-white relative z-10" />}
      </button>
      <p className="text-sm font-medium text-slate-500">
        {processing ? 'Processing…' : isRecording ? 'Tap to stop' : 'Tap to speak'}
      </p>
      {status && (
        <div className="px-3 py-1.5 bg-slate-100 rounded-full text-xs text-slate-600 font-medium text-center max-w-[220px] truncate">
          {status}
        </div>
      )}
    </div>
  );
}

// ─── Spark Bar (7-day) ────────────────────────────────────────────────────────

function SparkBar({ data }) {
  const max = Math.max(...data.map((d) => d.amount), 1);
  return (
    <div className="flex items-end gap-1.5 h-16">
      {data.map((d, i) => {
        const pct = (d.amount / max) * 100;
        const isHigh = d.amount > max * 0.75;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
            <div className="w-full relative" style={{ height: 52 }}>
              <div
                className={`absolute bottom-0 w-full rounded-sm transition-all ${isHigh ? 'bg-orange-400' : 'bg-slate-200 group-hover:bg-slate-300'}`}
                style={{ height: `${Math.max(pct, 4)}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-400">{d.day}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Donut Chart ──────────────────────────────────────────────────────────────

function DonutChart({ data, total }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">Add expenses to see breakdown</p>;
  }
  const safeTotal = total || data.reduce((s, d) => s + d.amount, 0) || 1;
  let angle = -90;
  const segments = data.map((d) => {
    const sweep = (d.amount / safeTotal) * 360;
    const start = angle;
    angle += sweep;
    return { ...d, sweep, startAngle: start };
  });

  const polar = (a, r) => ({
    x: 50 + r * Math.cos((a * Math.PI) / 180),
    y: 50 + r * Math.sin((a * Math.PI) / 180),
  });

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 100 100" className="w-28 h-28 flex-shrink-0">
        {segments.map((seg, i) => {
          const color = catStyle(seg.category).hex;
          const percentage = (seg.sweep / 360) * 100;
          if (percentage >= 99.99) {
            return (
              <circle
                key={i}
                cx="50"
                cy="50"
                r="40"
                fill={color}
                stroke="white"
                strokeWidth="1.5"
              />
            );
          }
          const s = polar(seg.startAngle, 38);
          const e = polar(seg.startAngle + seg.sweep - 0.5, 38);
          const large = seg.sweep > 180 ? 1 : 0;
          return (
            <path
              key={i}
              d={`M50 50 L${s.x} ${s.y} A38 38 0 ${large} 1 ${e.x} ${e.y}Z`}
              fill={color}
              stroke="white"
              strokeWidth="1.5"
            />
          );
        })}
        <circle cx="50" cy="50" r="23" fill="white" />
        <text x="50" y="46" textAnchor="middle" fill="#94a3b8" fontSize="5.5" fontFamily="system-ui">TOTAL</text>
        <text x="50" y="56" textAnchor="middle" fill="#1e293b" fontSize="7" fontWeight="bold" fontFamily="system-ui">
          {fmt(safeTotal)}
        </text>
      </svg>
      <div className="flex-1 space-y-1.5 min-w-0">
        {data.slice(0, 5).map((d, i) => {
          const style = catStyle(d.category);
          const pct = safeTotal > 0 ? Math.round((d.amount / safeTotal) * 100) : 0;
          return (
            <div key={i} className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
                <span className="text-slate-600 truncate">{titleCase(d.category)}</span>
              </div>
              <span className="font-semibold text-slate-700 tabular-nums flex-shrink-0">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Monthly Bars ─────────────────────────────────────────────────────────────

function MonthlyBars({ data }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">No monthly data yet</p>;
  }
  const max = Math.max(...data.map((d) => d.amount), 1);
  return (
    <div className="flex items-end gap-2" style={{ height: 90 }}>
      {data.map((d, i) => {
        const pct = (d.amount / max) * 100;
        const isLatest = i === data.length - 1;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
            <span className={`text-[9px] tabular-nums transition-opacity ${isLatest ? 'opacity-100 text-slate-600 font-semibold' : 'opacity-0 group-hover:opacity-100 text-slate-400'}`}>
              {fmt(d.amount)}
            </span>
            <div className="w-full relative flex-1">
              <div
                className={`absolute bottom-0 w-full rounded-sm transition-all ${isLatest ? 'bg-slate-900' : 'bg-slate-200 group-hover:bg-slate-300'}`}
                style={{ height: `${Math.max(pct, 3)}%` }}
              />
            </div>
            <span className={`text-[10px] ${isLatest ? 'font-semibold text-slate-700' : 'text-slate-400'}`}>
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Budget Row ───────────────────────────────────────────────────────────────

function BudgetRow({ category, spent, budget }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const over = spent > budget;
  const warn = !over && pct >= 80;
  const style = catStyle(category);
  return (
    <div className="py-3 border-b border-slate-50 last:border-0">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${style.dot}`} />
          <span className="text-sm font-medium text-slate-800">{titleCase(category)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 tabular-nums">
            {fmt(spent)} <span className="text-slate-300">/</span> {fmt(budget)}
          </span>
          {over && (
            <span className="text-[10px] font-semibold text-white bg-red-500 px-1.5 py-0.5 rounded">Over</span>
          )}
          {warn && !over && (
            <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">Alert</span>
          )}
        </div>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${over ? 'bg-red-400' : warn ? 'bg-amber-400' : 'bg-emerald-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Transaction Row ──────────────────────────────────────────────────────────

function TransactionRow({ expense }) {
  const style = catStyle(expense.category);
  return (
    <div className="flex items-center gap-3 py-3 border-b border-slate-50 last:border-0">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${style.bg}`}>
        <div className={`w-2.5 h-2.5 rounded-full ${style.dot}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">
          {expense.description || titleCase(expense.category)}
        </p>
        <p className="text-xs text-slate-400">{expense.date}{expense.time ? ` · ${expense.time}` : ''}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-semibold text-slate-900 tabular-nums">−{fmt(expense.amount)}</p>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>
          {titleCase(expense.category)}
        </span>
      </div>
    </div>
  );
}

// ─── Add Expense Form ─────────────────────────────────────────────────────────

function AddExpenseForm({ onAdd, onCancel, submitting }) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('food');

  const handleSubmit = (e) => {
    e.preventDefault();
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    onAdd(n, category);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">Add expense</h3>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Amount (₹)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
            <input
              type="number"
              min="1"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full pl-7 pr-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-transparent"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
          >
            {Object.keys(BUDGET_GUESSES).filter((c) => c !== 'uncategorized').map((c) => (
              <option key={c} value={c}>{titleCase(c)}</option>
            ))}
          </select>
        </div>
      </div>
      <button
        type="submit"
        disabled={!amount || parseFloat(amount) <= 0 || submitting}
        className="w-full py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-xl hover:bg-slate-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {submitting ? (
          <span className="animate-pulse">Adding…</span>
        ) : (
          <><Plus className="w-4 h-4" /> Add Expense</>
        )}
      </button>
    </form>
  );
}

// ─── Tab Bar ──────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }) {
  const labels = { overview: 'Overview', transactions: 'Transactions', budgets: 'Budgets', settings: 'Settings' };
  return (
    <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5">
      {TABS.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
            active === tab
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {labels[tab]}
        </button>
      ))}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

const VoiceFinanceDashboard = ({ user, preferences = {}, onLogout, onToggleLogging }) => {
  const [summary, setSummary]               = useState(null);
  const [recentExpenses, setRecentExpenses] = useState([]);
  const [chartCategories, setChartCategories] = useState([]);
  const [chartDaily, setChartDaily]         = useState([]);
  const [chartMonthly, setChartMonthly]     = useState([]);
  const [isRecording, setIsRecording]       = useState(false);
  const [voiceStatus, setVoiceStatus]       = useState('');
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceConfirm, setVoiceConfirm]     = useState(null);
  const [tab, setTab]                       = useState('overview');
  const [showAddForm, setShowAddForm]       = useState(false);
  const [submitting, setSubmitting]         = useState(false);
  const [loading, setLoading]               = useState(true);
  const [toast, setToast]                   = useState(null);
  const [budgetWarning, setBudgetWarning]   = useState(null);
  const [alertsDismissed, setAlertsDismissed] = useState(false);
  const [prefSaving, setPrefSaving]         = useState(false);

  const recognitionRef = useRef(null);
  const toastTimer     = useRef(null);

  const displayName = user?.display_name || user?.displayName || user?.email || 'You';
  const loggingEnabled = Boolean(preferences?.log_opt_in);

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [sumR, recR, catR, dayR, monR] = await Promise.allSettled([
        getSummary(), getRecent(RECENT_LIMIT),
        getCategoryBreakdown(), getDailyTotals(7), getMonthlyTotals(6),
      ]);
      if (sumR.status === 'fulfilled') setSummary(sumR.value);
      if (recR.status === 'fulfilled') {
        const p = recR.value;
        const items = Array.isArray(p) ? p : Array.isArray(p?.items) ? p.items : Array.isArray(p?.recent) ? p.recent : [];
        setRecentExpenses(mapRecentExpenses(items));
      }
      if (catR.status === 'fulfilled') setChartCategories(catR.value?.items || catR.value?.data || []);
      if (dayR.status === 'fulfilled') setChartDaily(dayR.value?.items || dayR.value?.data || []);
      if (monR.status === 'fulfilled') setChartMonthly(monR.value?.items || monR.value?.data || []);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Toast helper ─────────────────────────────────────────────────────────────

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  // ── Voice handling ───────────────────────────────────────────────────────────

  const handleVoiceResponse = useCallback(async (data) => {
    if (!data) { showToast('No response from assistant.', 'error'); return true; }
    const reply = data.reply || data.message || 'Command processed.';
    const isErr = data.error || data.success === false;
    setVoiceStatus(reply);
    showToast(reply, isErr ? 'error' : 'info');

    if (data.budget_alert) setBudgetWarning(data.budget_alert);
    else if (!isErr) setBudgetWarning(null);

    if ('speechSynthesis' in window && reply && reply.length <= 160) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(reply));
    }

    const options = data.options || data.option_list || data.clarification_options;
    if ((data.needs_confirmation || data.needsClarification) && Array.isArray(options) && options.length) {
      setVoiceConfirm({ title: data.confirmation_prompt || 'Please confirm', message: reply, options });
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
        const c = data.dashboard.chart_series;
        setChartCategories(Array.isArray(c.category_breakdown) ? c.category_breakdown : []);
        setChartDaily(Array.isArray(c.daily_totals) ? c.daily_totals : []);
        setChartMonthly(Array.isArray(c.monthly_totals) ? c.monthly_totals : []);
      } else { await loadData(); }
    } else if (!isErr) { await loadData(); }
    return true;
  }, [loadData, showToast]);

  const sendVoice = useCallback(async (text) => {
    setVoiceProcessing(true);
    try {
      const res = await apiSendVoiceCommand(text);
      await handleVoiceResponse(res);
    } catch (err) {
      const msg = err?.message || 'Voice command failed.';
      setVoiceStatus(msg);
      showToast(msg, 'error');
    } finally {
      setVoiceProcessing(false);
    }
  }, [handleVoiceResponse, showToast]);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { recognitionRef.current = null; return; }
    const r = new SR();
    r.lang = 'en-IN';
    r.continuous = false;
    r.interimResults = false;
    r.onstart = () => { setIsRecording(true); setVoiceStatus('Listening…'); };
    r.onerror = (e) => {
      setIsRecording(false); setVoiceProcessing(false);
      setVoiceStatus(e.error === 'no-speech' ? 'No speech detected.' : `Error: ${e.error}`);
    };
    r.onend = () => setIsRecording(false);
    r.onresult = (e) => {
      const t = e.results[0][0].transcript;
      setVoiceStatus(`Heard: "${t}"`);
      sendVoice(t);
    };
    recognitionRef.current = r;
    return () => r.stop();
  }, [sendVoice]);

  const toggleRecording = useCallback(() => {
    if (voiceProcessing || voiceConfirm) return;
    const r = recognitionRef.current;
    if (!r) { setVoiceStatus('Voice not supported in this browser.'); return; }
    if (isRecording) { r.stop(); return; }
    try { r.start(); } catch (_) {}
  }, [isRecording, voiceConfirm, voiceProcessing]);

  // ── Add expense ──────────────────────────────────────────────────────────────

  const handleAddExpense = useCallback(async (amount, category) => {
    setSubmitting(true);
    try {
      const res = await apiAddExpense({ amount, category });
      showToast(res.message || `Added ${fmt(amount)} to ${titleCase(category)}`, 'success');
      setShowAddForm(false);
      await loadData();
    } catch (err) {
      showToast(err.message || 'Failed to add expense.', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [loadData, showToast]);

  // ── Derived data ─────────────────────────────────────────────────────────────

  const weeklySummary  = useMemo(() => parseWeeklySummary(summary?.weekly_summary), [summary?.weekly_summary]);
  const monthlySummary = useMemo(() => parseMonthlySummary(summary?.monthly_summary), [summary?.monthly_summary]);
  const categoryTotals = useMemo(() => normalizeCategoryTotals(summary?.category_totals), [summary?.category_totals]);

  const todayTotal   = summary ? Number(summary.total_today) || 0 : 0;
  const monthlyTotal = summary?.monthly_total ?? monthlySummary.total ?? 0;
  const weeklyTotal  = weeklySummary.total ?? 0;
  const budgetAlerts = useMemo(() => {
    const alerts = Array.isArray(summary?.budget_alerts) ? summary.budget_alerts : [];
    if (budgetWarning && !alerts.includes(budgetWarning)) return [budgetWarning, ...alerts];
    return alerts;
  }, [summary?.budget_alerts, budgetWarning]);

  const dailySpending = useMemo(() => {
    const fromApi = normalizeDailyChart(chartDaily);
    return fromApi.length > 0 ? fromApi : computeDailySpending(recentExpenses);
  }, [chartDaily, recentExpenses]);

  const categorySpending = useMemo(() => {
    const fromApi = normalizeCategoryChart(chartCategories);
    if (fromApi.length > 0) return fromApi;
    return categoryTotals.map((t) => ({ category: t.category, amount: t.amount }));
  }, [chartCategories, categoryTotals]);

  const monthlyTrend = useMemo(() => normalizeMonthlyChart(chartMonthly), [chartMonthly]);

  const budgetData = useMemo(() =>
    categoryTotals
      .filter((t) => t.amount > 0)
      .map((t) => ({ category: t.category, spent: t.amount, budget: BUDGET_GUESSES[t.category] ?? 2500 })),
    [categoryTotals]
  );

  // ── Settings ─────────────────────────────────────────────────────────────────

  const handleToggleLogging = useCallback(async () => {
    setPrefSaving(true);
    try {
      await onToggleLogging(!loggingEnabled);
      showToast(loggingEnabled ? 'Logging disabled.' : 'Logging enabled.', 'success');
    } catch { showToast('Failed to update preference.', 'error'); }
    finally { setPrefSaving(false); }
  }, [loggingEnabled, onToggleLogging, showToast]);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Header */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-slate-900 rounded-lg flex items-center justify-center">
              <Activity className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-900 tracking-tight">Voxly</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-600">
              <div className="w-6 h-6 bg-slate-200 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-600">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <span className="font-medium">{displayName}</span>
            </div>
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {/* Budget alerts */}
        {!alertsDismissed && budgetAlerts.length > 0 && (
          <AlertBanner alerts={budgetAlerts} onDismiss={() => setAlertsDismissed(true)} />
        )}

        {/* Voice + stat cards row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {/* Mic card — spans 2 cols on small, 1 on large */}
          <div className="col-span-2 sm:col-span-1 bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col items-center justify-center gap-4 min-h-[180px]">
            <MicButton
              isRecording={isRecording}
              processing={voiceProcessing}
              onToggle={toggleRecording}
              status={voiceStatus}
            />
          </div>

          <StatCard label="Today" value={fmt(todayTotal)} icon={Wallet} iconBg="bg-orange-400" />
          <StatCard label="This week" value={fmt(weeklyTotal)} icon={Calendar} iconBg="bg-blue-500" />
          <StatCard label="This month" value={fmt(monthlyTotal)} icon={TrendingUp} iconBg="bg-violet-500" />
        </div>

        {/* 7-day spark bar */}
        {dailySpending.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Last 7 days</p>
            <SparkBar data={dailySpending} />
          </div>
        )}

        {/* Tab navigation */}
        <TabBar active={tab} onChange={setTab} />

        {/* ── Overview tab ── */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Donut */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                  <PieChart className="w-4 h-4 text-slate-400" />
                  <h3 className="text-sm font-semibold text-slate-700">Spending breakdown</h3>
                </div>
                <DonutChart data={categorySpending} total={monthlyTotal} />
              </div>

              {/* Monthly trend */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="w-4 h-4 text-slate-400" />
                  <h3 className="text-sm font-semibold text-slate-700">Monthly trend</h3>
                </div>
                <MonthlyBars data={monthlyTrend} />
              </div>
            </div>

            {/* Recent (preview) */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-700">Recent transactions</h3>
                {loading && <span className="text-xs text-slate-400 animate-pulse">Refreshing…</span>}
              </div>
              {recentExpenses.length === 0
                ? <p className="text-sm text-slate-400 py-4 text-center">No expenses yet</p>
                : <>
                    {recentExpenses.slice(0, 5).map((e) => <TransactionRow key={e.id} expense={e} />)}
                    <button
                      onClick={() => setTab('transactions')}
                      className="w-full mt-3 text-xs text-slate-400 hover:text-slate-700 flex items-center justify-center gap-1 transition-colors"
                    >
                      View all <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </>
              }
            </div>
          </div>
        )}

        {/* ── Transactions tab ── */}
        {tab === 'transactions' && (
          <div className="space-y-4">
            {!showAddForm ? (
              <button
                onClick={() => setShowAddForm(true)}
                className="w-full py-2.5 border-2 border-dashed border-slate-200 rounded-2xl text-sm font-medium text-slate-400 hover:border-slate-300 hover:text-slate-600 flex items-center justify-center gap-2 transition-colors"
              >
                <Plus className="w-4 h-4" /> Add expense manually
              </button>
            ) : (
              <AddExpenseForm
                onAdd={handleAddExpense}
                onCancel={() => setShowAddForm(false)}
                submitting={submitting}
              />
            )}

            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-700">All transactions</h3>
                <span className="text-xs text-slate-400">{recentExpenses.length} entries</span>
              </div>
              <div className="overflow-y-auto max-h-[480px]">
                {recentExpenses.length === 0
                  ? <p className="text-sm text-slate-400 py-6 text-center">No expenses logged yet</p>
                  : recentExpenses.map((e) => <TransactionRow key={e.id} expense={e} />)
                }
              </div>
            </div>
          </div>
        )}

        {/* ── Budgets tab ── */}
        {tab === 'budgets' && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-700">Monthly budgets</h3>
              <span className="text-xs text-slate-400">Resets each month</span>
            </div>

            {budgetData.length === 0
              ? <p className="text-sm text-slate-400 py-6 text-center">Add expenses to see budget tracking</p>
              : budgetData.map((b) => (
                  <BudgetRow key={b.category} {...b} />
                ))
            }

            <p className="text-xs text-slate-400 mt-4 pt-4 border-t border-slate-50 leading-relaxed">
              Use voice commands to update budgets — e.g.{' '}
              <em className="text-slate-500">"set budget for transport to 5000 warn me at 75 percent"</em>
            </p>
          </div>
        )}

        {/* ── Settings tab ── */}
        {tab === 'settings' && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-5">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-700">Preferences</h3>
            </div>

            <div className="border border-slate-100 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Voice command logging</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Store transcripts to debug misheard commands. Nothing logged unless you opt in.
                  </p>
                </div>
                <button
                  onClick={handleToggleLogging}
                  disabled={prefSaving}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
                    loggingEnabled ? 'bg-slate-900 border-slate-900' : 'bg-slate-200 border-slate-200'
                  } ${prefSaving ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${loggingEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>

            <div className="border border-slate-100 rounded-xl p-4 space-y-1">
              <p className="text-sm font-semibold text-slate-800">Voice commands</p>
              <div className="space-y-1 mt-2">
                {[
                  'Add 500 to food',
                  'What\'s my balance today?',
                  'Delete last expense',
                  'Show recent expenses',
                  'Give weekly summary',
                  'Set budget for food to 8000',
                ].map((cmd) => (
                  <div key={cmd} className="flex items-center gap-2">
                    <span className="text-slate-300">›</span>
                    <span className="text-xs text-slate-600 font-mono">{cmd}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="text-xs text-slate-400">Voxly 1.0 · Voice Finance Tracker</div>
          </div>
        )}

      </main>

      <ConfirmDialog
        open={Boolean(voiceConfirm)}
        title={voiceConfirm?.title}
        message={voiceConfirm?.message}
        options={voiceConfirm?.options || []}
        onConfirm={(opt) => {
          setVoiceConfirm(null);
          const cmd = opt?.value || opt?.command || opt?.text || opt?.label || opt;
          if (cmd) sendVoice(String(cmd));
        }}
        onCancel={() => { setVoiceConfirm(null); setVoiceStatus('Command cancelled.'); }}
      />
    </div>
  );
};

// ─── Auth screen ──────────────────────────────────────────────────────────────

const AuthScreen = () => {
  const { login, register } = useAuth();
  const [mode, setMode]     = useState('login');
  const [form, setForm]     = useState({ email: '', password: '', name: '', confirmPassword: '' });
  const [error, setError]   = useState(null);
  const [submitting, setSub] = useState(false);

  const onChange = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.email || !form.password) { setError('Email and password are required.'); return; }
    if (mode === 'register' && form.password !== form.confirmPassword) { setError('Passwords must match.'); return; }
    setSub(true);
    try {
      if (mode === 'login') await login({ email: form.email, password: form.password });
      else await register({ email: form.email, password: form.password, name: form.name });
    } catch (err) {
      setError(err?.message || 'Authentication failed.');
    } finally { setSub(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-100 shadow-lg p-8 space-y-6">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center">
            <Activity className="w-4.5 h-4.5 text-white w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-none">Voxly</h1>
            <p className="text-xs text-slate-500">Voice Finance Tracker</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2.5 rounded-xl">{error}</div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Email</label>
            <input
              name="email" type="email" autoComplete="email" required
              value={form.email} onChange={onChange}
              placeholder="you@example.com"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-transparent"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Display name</label>
              <input
                name="name" type="text"
                value={form.name} onChange={onChange}
                placeholder="e.g. Priya"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-transparent"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Password</label>
            <input
              name="password" type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required
              value={form.password} onChange={onChange}
              placeholder="Enter a strong password"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-transparent"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Confirm password</label>
              <input
                name="confirmPassword" type="password" required
                value={form.confirmPassword} onChange={onChange}
                placeholder="Re-enter your password"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-transparent"
              />
            </div>
          )}

          <button
            type="submit" disabled={submitting}
            className="w-full py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-xl hover:bg-slate-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-500">
          {mode === 'login' ? 'Need an account?' : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
            className="font-semibold text-slate-900 hover:underline"
          >
            {mode === 'login' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
};

// ─── Loading ──────────────────────────────────────────────────────────────────

const LoadingScreen = () => (
  <div className="min-h-screen bg-slate-50 flex items-center justify-center">
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-8 py-6 text-sm text-slate-500 animate-pulse">
      Loading your workspace…
    </div>
  </div>
);

// ─── Root ─────────────────────────────────────────────────────────────────────

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
