import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Mic,
  MicOff,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Calendar,
  Wallet,
  PieChart,
  BarChart3,
  Plus,
  X,
  Menu,
  User,
  LogOut,
  Settings,
  AlertCircle,
  CheckCircle,
  Info,
} from "lucide-react";

import {
  addExpense as apiAddExpense,
  getBudgets,
  getCategoryBreakdown,
  getDailyTotals,
  getMonthlyTotals,
  getRecent,
  getSummary,
  sendVoiceCommand as apiSendVoiceCommand,
} from "./api";
import ConfirmDialog from "./components/ConfirmDialog";
import ErrorBoundary from "./components/ErrorBoundary";
import { AuthProvider, useAuth } from "./context/AuthContext";

/* ─── Constants ─────────────────────────────────────────────────────────── */

const RECENT_LIMIT = 12;

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const formatINR = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value)))
    return "₹0.00";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
};

const titleCase = (value) =>
  value
    ? value
        .toString()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : "";

const parseCurrencyValue = (line) => {
  if (!line) return null;
  const match = line.match(/₹\s*([\d,]+(?:\.\d+)?)/);
  return match ? Number(match[1].replace(/,/g, "")) : null;
};

const parseCategoryLine = (line) => {
  if (!line) return [];
  const [, listPart = ""] = line.split(":");
  return listPart
    .split(",")
    .map((item) => {
      const trimmed = item.trim();
      if (!trimmed) return null;
      const match = trimmed.match(/^(.*?)\s*\((?:₹)?([\d,]+(?:\.\d+)?)\)/i);
      return match
        ? {
            name: titleCase(match[1].trim()),
            amount: Number(match[2].replace(/,/g, "")),
          }
        : { name: titleCase(trimmed), amount: null };
    })
    .filter(Boolean);
};

const parseWeeklySummary = (text) => {
  const lines =
    typeof text === "string"
      ? text
          .split(/\n+/)
          .map((l) => l.trim())
          .filter(Boolean)
      : [];
  return {
    total: parseCurrencyValue(
      lines.find((l) => l.toLowerCase().includes("weekly spend")),
    ),
    dailyAverage: parseCurrencyValue(
      lines.find((l) => l.toLowerCase().includes("daily average")),
    ),
    topCategories: parseCategoryLine(
      lines.find((l) => l.toLowerCase().includes("top categories")),
    ),
    lines,
  };
};

const parseMonthlySummary = (text) => {
  const lines =
    typeof text === "string"
      ? text
          .split(/\n+/)
          .map((l) => l.trim())
          .filter(Boolean)
      : [];
  return {
    total: parseCurrencyValue(
      lines.find((l) => l.toLowerCase().includes("total")),
    ),
    topCategories: parseCategoryLine(
      lines.find((l) => l.toLowerCase().includes("leading categories")),
    ),
    lines,
  };
};

const normalizeCategoryTotals = (raw = []) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry, i) => {
      if (Array.isArray(entry)) {
        return {
          key: entry[0] ?? `cat-${i}`,
          category: (entry[0] || "").toString().toLowerCase(),
          amount: Number(entry[1]) || 0,
        };
      }
      if (entry && typeof entry === "object") {
        return {
          key: entry.id ?? `cat-${i}`,
          category: (entry.category ?? entry[0] ?? "").toString().toLowerCase(),
          amount: Number(entry.total ?? entry.amount ?? entry[1] ?? 0) || 0,
        };
      }
      return null;
    })
    .filter(Boolean);
};

const mapRecentExpenses = (raw = []) =>
  raw.map((item, i) => ({
    id: item.id ?? `expense-${i}`,
    date: item.date ?? "",
    time: item.time ?? "",
    amount: Number(item.amount ?? 0) || 0,
    category: item.category ? item.category.toString() : "uncategorized",
    description: item.description ?? "",
  }));

const normalizeCategoryChart = (raw = []) =>
  Array.isArray(raw)
    ? raw
        .map((entry, i) => {
          if (!entry) return null;
          const key = (
            entry.category ??
            entry.name ??
            `category-${i}`
          ).toString();
          return {
            key,
            category: titleCase(key),
            amount: Number(entry.total ?? entry.amount ?? 0) || 0,
          };
        })
        .filter(Boolean)
    : [];

const normalizeDailyChart = (raw = []) =>
  Array.isArray(raw)
    ? raw
        .map((entry, i) => {
          if (!entry) return null;
          return {
            day: entry.label ?? entry.day ?? `Day ${i + 1}`,
            amount: Number(entry.total ?? entry.amount ?? 0) || 0,
          };
        })
        .filter(Boolean)
    : [];

const normalizeMonthlyChart = (raw = []) =>
  Array.isArray(raw)
    ? raw
        .map((entry, i) => {
          if (!entry) return null;
          return {
            label: entry.label ?? entry.month ?? `Month ${i + 1}`,
            amount: Number(entry.total ?? entry.amount ?? 0) || 0,
          };
        })
        .filter(Boolean)
    : [];

const computeDailySpending = (expenses = []) => {
  const today = new Date();
  const buckets = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - offset));
    return {
      key: date.toISOString().slice(0, 10),
      day: date.toLocaleDateString("en-IN", { weekday: "short" }),
      amount: 0,
    };
  });
  const indexByKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
  expenses.forEach((expense) => {
    const bucket = indexByKey[expense.date];
    if (bucket) bucket.amount += Number(expense.amount) || 0;
  });
  return buckets.map(({ day, amount }) => ({ day, amount }));
};

/* ─── useIsMobile hook ───────────────────────────────────────────────────── */

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
};

/* ─── Toast component ────────────────────────────────────────────────────── */

const Toast = ({ toast, onDismiss, isMobile }) => {
  if (!toast) return null;
  const icons = {
    error: <AlertCircle className="w-4 h-4 flex-shrink-0" />,
    success: <CheckCircle className="w-4 h-4 flex-shrink-0" />,
    info: <Info className="w-4 h-4 flex-shrink-0" />,
  };
  const styles = {
    error: "bg-red-600 text-white border-red-700",
    success: "bg-emerald-600 text-white border-emerald-700",
    info: "bg-blue-700 text-white border-blue-800",
  };
  return (
    <div
      className={`fixed z-50 flex items-start gap-3 px-4 py-3 rounded-xl shadow-2xl border
        transition-all duration-300 max-w-sm
        ${isMobile ? "bottom-24 left-4 right-4" : "top-4 right-4"}
        ${styles[toast.type] || styles.info}`}
    >
      {icons[toast.type]}
      <span className="text-sm font-medium leading-snug flex-1">
        {toast.message}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-1 opacity-70 hover:opacity-100 transition-opacity flex-shrink-0"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

/* ─── MobileHeader ───────────────────────────────────────────────────────── */

const MobileHeader = ({
  displayName,
  userEmail,
  loggingEnabled,
  preferenceSaving,
  onToggleLogging,
  onLogout,
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden sticky top-0 z-30 bg-white border-b border-blue-100 shadow-sm">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <h1 className="text-lg font-bold text-blue-900 leading-tight">
            Voxly
          </h1>
          <p className="text-xs text-blue-600">Voice Finance Tracker</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-700 active:bg-blue-100"
          aria-label="Menu"
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-blue-100 bg-white px-4 py-3 space-y-3 shadow-md">
          <div className="flex items-center gap-3 pb-3 border-b border-blue-50">
            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700">
              <User className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-900">
                {displayName}
              </p>
              {userEmail && (
                <p className="text-xs text-blue-500">{userEmail}</p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-blue-900">Voice logging</p>
              <p className="text-xs text-blue-500">
                Store transcripts for debugging
              </p>
            </div>
            <button
              type="button"
              onClick={onToggleLogging}
              disabled={preferenceSaving}
              className={`relative inline-flex h-6 w-11 items-center rounded-full border transition
                ${loggingEnabled ? "bg-blue-600 border-blue-600" : "bg-gray-300 border-gray-300"}
                ${preferenceSaving ? "opacity-70 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition
                ${loggingEnabled ? "translate-x-5" : "translate-x-1"}`}
              />
            </button>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl
              border border-red-200 text-red-600 text-sm font-semibold
              active:bg-red-50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
};

/* ─── DesktopHeader ──────────────────────────────────────────────────────── */

const DesktopHeader = ({
  displayName,
  userEmail,
  loggingEnabled,
  preferenceSaving,
  onToggleLogging,
  onLogout,
}) => (
  <div className="hidden md:flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
    <div>
      <h1 className="text-3xl font-bold text-blue-900 md:text-4xl">
        Voice Finance Tracker
      </h1>
      <p className="mt-1 text-blue-700">
        Track your expenses with voice commands or manual entry
      </p>
    </div>
    <div className="flex gap-3 items-center">
      <div className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-blue-900 shadow-sm">
        <div>
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
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-500">
          Voice logging
        </p>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleLogging}
            disabled={preferenceSaving}
            className={`relative inline-flex h-6 w-11 items-center rounded-full border transition
              ${loggingEnabled ? "bg-blue-600 border-blue-600" : "bg-gray-300 border-gray-300"}
              ${preferenceSaving ? "opacity-70 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition
              ${loggingEnabled ? "translate-x-5" : "translate-x-1"}`}
            />
          </button>
          <p className="text-sm font-semibold">
            {loggingEnabled ? "Enabled" : "Disabled"}
            {preferenceSaving && (
              <span className="ml-2 text-xs font-normal text-blue-500">
                Saving…
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  </div>
);

/* ─── SummaryDropdown ────────────────────────────────────────────────────── */

const SummaryDropdown = ({
  id,
  expanded,
  onToggle,
  icon: Icon,
  title,
  badge,
  children,
}) => (
  <div className="app-card border border-blue-200 overflow-hidden">
    <button
      onClick={() => onToggle(id)}
      className="w-full min-h-[56px] px-4 py-3 flex items-center justify-between
        hover:bg-blue-50 active:bg-blue-100 transition-colors gap-2"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon className="w-5 h-5 text-blue-600 flex-shrink-0" />
        <span className="font-semibold text-blue-900 text-sm truncate">
          {title}
        </span>
        {badge !== undefined && (
          <span className="text-base font-bold text-blue-700 truncate">
            {badge}
          </span>
        )}
      </div>
      {expanded ? (
        <ChevronUp className="w-4 h-4 text-blue-500 flex-shrink-0" />
      ) : (
        <ChevronDown className="w-4 h-4 text-blue-500 flex-shrink-0" />
      )}
    </button>
    {expanded && (
      <div className="px-4 py-4 bg-blue-50 border-t border-blue-100 text-sm text-blue-800 space-y-1">
        {children}
      </div>
    )}
  </div>
);

/* ─── BarChart (responsive) ──────────────────────────────────────────────── */

const ResponsiveBarChart = ({
  data,
  maxVal,
  colorFn,
  labelKey,
  amountKey = "amount",
  overBudgetFn,
}) => {
  if (!data || data.length === 0)
    return <p className="text-blue-700 text-sm py-4">No data yet.</p>;
  const max =
    maxVal || data.reduce((m, d) => Math.max(m, d[amountKey]), 0) || 1;
  const BAR_W = Math.max(32, Math.min(48, Math.floor(280 / data.length)));

  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <div
        className="flex items-end gap-1 pb-1"
        style={{ minWidth: data.length * (BAR_W + 8), height: 200 }}
      >
        {data.map((item, idx) => {
          const pct = (item[amountKey] / max) * 100;
          const over = overBudgetFn ? overBudgetFn(item) : false;
          return (
            <div
              key={idx}
              className="flex flex-col items-center flex-1 min-w-0"
              style={{ minWidth: BAR_W }}
            >
              <div
                className="flex flex-col justify-end"
                style={{ height: 168 }}
              >
                <div className="relative group cursor-default">
                  <div
                    className={`rounded-t transition-all ${over ? "bg-red-500" : colorFn ? colorFn(idx) : "bg-blue-600"}`}
                    style={{
                      width: BAR_W,
                      height: Math.max(2, (pct / 100) * 160),
                    }}
                  />
                  <div
                    className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2
                    bg-blue-900 text-white px-2 py-1 rounded text-xs whitespace-nowrap
                    opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10"
                  >
                    {formatINR(item[amountKey])}
                    {over && <div className="text-red-300 text-xs">Over!</div>}
                  </div>
                </div>
              </div>
              <span className="text-xs text-blue-700 mt-1.5 font-medium text-center leading-tight truncate w-full px-0.5">
                {item[labelKey]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ─── VoicePanel ─────────────────────────────────────────────────────────── */

const VoicePanel = ({
  isRecording,
  voiceProcessing,
  voiceConfirm,
  voiceStatus,
  onToggle,
}) => (
  <div className="app-card border-2 border-blue-200 p-6 flex flex-col items-center justify-center min-h-[260px]">
    <button
      onClick={onToggle}
      disabled={voiceProcessing || Boolean(voiceConfirm)}
      className={`w-28 h-28 rounded-full flex items-center justify-center transition-all duration-300 select-none
        ${
          voiceProcessing || voiceConfirm
            ? "bg-blue-300 cursor-not-allowed"
            : isRecording
              ? "bg-red-500 hover:bg-red-600 shadow-2xl shadow-red-200 animate-pulse"
              : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-2xl shadow-blue-200"
        }`}
      aria-pressed={isRecording}
      aria-label={isRecording ? "Stop listening" : "Start listening"}
    >
      {isRecording ? (
        <MicOff className="w-14 h-14 text-white" />
      ) : (
        <Mic className="w-14 h-14 text-white" />
      )}
    </button>
    <p className="mt-5 text-base font-semibold text-blue-900">
      {voiceProcessing
        ? "Processing…"
        : isRecording
          ? "Listening…"
          : "Tap to Speak"}
    </p>
    <p className="text-sm text-blue-500 mt-1.5 text-center min-h-[2.5rem] max-w-[220px] leading-snug">
      {voiceStatus || 'Say "Add 500 to food"'}
    </p>
    <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
      {["Add", "Balance", "Summary"].map((label) => (
        <span
          key={label}
          className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium"
        >
          {label}
        </span>
      ))}
    </div>
  </div>
);

/* ─── FloatingMicFAB (mobile only) ──────────────────────────────────────── */

const FloatingMicFAB = ({
  isRecording,
  voiceProcessing,
  voiceConfirm,
  onToggle,
}) => (
  <button
    onClick={onToggle}
    disabled={voiceProcessing || Boolean(voiceConfirm)}
    className={`md:hidden fixed bottom-6 right-5 z-40 w-16 h-16 rounded-full shadow-2xl
      flex items-center justify-center transition-all duration-200 select-none
      ${
        voiceProcessing || voiceConfirm
          ? "bg-blue-300 cursor-not-allowed"
          : isRecording
            ? "bg-red-500 shadow-red-300 animate-pulse"
            : "bg-blue-600 active:bg-blue-700 shadow-blue-300"
      }`}
    aria-pressed={isRecording}
    aria-label={isRecording ? "Stop listening" : "Start voice command"}
  >
    {isRecording ? (
      <MicOff className="w-7 h-7 text-white" />
    ) : (
      <Mic className="w-7 h-7 text-white" />
    )}
  </button>
);

/* ─── CategoryPie ────────────────────────────────────────────────────────── */

const CategoryPie = ({ data }) => {
  const COLORS = [
    "#1e40af",
    "#3b82f6",
    "#60a5fa",
    "#93c5fd",
    "#bfdbfe",
    "#dbeafe",
  ];
  const BADGE_COLORS = [
    "bg-blue-900",
    "bg-blue-700",
    "bg-blue-500",
    "bg-blue-400",
    "bg-blue-300",
    "bg-blue-200",
  ];
  if (!data || data.length === 0)
    return (
      <p className="text-blue-700 text-sm py-4">
        Add expenses to see distribution.
      </p>
    );
  const total = data.reduce((s, c) => s + c.amount, 0) || 1;
  let currentAngle = 0;

  return (
    <>
      <div className="relative w-40 h-40 mx-auto mb-4">
        <svg
          viewBox="0 0 100 100"
          className="transform -rotate-90 w-full h-full"
        >
          {data.map((cat, idx) => {
            const pct = (cat.amount / total) * 100;
            const angle = (pct / 100) * 360;
            const largeArc = angle > 180 ? 1 : 0;
            const sx = 50 + 40 * Math.cos((currentAngle * Math.PI) / 180);
            const sy = 50 + 40 * Math.sin((currentAngle * Math.PI) / 180);
            const ex =
              50 + 40 * Math.cos(((currentAngle + angle) * Math.PI) / 180);
            const ey =
              50 + 40 * Math.sin(((currentAngle + angle) * Math.PI) / 180);
            const d = `M 50 50 L ${sx} ${sy} A 40 40 0 ${largeArc} 1 ${ex} ${ey} Z`;
            currentAngle += angle;
            return (
              <path
                key={cat.category}
                d={d}
                fill={COLORS[idx % COLORS.length]}
                stroke="white"
                strokeWidth="0.5"
              />
            );
          })}
        </svg>
      </div>
      <div className="space-y-1.5">
        {data.slice(0, 6).map((cat, idx) => (
          <div
            key={`pie-${cat.category}-${idx}`}
            className="flex items-center justify-between text-xs"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <div
                className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${BADGE_COLORS[idx % BADGE_COLORS.length]}`}
              />
              <span className="text-blue-800 truncate">{cat.category}</span>
            </div>
            <span className="font-semibold text-blue-900 ml-2 flex-shrink-0">
              {formatINR(cat.amount)}
            </span>
          </div>
        ))}
      </div>
    </>
  );
};

/* ─── Main Dashboard ─────────────────────────────────────────────────────── */

const VoiceFinanceDashboard = ({
  user,
  preferences = { log_opt_in: false },
  onLogout = () => {},
  onToggleLogging = async () => {},
}) => {
  const isMobile = useIsMobile();
  const [summary, setSummary] = useState(null);
  const [recentExpenses, setRecentExpenses] = useState([]);
  const [chartCategories, setChartCategories] = useState([]);
  const [chartDaily, setChartDaily] = useState([]);
  const [chartMonthly, setChartMonthly] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [expandedSection, setExpandedSection] = useState(null);
  const [newExpense, setNewExpense] = useState({
    amount: "",
    category: "food",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceConfirm, setVoiceConfirm] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [budgetWarning, setBudgetWarning] = useState(null);
  const [budgetLimits, setBudgetLimits] = useState({});
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const recognitionRef = useRef(null);
  const toastTimerRef = useRef(null);

  const displayName =
    user?.display_name || user?.displayName || user?.email || "You";
  const userEmail = user?.email || "";
  const loggingEnabled = Boolean(preferences?.log_opt_in);

  /* ── Data loading ─────────────────────────────────────────────────────── */

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [
        summaryResult,
        recentResult,
        categoryResult,
        dailyResult,
        monthlyResult,
        budgetsResult,
      ] = await Promise.allSettled([
        getSummary(),
        getRecent(RECENT_LIMIT),
        getCategoryBreakdown(),
        getDailyTotals(7),
        getMonthlyTotals(6),
        getBudgets(),
      ]);

      let loadError = null;

      if (summaryResult.status === "fulfilled") {
        setSummary(summaryResult.value);
      } else {
        setSummary(null);
        const r = summaryResult.reason;
        loadError =
          loadError ||
          r?.message ||
          (typeof r === "string" ? r : r?.toString()) ||
          "Failed to fetch summary.";
      }

      if (recentResult.status === "fulfilled") {
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
        const r = recentResult.reason;
        loadError =
          loadError || r?.message || "Failed to fetch recent expenses.";
      }

      setChartCategories(
        categoryResult.status === "fulfilled"
          ? categoryResult.value?.items || categoryResult.value?.data || []
          : [],
      );
      setChartDaily(
        dailyResult.status === "fulfilled"
          ? dailyResult.value?.items || dailyResult.value?.data || []
          : [],
      );
      setChartMonthly(
        monthlyResult.status === "fulfilled"
          ? monthlyResult.value?.items || monthlyResult.value?.data || []
          : [],
      );

      if (budgetsResult.status === "fulfilled") {
        setBudgetLimits(budgetsResult.value || {});
      } else {
        setBudgetLimits({});
      }

      if (loadError) setError(loadError);
    } catch (err) {
      setError(err.message || "Unable to load data right now.");
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

  /* ── Toast timer ──────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!toast) return undefined;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [toast]);

  /* ── Voice handling ───────────────────────────────────────────────────── */

  const handleVoiceResponse = useCallback(
    async (data) => {
      if (!data) {
        setVoiceStatus("No response.");
        setToast({ type: "error", message: "No response from the assistant." });
        return true;
      }
      const replyMessage = data.reply || data.message || "Command processed.";
      const isError = data.error || data.success === false;
      setVoiceStatus(replyMessage);
      setToast({ type: isError ? "error" : "info", message: replyMessage });

      if (data.budget_alert) {
        setBudgetWarning(data.budget_alert);
      } else if (
        Array.isArray(data?.dashboard?.budget_alerts) &&
        data.dashboard.budget_alerts.length > 0
      ) {
        setBudgetWarning(data.dashboard.budget_alerts[0]);
      } else if (!isError) {
        setBudgetWarning(null);
      }

      if (
        replyMessage &&
        "speechSynthesis" in window &&
        replyMessage.length <= 160
      ) {
        const utterance = new SpeechSynthesisUtterance(replyMessage);
        window.speechSynthesis.speak(utterance);
      }

      const options =
        data.options || data.option_list || data.clarification_options;
      if (
        (data.needs_confirmation ||
          data.needsClarification ||
          data.request_confirmation) &&
        Array.isArray(options) &&
        options.length > 0
      ) {
        setVoiceConfirm({
          title: data.confirmation_prompt || "Please confirm",
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
        setRecentExpenses(
          mapRecentExpenses(data.dashboard.recent_expenses || []),
        );
        if (data.dashboard.chart_series) {
          const charts = data.dashboard.chart_series;
          setChartCategories(
            Array.isArray(charts.category_breakdown)
              ? charts.category_breakdown
              : [],
          );
          setChartDaily(
            Array.isArray(charts.daily_totals) ? charts.daily_totals : [],
          );
          setChartMonthly(
            Array.isArray(charts.monthly_totals) ? charts.monthly_totals : [],
          );
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
      const cmd =
        option?.value ||
        option?.command ||
        option?.text ||
        option?.label ||
        option;
      if (!cmd || (typeof cmd === "string" && !cmd.trim())) {
        setVoiceStatus("Command cancelled.");
        return;
      }
      setVoiceProcessing(true);
      try {
        const response = await apiSendVoiceCommand(String(cmd));
        await handleVoiceResponse(response);
      } catch (err) {
        const message = err?.message || "Voice command failed.";
        setVoiceStatus(message);
        setToast({ type: "error", message });
      } finally {
        setVoiceProcessing(false);
      }
    },
    [handleVoiceResponse],
  );

  /* ── Speech recognition setup ─────────────────────────────────────────── */

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceStatus("Voice recognition not supported in this browser.");
      return undefined;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => {
      setIsRecording(true);
      setVoiceStatus("Listening…");
    };
    recognition.onerror = (e) => {
      setIsRecording(false);
      setVoiceProcessing(false);
      setVoiceStatus(
        e.error === "no-speech"
          ? "No speech detected. Try again."
          : `Error: ${e.error}`,
      );
    };
    recognition.onend = () => setIsRecording(false);
    recognition.onresult = async (event) => {
      const transcript = event.results[0][0].transcript;
      setVoiceStatus(`Heard: "${transcript}"`);
      setVoiceProcessing(true);
      try {
        const response = await apiSendVoiceCommand(transcript);
        await handleVoiceResponse(response);
      } catch (err) {
        const message = err?.message || "Voice command failed.";
        setVoiceStatus(message);
        setToast({ type: "error", message });
        setVoiceConfirm(null);
      }
      setVoiceProcessing(false);
    };
    recognitionRef.current = recognition;
    return () => recognition.stop();
  }, [handleVoiceResponse]);

  const toggleRecording = useCallback(() => {
    if (voiceProcessing || voiceConfirm) {
      setVoiceStatus("Please finish the current command first.");
      return;
    }
    const recognition = recognitionRef.current;
    if (!recognition) {
      setVoiceStatus("Voice recognition not supported in this browser.");
      return;
    }
    if (isRecording) {
      recognition.stop();
      return;
    }

    setVoiceStatus("Preparing to listen…");
    const speakPrompt = (text) =>
      new Promise((res) => {
        try {
          if (!("speechSynthesis" in window)) {
            res();
            return;
          }
          const u = new SpeechSynthesisUtterance(text);
          u.onend = res;
          u.onerror = res;
          u.lang = "en-IN";
          u.rate = 1;
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
        } catch {
          res();
        }
      });

    speakPrompt("Listening now.")
      .then(() => {
        try {
          recognition.start();
        } catch {
          try {
            recognition.start();
          } catch (e) {
            setVoiceStatus("Unable to access microphone.");
          }
        }
      })
      .catch(() => {
        try {
          recognition.start();
        } catch (e) {
          setVoiceStatus("Unable to access microphone.");
        }
      });
  }, [voiceProcessing, voiceConfirm, isRecording]);

  /* ── Manual add expense ───────────────────────────────────────────────── */

  const handleAddExpense = async () => {
    const amountValue = Number(newExpense.amount);
    if (!amountValue || amountValue <= 0) {
      setToast({ type: "error", message: "Enter a positive amount." });
      return;
    }
    if (!newExpense.category) {
      setToast({ type: "error", message: "Select a category." });
      return;
    }
    setSubmitting(true);
    try {
      const payload = await apiAddExpense({
        amount: amountValue,
        category: newExpense.category,
      });
      setToast({
        type: "success",
        message: payload.message || "Expense added.",
      });
      setNewExpense({ amount: "", category: newExpense.category });
      await loadData();
    } catch (err) {
      setToast({
        type: "error",
        message: err.message || "Failed to add expense.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handlePreferenceToggle = useCallback(async () => {
    if (!user) return;
    setPreferenceSaving(true);
    try {
      await onToggleLogging(!loggingEnabled);
      setToast({
        type: "success",
        message: !loggingEnabled ? "Logging enabled." : "Logging disabled.",
      });
    } catch (err) {
      setToast({
        type: "error",
        message: err.message || "Unable to update preference.",
      });
    } finally {
      setPreferenceSaving(false);
    }
  }, [loggingEnabled, onToggleLogging, user]);

  /* ── Memoised derived state ───────────────────────────────────────────── */

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
  const monthlyTotal = summary?.monthly_total ?? monthlySummaryData.total;
  const budgetAlerts = Array.isArray(summary?.budget_alerts)
    ? summary.budget_alerts
    : [];

  const dailySpending = useMemo(() => {
    const fromApi = normalizeDailyChart(chartDaily);
    return fromApi.length > 0 ? fromApi : computeDailySpending(recentExpenses);
  }, [chartDaily, recentExpenses]);

  const categorySpending = useMemo(() => {
    const fromApi = normalizeCategoryChart(chartCategories);
    return fromApi.length > 0
      ? fromApi
      : categoryTotals.map((item) => ({
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
        const budget = budgetLimits[item.category]?.limit ?? 0;
        const percentage = budget
          ? Math.round((item.amount / budget) * 100)
          : 0;
        return {
          category: titleCase(item.category),
          total: item.amount,
          budget,
          percentage,
        };
      }),
    [categoryTotals, budgetLimits],
  );

  /* ── Render ───────────────────────────────────────────────────────────── */

  return (
    <div className="app-shell">
      {/* Mobile sticky header */}
      <MobileHeader
        displayName={displayName}
        userEmail={userEmail}
        loggingEnabled={loggingEnabled}
        preferenceSaving={preferenceSaving}
        onToggleLogging={handlePreferenceToggle}
        onLogout={onLogout}
      />

      {/* Toast */}
      <Toast
        toast={toast}
        onDismiss={() => setToast(null)}
        isMobile={isMobile}
      />

      <div
        className="max-w-7xl mx-auto px-3 py-4 sm:px-6 sm:py-6 lg:px-8 space-y-5
        pb-24 md:pb-8"
      >
        {/* Desktop header */}
        <DesktopHeader
          displayName={displayName}
          userEmail={userEmail}
          loggingEnabled={loggingEnabled}
          preferenceSaving={preferenceSaving}
          onToggleLogging={handlePreferenceToggle}
          onLogout={onLogout}
        />

        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
            {error}
          </div>
        )}

        {/* Budget alerts */}
        {(budgetAlerts.length > 0 || budgetWarning) && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl space-y-1.5">
            <p className="font-semibold text-sm">Budget alerts</p>
            <ul className="space-y-1 text-sm">
              {budgetWarning && (
                <li className="flex gap-1.5">
                  <span>•</span>
                  {budgetWarning}
                </li>
              )}
              {budgetAlerts.map((alert, i) => (
                <li key={i} className="flex gap-1.5">
                  <span>•</span>
                  {alert}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Top section: mic + summary dropdowns ── */}
        <div className="grid gap-4 lg:grid-cols-12">
          {/* Voice panel — hidden on mobile (FAB replaces it) */}
          <div className="hidden md:flex col-span-12 lg:col-span-5">
            <div className="w-full">
              <VoicePanel
                isRecording={isRecording}
                voiceProcessing={voiceProcessing}
                voiceConfirm={voiceConfirm}
                voiceStatus={voiceStatus}
                onToggle={toggleRecording}
              />
            </div>
          </div>

          {/* Mobile voice status bar */}
          {(isRecording || voiceProcessing || voiceStatus) && (
            <div className="md:hidden rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 flex items-center gap-3">
              <div
                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isRecording ? "bg-red-500 animate-pulse" : voiceProcessing ? "bg-amber-400 animate-pulse" : "bg-blue-400"}`}
              />
              <span className="text-sm text-blue-800 leading-snug">
                {voiceProcessing ? "Processing…" : voiceStatus || "Ready"}
              </span>
            </div>
          )}

          {/* Summary dropdowns */}
          <div className="col-span-12 lg:col-span-7 space-y-3">
            <SummaryDropdown
              id="daily"
              expanded={expandedSection === "daily"}
              onToggle={(id) =>
                setExpandedSection(expandedSection === id ? null : id)
              }
              icon={Wallet}
              title="Today's Total"
              badge={formatINR(todayTotal)}
            >
              <p>
                Latest total for today. Keep logging to stay on top of spending.
              </p>
            </SummaryDropdown>

            <SummaryDropdown
              id="weeklyTotal"
              expanded={expandedSection === "weeklyTotal"}
              onToggle={(id) =>
                setExpandedSection(expandedSection === id ? null : id)
              }
              icon={Calendar}
              title="Weekly Total"
              badge={weeklyTotal != null ? formatINR(weeklyTotal) : "—"}
            >
              {weeklySummaryData.lines.length > 0 ? (
                weeklySummaryData.lines.map((line, i) => <p key={i}>{line}</p>)
              ) : (
                <p>No weekly data yet. Add expenses to see insights.</p>
              )}
            </SummaryDropdown>

            <SummaryDropdown
              id="weeklySummary"
              expanded={expandedSection === "weeklySummary"}
              onToggle={(id) =>
                setExpandedSection(expandedSection === id ? null : id)
              }
              icon={TrendingUp}
              title="Weekly Summary"
            >
              {weeklySummaryData.lines.length > 0 ? (
                <>
                  <p className="font-medium">
                    Spend: {weeklyTotal != null ? formatINR(weeklyTotal) : "—"}{" "}
                    · Avg/day:{" "}
                    {dailyAverage != null ? formatINR(dailyAverage) : "—"}
                  </p>
                  {weeklySummaryData.topCategories.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {weeklySummaryData.topCategories.map((cat, i) => (
                        <li key={i}>
                          • {cat.name}:{" "}
                          {cat.amount != null ? formatINR(cat.amount) : "—"}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p>Weekly insights will appear after adding expenses.</p>
              )}
            </SummaryDropdown>

            <SummaryDropdown
              id="monthlySummary"
              expanded={expandedSection === "monthlySummary"}
              onToggle={(id) =>
                setExpandedSection(expandedSection === id ? null : id)
              }
              icon={BarChart3}
              title="Monthly Summary"
              badge={monthlyTotal != null ? formatINR(monthlyTotal) : "—"}
            >
              {monthlySummaryData.lines.length > 0 ? (
                <>
                  {monthlySummaryData.lines.map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                  {monthlySummaryData.topCategories.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {monthlySummaryData.topCategories.map((cat, i) => (
                        <li key={i}>
                          • {cat.name}:{" "}
                          {cat.amount != null ? formatINR(cat.amount) : "—"}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p>Monthly breakdown will appear once expenses are logged.</p>
              )}
            </SummaryDropdown>
          </div>
        </div>

        {/* ── Charts ── */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <ErrorBoundary fallback="Chart failed to load.">
            <div className="app-card p-4 border border-blue-200">
              <h3 className="text-sm font-bold text-blue-900 mb-3 flex items-center gap-2">
                <PieChart className="w-4 h-4" /> Category Distribution
              </h3>
              <CategoryPie data={categorySpending} />
            </div>
          </ErrorBoundary>

          <ErrorBoundary fallback="Chart failed to load.">
            <div className="app-card p-4 border border-blue-200">
              <h3 className="text-sm font-bold text-blue-900 mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> Last 7 Days
              </h3>
              <ResponsiveBarChart
                data={dailySpending}
                maxVal={null}
                labelKey="day"
                overBudgetFn={(d) => d.amount > 1500}
                colorFn={(i) => "bg-blue-600"}
              />
              <div className="mt-2 flex gap-3 text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-blue-600 inline-block" />
                  Normal
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-red-500 inline-block" />
                  Over budget
                </span>
              </div>
            </div>
          </ErrorBoundary>

          <ErrorBoundary fallback="Chart failed to load.">
            <div className="app-card p-4 border border-blue-200 sm:col-span-2 xl:col-span-1">
              <h3 className="text-sm font-bold text-blue-900 mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> 6-Month Trend
              </h3>
              {monthlyTrend.length > 0 ? (
                <ResponsiveBarChart
                  data={monthlyTrend}
                  labelKey="label"
                  colorFn={() => "bg-blue-500"}
                />
              ) : (
                <p className="text-blue-700 text-sm py-4">
                  Monthly totals will appear once expenses are logged.
                </p>
              )}
            </div>
          </ErrorBoundary>
        </div>

        <ErrorBoundary fallback="Recent expenses failed to load.">
          <div className="app-card p-4 border border-blue-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-blue-900">
              Recent Expenses
            </h3>
            {loading && (
              <span className="text-xs text-blue-500">Refreshing…</span>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-blue-100">
                  <th className="text-left py-2 px-3 text-blue-800 font-semibold">
                    Date
                  </th>
                  <th className="text-left py-2 px-3 text-blue-800 font-semibold">
                    Time
                  </th>
                  <th className="text-left py-2 px-3 text-blue-800 font-semibold">
                    Amount
                  </th>
                  <th className="text-left py-2 px-3 text-blue-800 font-semibold">
                    Category
                  </th>
                  <th className="text-left py-2 px-3 text-blue-800 font-semibold">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentExpenses.length > 0 ? (
                  recentExpenses.map((e) => (
                    <tr
                      key={e.id}
                      className="border-b border-blue-50 hover:bg-blue-50 transition-colors"
                    >
                      <td className="py-2.5 px-3 text-blue-700">
                        {e.date || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-blue-700">
                        {e.time || "—"}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-blue-900">
                        {formatINR(e.amount)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs">
                          {titleCase(e.category)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-blue-600">
                        {e.description || "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="py-6 text-center text-blue-500">
                      No expenses logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2.5">
            {recentExpenses.length > 0 ? (
              recentExpenses.map((e) => (
                <div
                  key={`m-${e.id}`}
                  className="rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-bold text-blue-900">
                        {formatINR(e.amount)}
                      </p>
                      <p className="text-xs text-blue-500 mt-0.5">
                        {e.date || "—"} · {e.time || "—"}
                      </p>
                      {e.description && (
                        <p className="text-sm text-blue-700 mt-0.5 truncate">
                          {e.description}
                        </p>
                      )}
                    </div>
                    <span className="flex-shrink-0 px-2.5 py-0.5 bg-white border border-blue-200 text-blue-800 rounded-full text-xs font-medium">
                      {titleCase(e.category)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-blue-500 text-sm text-center py-6">
                No expenses logged yet.
              </p>
            )}
          </div>
        </div>
        </ErrorBoundary>

        {/* ── Add Expense ── */}
        <div className="app-card p-4 border border-blue-200">
          <h3 className="text-base font-bold text-blue-900 mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5" /> Add Expense
          </h3>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-blue-800 mb-1.5">
                Amount (₹)
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={newExpense.amount}
                onChange={(e) =>
                  setNewExpense({ ...newExpense, amount: e.target.value })
                }
                placeholder="0.00"
                className="w-full px-3 py-3 border-2 border-blue-200 rounded-xl
                  focus:outline-none focus:border-blue-500 text-blue-900 text-base
                  bg-white placeholder-blue-300"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-blue-800 mb-1.5">
                Category
              </label>
              <select
                value={newExpense.category}
                onChange={(e) =>
                  setNewExpense({ ...newExpense, category: e.target.value })
                }
                className="w-full px-3 py-3 border-2 border-blue-200 rounded-xl
                  focus:outline-none focus:border-blue-500 text-blue-900 text-base bg-white appearance-none"
              >
                {[
                  "food",
                  "transport",
                  "entertainment",
                  "shopping",
                  "utilities",
                  "health",
                  "personal",
                  "other",
                ].map((cat) => (
                  <option key={cat} value={cat}>
                    {titleCase(cat)}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleAddExpense}
              disabled={submitting}
              className={`sm:flex-shrink-0 w-full sm:w-auto px-6 py-3 rounded-xl font-semibold
                text-base transition-colors shadow-sm min-h-[48px]
                ${submitting ? "bg-blue-300 text-white cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800"}`}
            >
              {submitting ? "Adding…" : "Add"}
            </button>
          </div>
        </div>

        {/* ── Category Budget Summary ── */}
        <div className="app-card p-4 border border-blue-200">
          <h3 className="text-base font-bold text-blue-900 mb-4 flex items-center gap-2">
            <Settings className="w-4 h-4" /> Category Budget
          </h3>
          {categoryData.length > 0 ? (
            <div className="space-y-3.5">
              {categoryData.map((cat, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-sm gap-2">
                    <span className="font-semibold text-blue-900 truncate">
                      {cat.category}
                    </span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {cat.budget === 0 ? (
                        <span className="text-blue-500 text-xs font-medium">
                          No budget set
                        </span>
                      ) : (
                        <>
                          <span className="text-blue-600 text-xs hidden sm:inline">
                            {formatINR(cat.total)} / {formatINR(cat.budget)}
                          </span>
                          <span
                            className={`font-bold text-xs px-2 py-0.5 rounded-full
                        ${
                          cat.percentage > 100
                            ? "bg-red-100 text-red-700"
                            : cat.percentage > 80
                              ? "bg-amber-100 text-amber-700"
                              : "bg-emerald-100 text-emerald-700"
                        }`}
                          >
                            {Math.round(cat.percentage)}%
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {cat.budget === 0 ? (
                    <p className="text-xs text-blue-500 sm:hidden">
                      {formatINR(cat.total)} spent · No budget set
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-blue-500 sm:hidden">
                        {formatINR(cat.total)} of {formatINR(cat.budget)}
                      </p>
                      <div className="relative h-2.5 bg-blue-100 rounded-full overflow-hidden">
                        <div
                          className={`absolute left-0 top-0 h-full rounded-full transition-all
                        ${cat.percentage > 100 ? "bg-red-500" : cat.percentage > 80 ? "bg-amber-400" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min(cat.percentage, 100)}%` }}
                        />
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-blue-500 text-sm">
              Category insights will appear once you log some expenses.
            </p>
          )}
        </div>
      </div>

      {/* Floating mic FAB — mobile only */}
      <FloatingMicFAB
        isRecording={isRecording}
        voiceProcessing={voiceProcessing}
        voiceConfirm={voiceConfirm}
        onToggle={toggleRecording}
      />

      <ConfirmDialog
        open={Boolean(voiceConfirm)}
        title={voiceConfirm?.title}
        message={voiceConfirm?.message}
        options={voiceConfirm?.options || []}
        onConfirm={handleVoiceConfirmSelect}
        onCancel={() => {
          setVoiceConfirm(null);
          setVoiceStatus("Command cancelled.");
        }}
      />
    </div>
  );
};

/* ─── Auth screens ───────────────────────────────────────────────────────── */

const AuthScreen = () => {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    confirmPassword: "",
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.email || !form.password) {
      setError("Email and password are required.");
      return;
    }
    if (mode === "register" && form.password !== form.confirmPassword) {
      setError("Passwords must match.");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "login")
        await login({ email: form.email, password: form.password });
      else
        await register({
          email: form.email,
          password: form.password,
          name: form.name,
        });
    } catch (err) {
      setError(err?.message || "Authentication failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-blue-100 bg-white p-7 shadow-2xl">
        <div className="text-center space-y-0.5 mb-7">
          <h1 className="text-3xl font-bold text-blue-900 tracking-tight">
            Voxly
          </h1>
          <p className="text-sm text-blue-500">
            Your voice-powered finance tracker
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}
          <div className="space-y-1">
            <label
              className="text-xs font-semibold text-blue-800 uppercase tracking-wide"
              htmlFor="auth-email"
            >
              Email
            </label>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="w-full rounded-2xl border-2 border-blue-100 px-4 py-3 text-blue-900 text-base
                focus:border-blue-500 focus:outline-none bg-blue-50/40 placeholder-blue-300"
              placeholder="you@example.com"
              value={form.email}
              onChange={handleChange}
            />
          </div>
          {mode === "register" && (
            <div className="space-y-1">
              <label
                className="text-xs font-semibold text-blue-800 uppercase tracking-wide"
                htmlFor="auth-name"
              >
                Display name
              </label>
              <input
                id="auth-name"
                name="name"
                type="text"
                className="w-full rounded-2xl border-2 border-blue-100 px-4 py-3 text-blue-900 text-base
                  focus:border-blue-500 focus:outline-none bg-blue-50/40 placeholder-blue-300"
                placeholder="e.g. Priya"
                value={form.name}
                onChange={handleChange}
              />
            </div>
          )}
          <div className="space-y-1">
            <label
              className="text-xs font-semibold text-blue-800 uppercase tracking-wide"
              htmlFor="auth-password"
            >
              Password
            </label>
            <input
              id="auth-password"
              name="password"
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              required
              className="w-full rounded-2xl border-2 border-blue-100 px-4 py-3 text-blue-900 text-base
                focus:border-blue-500 focus:outline-none bg-blue-50/40 placeholder-blue-300"
              placeholder="Enter password"
              value={form.password}
              onChange={handleChange}
            />
          </div>
          {mode === "register" && (
            <div className="space-y-1">
              <label
                className="text-xs font-semibold text-blue-800 uppercase tracking-wide"
                htmlFor="auth-confirm"
              >
                Confirm password
              </label>
              <input
                id="auth-confirm"
                name="confirmPassword"
                type="password"
                required
                className="w-full rounded-2xl border-2 border-blue-100 px-4 py-3 text-blue-900 text-base
                  focus:border-blue-500 focus:outline-none bg-blue-50/40 placeholder-blue-300"
                placeholder="Re-enter password"
                value={form.confirmPassword}
                onChange={handleChange}
              />
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-2xl bg-blue-600 px-4 py-3.5 text-white font-semibold text-base
              transition hover:bg-blue-700 active:bg-blue-800 disabled:cursor-not-allowed disabled:bg-blue-300
              shadow-lg shadow-blue-200"
          >
            {submitting
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-blue-600">
          {mode === "login" ? "Need an account?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
            className="font-semibold text-blue-900 hover:underline"
          >
            {mode === "login" ? "Create one" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
};

const LoadingScreen = () => (
  <div className="min-h-screen bg-blue-50 flex items-center justify-center px-4">
    <div className="rounded-3xl border border-blue-100 bg-white px-8 py-6 text-center text-blue-900 shadow-xl">
      <div className="w-10 h-10 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin mx-auto mb-3" />
      <p className="text-sm font-medium">Loading your workspace…</p>
    </div>
  </div>
);

const ProtectedApp = () => {
  const { user, initializing, logout, preferences, setLoggingPreference } =
    useAuth();
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
